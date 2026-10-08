import type { PageMeta } from './types';

const BASE = '/api/v1';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Field-level validation messages keyed by path (for forms). */
  fieldErrors(): Record<string, string> {
    if (!Array.isArray(this.details)) return {};
    const out: Record<string, string> = {};
    for (const d of this.details as Array<{ path?: string; message?: string }>) {
      if (d?.path && d.message && !out[d.path]) out[d.path] = d.message;
    }
    return out;
  }
}

export interface ApiResult<T> {
  data: T;
  meta?: PageMeta;
  raw: Record<string, unknown>;
}

export type Query = Record<string, string | number | boolean | null | undefined | string[]>;

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}

export function buildQuery(q?: Query): string {
  if (!q) return '';
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) {
      if (v.length) params.set(k, v.join(','));
    } else params.set(k, String(v));
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

let csrfPromise: Promise<void> | null = null;
async function ensureCsrf(force = false): Promise<string> {
  if (!force) {
    const existing = readCookie('vita_csrf');
    if (existing) return existing;
  }
  csrfPromise ??= fetch(`${BASE}/auth/csrf`, { credentials: 'same-origin', cache: 'no-store' }).then(() => undefined);
  try {
    await csrfPromise;
  } finally {
    csrfPromise = null;
  }
  return readCookie('vita_csrf') ?? '';
}

let refreshPromise: Promise<boolean> | null = null;
/** Single-flight refresh shared by all concurrent requests (refresh tokens rotate on every use). */
export function refreshSession(): Promise<boolean> {
  refreshPromise ??= (async () => {
    try {
      const token = await ensureCsrf();
      const res = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'X-CSRF-Token': token },
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      setTimeout(() => (refreshPromise = null), 0);
    }
  })();
  return refreshPromise;
}

export const SESSION_EXPIRED_EVENT = 'vita:session-expired';
export const PLATFORM_SESSION_EXPIRED_EVENT = 'vita:platform-session-expired';

interface RequestOptions {
  query?: Query;
  body?: unknown;
  signal?: AbortSignal;
  /** Skip the automatic refresh-and-retry on 401 (used by auth endpoints). */
  noRefresh?: boolean;
}

async function request<T>(method: string, path: string, opts: RequestOptions = {}, attempt = 0): Promise<ApiResult<T>> {
  const isForm = typeof FormData !== 'undefined' && opts.body instanceof FormData;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (method !== 'GET' && method !== 'HEAD') headers['X-CSRF-Token'] = await ensureCsrf();
  if (opts.body !== undefined && !isForm) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}${buildQuery(opts.query)}`, {
      method,
      headers,
      credentials: 'same-origin',
      cache: 'no-store',
      signal: opts.signal,
      body: opts.body === undefined ? undefined : isForm ? (opts.body as FormData) : JSON.stringify(opts.body),
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the VITA EYE server. Check your connection.');
  }

  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = {};
  }

  if (res.ok) return { data: json.data as T, meta: json.meta as PageMeta | undefined, raw: json };

  const err = (json.error ?? {}) as { code?: string; message?: string; details?: unknown };
  const code = err.code ?? (res.status === 502 || res.status === 504 ? 'DEPENDENCY_UNAVAILABLE' : 'HTTP_ERROR');

  // Platform sessions are a separate, non-refreshable cookie; expiry sends the operator back to the platform login.
  if (res.status === 401 && path.startsWith('/platform/')) {
    if (!opts.noRefresh && typeof window !== 'undefined') window.dispatchEvent(new Event(PLATFORM_SESSION_EXPIRED_EVENT));
  } else if (res.status === 401 && !opts.noRefresh && attempt === 0 && (code === 'TOKEN_EXPIRED' || code === 'UNAUTHENTICATED')) {
    if (await refreshSession()) return request<T>(method, path, opts, attempt + 1);
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
  }
  if (res.status === 403 && code === 'CSRF_INVALID' && attempt === 0) {
    await ensureCsrf(true);
    return request<T>(method, path, opts, attempt + 1);
  }
  throw new ApiError(res.status, code, err.message ?? `Request failed (${res.status})`, err.details);
}

export const api = {
  get: <T>(path: string, query?: Query, signal?: AbortSignal) => request<T>('GET', path, { query, signal }),
  post: <T>(path: string, body?: unknown, opts: Omit<RequestOptions, 'body'> = {}) => request<T>('POST', path, { ...opts, body: body ?? {} }),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, { body }),
  delete: <T>(path: string) => request<T>('DELETE', path),
};

/** Downloads a server-generated file (e.g. CSV export) through the authenticated session. */
export async function downloadFile(path: string, query: Query, fallbackName: string) {
  const doFetch = () => fetch(`${BASE}${path}${buildQuery(query)}`, { credentials: 'same-origin', cache: 'no-store' });
  let res = await doFetch();
  if (res.status === 401 && (await refreshSession())) res = await doFetch();
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new ApiError(res.status, json?.error?.code ?? 'HTTP_ERROR', json?.error?.message ?? 'Download failed');
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Something went wrong';
}
