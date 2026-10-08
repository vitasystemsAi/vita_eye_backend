import { describe, expect, it } from 'vitest';
import { hashPassword, needsRehash, PASSWORD_POLICY, verifyPassword } from './password';

describe('password hashing', () => {
  it('uses Argon2id and verifies correctly', async () => {
    const hash = await hashPassword('Correct-Horse-9');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(hash, 'Correct-Horse-9')).toBe(true);
    expect(await verifyPassword(hash, 'wrong')).toBe(false);
    expect(needsRehash(hash)).toBe(false);
  });

  it('returns false for malformed hashes instead of throwing', async () => {
    expect(await verifyPassword('not-a-hash', 'x')).toBe(false);
  });

  it('enforces the password policy', () => {
    expect(PASSWORD_POLICY.regex.test('Sh0rt')).toBe(false);
    expect(PASSWORD_POLICY.regex.test('alllowercase123')).toBe(false);
    expect(PASSWORD_POLICY.regex.test('Valid-Passw0rd')).toBe(true);
  });
});
