import { describe, expect, it } from 'vitest';
import { signToken, verifyToken } from './signedUrl';

const payload = { e: 'ev1', u: 'u1', o: 'o1', x: 2_000 };

describe('signed evidence tokens', () => {
  it('verifies a valid, unexpired token', () => {
    expect(verifyToken(signToken(payload, 'secret'), 'secret', 1_000)).toEqual(payload);
  });

  it('rejects expired tokens', () => {
    expect(verifyToken(signToken(payload, 'secret'), 'secret', 2_001)).toBeNull();
  });

  it('rejects tokens signed with another secret', () => {
    expect(verifyToken(signToken(payload, 'other'), 'secret', 1_000)).toBeNull();
  });

  it('rejects modified payloads', () => {
    const [, sig] = signToken(payload, 'secret').split('.');
    const forged = Buffer.from(JSON.stringify({ ...payload, e: 'ev2' })).toString('base64url');
    expect(verifyToken(`${forged}.${sig}`, 'secret', 1_000)).toBeNull();
  });

  it('rejects malformed tokens', () => {
    expect(verifyToken('garbage', 'secret')).toBeNull();
    expect(verifyToken('', 'secret')).toBeNull();
  });
});
