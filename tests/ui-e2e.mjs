// Browser end-to-end test of the web console against the running stack.
// Uses the locally installed Microsoft Edge (or Chrome) through playwright-core, with Chromium's
// fake webcam fed from tests/fixtures/fake-camera.y4m (built by tests/tools/make_fake_camera.py).
//
// Usage: ADMIN_PASSWORD=... node tests/ui-e2e.mjs   (APP_URL defaults to http://localhost:3001)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { ApiClient, check, summary } from './lib/client.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const APP = process.env.APP_URL ?? 'http://localhost:3001';
const email = process.env.ADMIN_EMAIL ?? 'admin@example.com';
const password = process.env.ADMIN_PASSWORD;
const video = path.join(here, 'fixtures', 'fake-camera.y4m');
const faceA = path.resolve(here, '../ai-service/tests/fixtures/person_a_1.jpg');
const artifacts = path.join(here, 'artifacts');
if (!password) throw new Error('Set ADMIN_PASSWORD');
if (!fs.existsSync(video)) throw new Error('Run tests/tools/make_fake_camera.py first');
fs.mkdirSync(artifacts, { recursive: true });

const stamp = Date.now().toString(36);
const personName = `UI Person ${stamp}`;
const cameraName = `UI Webcam ${stamp}`;

