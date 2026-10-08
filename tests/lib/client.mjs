// Minimal cookie-aware API client used by the end-to-end smoke tests (Node 20+, no dependencies).
export class ApiClient {
  constructor(base = process.env.API_BASE ?? 'http://localhost:5000/api/v1') {
    this.base = base;
    this.cookies = new Map();
  }

  store(res) {
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(';');
      const idx = pair.indexOf('=');
      const name = pair.slice(0, idx);
      const value = pair.slice(idx + 1);
      if (!value || /max-age=0|expires=thu, 01 jan 1970/i.test(c)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  cookieHeader() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  async call(method, path, body, { raw = false, headers = {} } = {}) {
    const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: {
        Cookie: this.cookieHeader(),
        'X-CSRF-Token': this.cookies.get('vita_csrf') ?? '',
        ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
    });
    this.store(res);
    if (raw) return res;
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
    return { status: res.status, body: json };
  }

  async login(email, password) {
    await this.call('GET', '/auth/csrf');
    return this.call('POST', '/auth/login', { email, password });
  }
}

let failures = 0;
export function check(label, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? `  (${extra})` : ''}`);
  if (!cond) failures++;
}
export function summary() {
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exitCode = failures ? 1 : 0;
}
