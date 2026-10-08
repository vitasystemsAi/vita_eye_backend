// End-to-end acceptance test against running backend + AI service + MySQL + Redis.
// Uses real photographs (ai-service/tests/fixtures, downloaded by
// ai-service/scripts/download_test_fixtures.py) streamed through the real Socket.IO ingest path.
//
// Usage: ADMIN_EMAIL=... ADMIN_PASSWORD=... node tests/smoke-e2e.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { io } from 'socket.io-client';
import { ApiClient, check, summary } from './lib/client.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.resolve(here, '../ai-service/tests/fixtures');
const SOCKET_URL = process.env.SOCKET_URL ?? 'http://localhost:5000';
const ORIGIN = process.env.FRONTEND_ORIGIN ?? 'http://localhost:3001';
const email = process.env.ADMIN_EMAIL ?? 'admin@example.com';
const password = process.env.ADMIN_PASSWORD;
if (!password) {
  console.error('Set ADMIN_PASSWORD');
  process.exit(2);
}
const img = (n) => fs.readFileSync(path.join(fixtures, n));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = Date.now().toString(36);

const admin = new ApiClient();
const login = await admin.login(email, password);
check('admin login', login.status === 200);

// ---------- Person registration & enrollment ----------
const personA = await admin.call('POST', '/persons', { personName: `E2E Person A ${stamp}`, referenceId: `E2E-A-${stamp}`, department: 'QA' });
check('create person', personA.status === 201, personA.body.error?.message);
const pid = personA.body.data.id;

const form = new FormData();
form.append('images', new Blob([img('person_a_1.jpg')], { type: 'image/jpeg' }), 'a1.jpg');
form.append('legalBasis', 'CONSENT');
form.append('consentReference', `CONSENT-FORM-${stamp}`);
form.append('consentConfirmed', 'true');
const enroll = await admin.call('POST', `/persons/${pid}/enroll`, form);
check('enroll face from real photo', enroll.status === 200 && enroll.body.data.person.enrollmentStatus === 'ENROLLED', JSON.stringify(enroll.body.error ?? ''));

const noConsent = new FormData();
noConsent.append('images', new Blob([img('person_a_2.jpg')], { type: 'image/jpeg' }), 'a2.jpg');
noConsent.append('legalBasis', 'CONSENT');
noConsent.append('consentReference', 'x');
const rejected = await admin.call('POST', `/persons/${pid}/enroll`, noConsent);
check('enrollment without consent confirmation rejected', rejected.status === 400);

