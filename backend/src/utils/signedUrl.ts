import { hmac, timingSafeEqualStr } from './crypto';

export interface SignedPayload {
  /** evidence id */
  e: string;
  /** user id the URL was issued to */
  u: string;
  /** organization id */
  o: string;
  /** expiry (unix seconds) */
  x: number;
}

export function signToken(payload: SignedPayload, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${hmac(secret, body)}`;
}

export function verifyToken(token: string, secret: string, nowSec = Math.floor(Date.now() / 1000)): SignedPayload | null {
  const [body, sig] = token.split('.');
  if (!body || !sig || !timingSafeEqualStr(sig, hmac(secret, body))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as SignedPayload;
    if (typeof payload.x !== 'number' || payload.x < nowSec) return null;
    return payload;
  } catch {
    return null;
  }
}