const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL ?? 'msedge',
  headless: process.env.HEADED ? false : true,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${video}`],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['camera'] });
const page = await context.newPage();
const consoleErrors = [];
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

async function shot(name) {
  await page.screenshot({ path: path.join(artifacts, `${name}.png`), fullPage: true });
}

try {
  // ---------- Login ----------
  await page.goto(`${APP}/dashboard`);
  await page.waitForURL(/\/login/, { timeout: 15000 });
  check('unauthenticated visit redirects to login', page.url().includes('/login?next=%2Fdashboard'));
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('wrong-password-123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByText('Invalid email or password.').waitFor({ timeout: 10000 });
  check('wrong password shows generic error', true);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.getByRole('heading', { name: 'Security Dashboard' }).waitFor();
  await page.getByText('Registered persons').first().waitFor();
  check('login lands on dashboard with live stats', true);
  await shot('01-dashboard');

  // ---------- Every page renders ----------
  const pages = [
    ['/monitoring', 'Live Monitoring'],
    ['/alerts', 'Unknown Alerts'],
    ['/events', 'Detection History'],
    ['/notifications', 'Notification Center'],
    ['/persons', 'Face Registration'],
    ['/cameras', 'Camera Management'],
    ['/users', 'Users & Roles'],
    ['/settings', 'Settings'],
    ['/audit', 'Audit Logs'],
  ];
  for (const [url, heading] of pages) {
    await page.goto(`${APP}${url}`);
    await page.getByRole('heading', { name: heading, exact: true }).waitFor({ timeout: 15000 });
    await page.waitForLoadState('networkidle').catch(() => undefined);
    const errorBanner = await page.locator('.border-red-500\\/30').count();
    check(`${url} renders without errors`, errorBanner === 0);
  }
  await page.goto(`${APP}/settings`);
  await page.getByRole('tab', { name: 'System health' }).click();
  await page.getByText('Healthy').first().waitFor({ timeout: 15000 });
  check('settings health shows dependencies healthy', (await page.getByText('Unavailable').count()) === 0);
  await shot('02-settings-health');

  // ---------- Face registration through the UI ----------
  await page.goto(`${APP}/persons/new`);
  await page.getByLabel('Full name').fill(personName);
  await page.getByLabel('Reference ID').fill(`UI-${stamp}`);
  await page.getByLabel('Department').fill('QA');
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await page.getByRole('tab', { name: 'Upload photos' }).click();
  await page.locator('input[type=file]').setInputFiles(faceA);
  await page.getByText('Pre-check OK').or(page.getByText('Low resolution')).first().waitFor({ timeout: 10000 });
  await page.getByLabel('Consent / authorization reference').fill(`CONSENT-UI-${stamp}`);
  await page.getByRole('button', { name: /^Enroll 1 image/ }).click();
  await page.getByText('Confirmation is required before biometric enrollment').waitFor();
  check('enrollment blocked until consent is confirmed', true);
  await page.getByRole('checkbox').first().check();
  await page.getByRole('button', { name: /^Enroll 1 image/ }).click();
  await page.getByText(`${personName} is enrolled`).waitFor({ timeout: 30000 });
  check('person registered and face enrolled via UI', true);
  await shot('03-enrolled');

  // ---------- Camera creation ----------
  await page.goto(`${APP}/cameras`);
  await page.getByRole('button', { name: 'Add camera' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Camera name', { exact: true }).fill(cameraName);
  await dialog.getByLabel('Location', { exact: true }).fill('UI test desk');
  await dialog.getByLabel('Site', { exact: true }).fill('HQ');
  await page.getByRole('dialog').getByRole('button', { name: 'Add camera' }).click();
  await page.getByRole('cell', { name: cameraName }).waitFor({ timeout: 10000 });
  check('browser camera created via UI', true);

  // ---------- Live monitoring with the (fake) webcam ----------
  await page.goto(`${APP}/monitoring`);
  await page.getByLabel('Camera record', { exact: true }).selectOption({ label: `${cameraName} — UI test desk` });
  await page.getByRole('button', { name: 'Start monitoring' }).click();
  await page.getByText(/LIVE ·/).waitFor({ timeout: 15000 });
  const knownBox = page.locator('svg text', { hasText: personName });
  await knownBox.first().waitFor({ timeout: 45000 });
  check('live overlay labels the enrolled person', true);
  await shot('04-monitoring-known');
  await page.locator('svg text', { hasText: 'Unrecognized' }).first().waitFor({ timeout: 60000 });
  check('live overlay labels the unregistered face as Unrecognized', true);
  await page.getByText('Unrecognized person detected').first().waitFor({ timeout: 20000 });
  check('real-time alert toast for unrecognized person', true);
  await shot('05-monitoring-unknown');
  await page.getByRole('button', { name: 'Stop' }).first().click();
  await page.getByText('Monitoring stopped').first().waitFor({ timeout: 10000 });

  // ---------- Alert review workflow ----------
  await page.goto(`${APP}/alerts`);
  const row = page.locator('tr', { hasText: cameraName }).first();
  await row.waitFor({ timeout: 15000 });
  await row.getByRole('link').first().click();
  await page.getByRole('heading', { name: 'Unrecognized person detection' }).waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: 'View evidence' }).click();
  const img = page.getByAltText('Detection evidence');
  await img.waitFor({ timeout: 15000 });
  await page.waitForFunction(() => {
    const el = document.querySelector('img[alt="Detection evidence"]');
    return el && el.complete && el.naturalWidth > 0;
  });
  check('encrypted evidence displayed through signed URL', true);
  await page.getByRole('button', { name: 'Acknowledge' }).click();
  await page.getByText('Event acknowledged').first().waitFor({ timeout: 10000 });
  await page.getByPlaceholder(/Add a factual note/).fill('Checked at reception: contractor with visitor pass.');
  await page.getByRole('button', { name: 'Add note' }).click();
  await page.getByText('Checked at reception: contractor with visitor pass.').waitFor();
  await page.getByRole('button', { name: 'Resolve' }).click();
  await page.getByLabel('Outcome', { exact: true }).selectOption('AUTHORIZED_VISITOR');
  await page.getByRole('dialog').getByRole('button', { name: 'Resolve' }).click();
  await page.getByText('Authorized visitor').first().waitFor({ timeout: 10000 });
  check('acknowledge, note and resolve via UI', true);
  await shot('06-event-resolved');

  // ---------- Notifications ----------
  const badge = await page.locator('button[aria-label^="Notifications ("]').getAttribute('aria-label');
  check('notification bell shows unread alerts', /\((\d+) unread\)/.test(badge ?? '') && !badge?.includes('(0 unread)'), badge ?? '');

  // ---------- Logout ----------
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL(/\/login/, { timeout: 10000 });
  await page.goto(`${APP}/persons`);
  await page.waitForURL(/\/login/, { timeout: 10000 });
  check('session ends on sign out', true);
} catch (err) {
  await shot('failure').catch(() => undefined);
  check(`UI flow completed (${err.message.split('\n')[0]})`, false);
} finally {
  const relevant = consoleErrors.filter((e) => !/Failed to load resource: the server responded with a status of (401|403|409)/.test(e));
  check('no unexpected browser console errors', relevant.length === 0, relevant.slice(0, 5).join(' | '));
  await browser.close();

  // Clean up test data through the API (camera has events, so deactivate instead of delete).
  const api = new ApiClient(`${APP}/api/v1`);
  await api.login(email, password);
  const persons = await api.call('GET', `/persons?search=${encodeURIComponent(`UI-${stamp}`)}`);
  for (const p of persons.body.data ?? []) await api.call('DELETE', `/persons/${p.id}`);
  const cams = await api.call('GET', `/cameras?search=${encodeURIComponent(cameraName)}`);
  for (const c of cams.body.data ?? []) {
    await api.call('POST', `/cameras/${c.id}/stop-monitoring`);
    const del = await api.call('DELETE', `/cameras/${c.id}`);
    if (del.status === 409) await api.call('PATCH', `/cameras/${c.id}`, { isActive: false });
  }
  summary();
}