const personGet = await admin.call('GET', `/persons/${pid}`);
const raw = JSON.stringify(personGet.body);
check('person API never returns embeddings', personGet.status === 200 && !/embedding"\s*:\s*\[/.test(raw) && !raw.includes('encrypted'));
check('template metadata present', personGet.body.data.templates.length === 1 && personGet.body.data.templates[0].modelVersion);

const dupB = await admin.call('POST', '/persons', { personName: `E2E Dup ${stamp}`, referenceId: `E2E-DUP-${stamp}` });
const dupForm = new FormData();
dupForm.append('images', new Blob([img('person_a_2.jpg')], { type: 'image/jpeg' }), 'a2.jpg');
dupForm.append('legalBasis', 'CONSENT');
dupForm.append('consentReference', 'dup');
dupForm.append('consentConfirmed', 'true');
const dup = await admin.call('POST', `/persons/${dupB.body.data.id}/enroll`, dupForm);
check('same face under another identity rejected', dup.status === 409 && dup.body.error.code === 'DUPLICATE_IDENTITY');
await admin.call('DELETE', `/persons/${dupB.body.data.id}`);

// ---------- Camera ----------
const cam = await admin.call('POST', '/cameras', { cameraName: `E2E Browser Cam ${stamp}`, cameraType: 'BROWSER', location: 'Main Entrance', site: 'HQ' });
check('create browser camera', cam.status === 201);
const cid = cam.body.data.id;
const ssrf = await admin.call('POST', '/cameras', { cameraName: `E2E Bad ${stamp}`, cameraType: 'RTSP', location: 'X', streamUrl: 'rtsp://8.8.8.8/stream' });
check('camera outside approved networks rejected (SSRF guard)', ssrf.status === 400);
const creds = await admin.call('POST', '/cameras', { cameraName: `E2E RTSP ${stamp}`, cameraType: 'RTSP', location: 'Dock', streamUrl: 'rtsp://user:pw@192.168.1.50/stream' });
check('credentials embedded in URL rejected', creds.status === 400);

// ---------- Live recognition over Socket.IO ----------
const socket = io(SOCKET_URL, { extraHeaders: { Cookie: admin.cookieHeader(), Origin: ORIGIN }, transports: ['websocket'] });
const received = { events: [], notifications: [] };
socket.on('event:new', (e) => received.events.push(e));
socket.on('notification:new', (n) => received.notifications.push(n));
await new Promise((resolve, reject) => {
  socket.on('connect', resolve);
  socket.on('connect_error', reject);
});
check('socket authenticated with session cookie', socket.connected);

const sendFrame = (buf) => new Promise((resolve) => socket.emit('frame', { cameraId: cid, image: buf }, resolve));
const notStarted = await sendFrame(img('person_a_2.jpg'));
check('frames rejected before monitoring starts', notStarted.ok === false && notStarted.error === 'MONITORING_NOT_STARTED');

const start = await admin.call('POST', `/cameras/${cid}/start-monitoring`);
check('start monitoring', start.status === 200 && start.body.data.camera.monitoringEnabled);

const knownAcks = [];
for (let i = 0; i < 4; i++) {
  knownAcks.push(await sendFrame(img('person_a_2.jpg')));
  await sleep(300);
}
check('frames processed by AI', knownAcks.every((a) => a.ok && !a.dropped), JSON.stringify(knownAcks.find((a) => !a.ok) ?? ''));
check('registered face matched as KNOWN', knownAcks.at(-1).faces?.[0]?.label === 'KNOWN' && knownAcks.at(-1).faces[0].personName?.includes('E2E Person A'));

await sleep(4500); // let the previous track expire so the next face starts a new track
const unknownAcks = [];
for (let i = 0; i < 4; i++) {
  unknownAcks.push(await sendFrame(img('person_b_1.jpg')));
  await sleep(300);
}
check('face absent from gallery classified UNKNOWN', unknownAcks.at(-1).faces?.[0]?.label === 'UNKNOWN');
await sleep(1500);

const known = received.events.find((e) => e.eventType === 'KNOWN' && e.camera?.id === cid);
const unknown = received.events.find((e) => e.eventType === 'UNKNOWN' && e.camera?.id === cid);
check('real-time KNOWN event broadcast', !!known && known.person?.id === pid);
check('real-time UNKNOWN event broadcast', !!unknown && unknown.person === null);
check('exactly one event per track (temporal verification + dedup)', received.events.filter((e) => e.camera?.id === cid).length === 2, `got ${received.events.length}`);
check('in-app notification for unknown person', received.notifications.some((n) => n.eventId === unknown?.id));

// ---------- Persistence, evidence & review workflow ----------
const list = await admin.call('GET', `/events?type=UNKNOWN&cameraId=${cid}`);
check('UNKNOWN event persisted in MySQL', list.status === 200 && list.body.data.some((e) => e.id === unknown?.id));
const detail = await admin.call('GET', `/events/${unknown.id}`);
const evidenceTypes = (detail.body.data?.evidence ?? []).map((e) => e.evidenceType).sort().join(',');
check('event detail with evidence metadata (face close-up + scene)', detail.status === 200 && evidenceTypes === 'FACE,SNAPSHOT', evidenceTypes);

const evId = detail.body.data.evidence[0].id;
const url = await admin.call('GET', `/evidence/${evId}/url`);
check('short-lived signed evidence URL issued', url.status === 200 && url.body.data.url.includes('token='));
const file = await admin.call('GET', url.body.data.url.replace('/api/v1', ''), undefined, { raw: true });
const bytes = Buffer.from(await file.arrayBuffer());
check('evidence downloads as decrypted JPEG', file.status === 200 && bytes[0] === 0xff && bytes[1] === 0xd8);
const anonEvidence = await new ApiClient().call('GET', url.body.data.url.replace('/api/v1', ''));
check('evidence URL unusable without session', anonEvidence.status === 401);

const ack = await admin.call('POST', `/events/${unknown.id}/acknowledge`, {});
check('acknowledge event', ack.status === 200 && ack.body.data.reviewStatus === 'ACKNOWLEDGED');
const note = await admin.call('POST', `/events/${unknown.id}/notes`, { note: 'Verified on site by guard; visitor from vendor.' });
check('add investigation note', note.status === 200 && note.body.data.notes.length === 1);
const resolve = await admin.call('POST', `/events/${unknown.id}/resolve`, { resolution: 'AUTHORIZED_VISITOR' });
check('resolve event', resolve.status === 200 && resolve.body.data.reviewStatus === 'RESOLVED');
const reopen = await admin.call('POST', `/events/${unknown.id}/reopen`, {});
check('reopen event', reopen.status === 200 && reopen.body.data.reviewStatus === 'INVESTIGATING');
const badTransition = await admin.call('POST', `/events/${unknown.id}/acknowledge`, {});
check('invalid review transition rejected', badTransition.status === 409);

const csv = await admin.call('GET', `/events/export?cameraId=${cid}`, undefined, { raw: true });
const csvText = await csv.text();
check('CSV export', csv.status === 200 && csvText.includes(unknown.id));

// ---------- Dashboard & notifications ----------
const dash = await admin.call('GET', `/dashboard/summary?tzOffset=330`);
check('dashboard summary from MySQL', dash.status === 200 && dash.body.data.today.unknown >= 1 && dash.body.data.today.known >= 1);
const trends = await admin.call('GET', '/dashboard/trends?days=7&tzOffset=330');
check('dashboard trends', trends.status === 200 && trends.body.data.days.length === 7);
const logs = await admin.call('GET', `/notifications/logs?eventId=${unknown.id}`);
check('notification delivery log recorded', logs.status === 200 && logs.body.data.length >= 1);
const emailLog = logs.body.data.find((n) => n.channel === 'EMAIL');
check('email delivery status recorded honestly', !emailLog || ['SKIPPED', 'PENDING', 'SENT', 'FAILED'].includes(emailLog.deliveryStatus), emailLog ? `${emailLog.deliveryStatus}: ${emailLog.lastError ?? ''}` : 'channel disabled');

// ---------- RBAC ----------
const opEmail = `operator.${stamp}@example.com`;
const op = await admin.call('POST', '/users', { name: 'E2E Operator', email: opEmail, password: `Op3rator-${stamp}-Pass`, role: 'SECURITY_OPERATOR' });
check('create operator user', op.status === 201);
const opClient = new ApiClient();
await opClient.login(opEmail, `Op3rator-${stamp}-Pass`);
const opEvents = await opClient.call('GET', '/events');
check('operator can view events', opEvents.status === 200);
const opDelete = await opClient.call('DELETE', `/persons/${pid}`);
check('operator cannot delete persons (server-side RBAC)', opDelete.status === 403);
const opUsers = await opClient.call('POST', '/users', { name: 'x', email: `x${stamp}@example.com`, password: 'Aa1aaaaaaaaaaa', role: 'SUPER_ADMIN' });
check('operator cannot create users', opUsers.status === 403);
await admin.call('PATCH', `/users/${op.body.data.id}`, { status: 'DISABLED' });

// ---------- Biometric deletion ----------
await admin.call('POST', `/cameras/${cid}/stop-monitoring`);
const del = await admin.call('DELETE', `/persons/${pid}`);
check('delete person + purge templates', del.status === 200);
const audit = await admin.call('GET', `/audit-logs?entityId=${pid}`);
check('biometric deletion audited', audit.body.data.some((a) => a.action === 'BIOMETRIC_TEMPLATES_DELETED' && a.metadata.verifiedRemaining === 0));
const afterDel = await admin.call('GET', `/events/${known.id}`);
check('historic events retained after person deletion', afterDel.status === 200 && afterDel.body.data.person?.deleted === true);

// Camera keeps its events for history, so it is deactivated rather than deleted.
const camDel = await admin.call('DELETE', `/cameras/${cid}`);
if (camDel.status === 409) await admin.call('PATCH', `/cameras/${cid}`, { isActive: false });

socket.close();
summary();
