import crypto from 'node:crypto';

/**
 * Versioned AES-256-GCM encryption used for biometric templates, camera credentials and evidence.
 *
 * Text format:   v1.<keyId>.<iv b64>.<tag b64>.<ciphertext b64>
 * Binary format: "VE1" | keyIdLen(1) | keyId | iv(12) | tag(16) | ciphertext
 *
 * Keys come from DATA_ENCRYPTION_KEYS ("k1:base64,k2:base64"); the active key encrypts new data
 * and retired keys remain available for decryption, enabling rotation without downtime.
 * In production, source these keys from a KMS / secret manager (envelope encryption).
 */
export class DataCipher {
  private readonly keys = new Map<string, Buffer>();

  constructor(
    keySpec: string,
    private readonly activeKeyId: string,
  ) {
    for (const part of keySpec.split(',').map((s) => s.trim()).filter(Boolean)) {
      const idx = part.indexOf(':');
      if (idx <= 0) throw new Error('DATA_ENCRYPTION_KEYS entries must be keyId:base64');
      const id = part.slice(0, idx);
      if (!/^[A-Za-z0-9_-]{1,32}$/.test(id)) throw new Error(`Invalid encryption key id "${id}"`);
      const key = Buffer.from(part.slice(idx + 1), 'base64');
      if (key.length !== 32) throw new Error(`Encryption key "${id}" must be 32 bytes (base64 encoded)`);
      this.keys.set(id, key);
    }
    if (!this.keys.has(activeKeyId)) throw new Error(`Active encryption key "${activeKeyId}" not found in DATA_ENCRYPTION_KEYS`);
  }

  private key(id: string): Buffer {
    const k = this.keys.get(id);
    if (!k) throw new Error(`Unknown encryption key id "${id}"`);
    return k;
  }

  get activeKey(): string {
    return this.activeKeyId;
  }

  /** Key id a ciphertext (text or binary format) was encrypted with. */
  keyIdOf(payload: string | Buffer): string {
    if (typeof payload === 'string') return payload.split('.')[1] ?? '';
    if (payload.subarray(0, 3).toString() !== 'VE1') throw new Error('Unsupported ciphertext format');
    return payload.subarray(4, 4 + payload[3]).toString();
  }

  encryptBuffer(plain: Buffer, aad?: string): Buffer {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key(this.activeKeyId), iv);
    if (aad) cipher.setAAD(Buffer.from(aad));
    const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
    const tag = cipher.getAuthTag();
    const kid = Buffer.from(this.activeKeyId);
    return Buffer.concat([Buffer.from('VE1'), Buffer.from([kid.length]), kid, iv, tag, ct]);
  }

  decryptBuffer(blob: Buffer, aad?: string): Buffer {
    if (blob.subarray(0, 3).toString() !== 'VE1') throw new Error('Unsupported ciphertext format');
    const kidLen = blob[3];
    let o = 4;
    const kid = blob.subarray(o, o + kidLen).toString();
    o += kidLen;
    const iv = blob.subarray(o, o + 12);
    o += 12;
    const tag = blob.subarray(o, o + 16);
    o += 16;
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key(kid), iv);
    if (aad) decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(blob.subarray(o)), decipher.final()]);
  }

  encryptString(plain: string, aad?: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key(this.activeKeyId), iv);
    if (aad) cipher.setAAD(Buffer.from(aad));
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return ['v1', this.activeKeyId, iv.toString('base64'), cipher.getAuthTag().toString('base64'), ct.toString('base64')].join('.');
  }

  decryptString(payload: string, aad?: string): string {
    const [ver, kid, iv, tag, ct] = payload.split('.');
    if (ver !== 'v1' || !kid || !iv || !tag || ct === undefined) throw new Error('Unsupported ciphertext format');
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key(kid), Buffer.from(iv, 'base64'));
    if (aad) decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ct, 'base64')), decipher.final()]).toString('utf8');
  }

  /** Float32 embedding <-> encrypted string; AAD binds the ciphertext to its template row. */
  encryptEmbedding(embedding: number[], aad: string): string {
    const buf = Buffer.from(new Float32Array(embedding).buffer);
    return this.encryptString(buf.toString('base64'), aad);
  }

  decryptEmbedding(payload: string, aad: string): number[] {
    const buf = Buffer.from(this.decryptString(payload, aad), 'base64');
    return Array.from(new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4));
  }
}

export function sha256(data: Buffer | string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export function hmac(secret: string, data: string): string {
  return crypto.createHmac('sha256', secret).update(data).digest('base64url');
}
