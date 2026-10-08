import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DataCipher, hmac, sha256, timingSafeEqualStr } from './crypto';

const k1 = crypto.randomBytes(32).toString('base64');
const k2 = crypto.randomBytes(32).toString('base64');

describe('DataCipher', () => {
  const cipher = new DataCipher(`k1:${k1}`, 'k1');

  it('round-trips strings and buffers', () => {
    expect(cipher.decryptString(cipher.encryptString('secret', 'a'), 'a')).toBe('secret');
    const buf = crypto.randomBytes(1000);
    expect(cipher.decryptBuffer(cipher.encryptBuffer(buf, 'b'), 'b').equals(buf)).toBe(true);
  });

  it('uses a fresh IV for every encryption', () => {
    expect(cipher.encryptString('same')).not.toBe(cipher.encryptString('same'));
  });

  it('rejects ciphertext moved to a different row (AAD binding)', () => {
    const ct = cipher.encryptEmbedding([0.1, 0.2], 'face_template:t1:p1');
    expect(() => cipher.decryptEmbedding(ct, 'face_template:t2:p1')).toThrow();
  });

  it('detects tampering', () => {
    const blob = cipher.encryptBuffer(Buffer.from('evidence'), 'evidence:1');
    blob[blob.length - 1] ^= 0xff;
    expect(() => cipher.decryptBuffer(blob, 'evidence:1')).toThrow();
  });

  it('round-trips float32 embeddings', () => {
    const emb = Array.from({ length: 128 }, (_, i) => Math.sin(i));
    const out = cipher.decryptEmbedding(cipher.encryptEmbedding(emb, 'x'), 'x');
    expect(out).toHaveLength(128);
    out.forEach((v, i) => expect(v).toBeCloseTo(emb[i], 6));
  });

  it('supports key rotation: old ciphertext stays readable after a new active key', () => {
    const old = cipher.encryptString('legacy', 'r');
    const rotated = new DataCipher(`k1:${k1},k2:${k2}`, 'k2');
    expect(rotated.decryptString(old, 'r')).toBe('legacy');
    expect(rotated.encryptString('new').split('.')[1]).toBe('k2');
    expect(rotated.keyIdOf(old)).toBe('k1');
    expect(rotated.keyIdOf(rotated.encryptBuffer(Buffer.from('x')))).toBe('k2');
    expect(rotated.keyIdOf(rotated.encryptString(rotated.decryptString(old, 'r'), 'r'))).toBe('k2');
  });

  it('validates key configuration', () => {
    expect(() => new DataCipher('k1:c2hvcnQ=', 'k1')).toThrow(/32 bytes/);
    expect(() => new DataCipher(`k1:${k1}`, 'k9')).toThrow(/not found/);
  });
});

describe('hash helpers', () => {
  it('sha256 and hmac are deterministic', () => {
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(hmac('s', 'd')).toBe(hmac('s', 'd'));
    expect(hmac('s', 'd')).not.toBe(hmac('t', 'd'));
  });

  it('timingSafeEqualStr handles different lengths', () => {
    expect(timingSafeEqualStr('abc', 'abc')).toBe(true);
    expect(timingSafeEqualStr('abc', 'abcd')).toBe(false);
  });
});
