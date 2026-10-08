// Authentication / CSRF / RBAC smoke test against a running backend.
// Usage: ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD=... node tests/smoke-auth.mjs
import { ApiClient, check, summary } from './lib/client.mjs';

const email = process.env.ADMIN_EMAIL ?? 'admin@example.com';
const password = process.env.ADMIN_PASSWORD;
if (!password) {
  console.error('Set ADMIN_PASSWORD');
  process.exit(2);
}

const api = new ApiClient();

const health = await api.call('GET', '/health');
check('health endpoint', health.status === 200 && health.body.data.status === 'ok');

const noCsrf = await new ApiClient().call('POST', '/auth/login', { email, password });
check('login without CSRF token rejected', noCsrf.status === 403 && noCsrf.body.error.code === 'CSRF_INVALID');

await api.call('GET', '/auth/csrf');
const bad = await api.call('POST', '/auth/login', { email, password: 'definitely-wrong' });
check('wrong password rejected', bad.status === 401 && bad.body.error.code === 'INVALID_CREDENTIALS');

const login = await api.call('POST', '/auth/login', { email, password });
check('login succeeds', login.status === 200 && !!login.body.data?.user, `role=${login.body.data?.user?.role}`);
check('session cookies are set', api.cookies.has('vita_at') && api.cookies.has('vita_rt'));

const me = await api.call('GET', '/auth/me');
check('/auth/me returns permissions', me.status === 200 && me.body.data.user.permissions.length > 0);

const refresh = await api.call('POST', '/auth/refresh');
check('refresh rotates session', refresh.status === 200);

const users = await api.call('GET', '/users');
check('list users', users.status === 200 && users.body.meta.total >= 1);

const audit = await api.call('GET', '/audit-logs?pageSize=5');
check('audit logs recorded', audit.status === 200 && audit.body.data.some((a) => a.action === 'LOGIN_SUCCESS'));

const anon = await new ApiClient().call('GET', '/users');
check('unauthenticated access rejected', anon.status === 401);

const logout = await api.call('POST', '/auth/logout');
check('logout', logout.status === 200);
const after = await api.call('GET', '/auth/me');
check('session invalid after logout', after.status === 401);

summary();
