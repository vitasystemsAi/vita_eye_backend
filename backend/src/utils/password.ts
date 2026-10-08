import argon2 from 'argon2';

// OWASP-recommended Argon2id parameters (19 MiB, t=2, p=1) raised for a server workload.
const OPTIONS = { type: argon2.argon2id, memoryCost: 64 * 1024, timeCost: 3, parallelism: 1 } as const;

export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, OPTIONS);
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

export function needsRehash(hash: string): boolean {
  return argon2.needsRehash(hash, OPTIONS);
}

/** Enforced on user creation and password reset. */
export const PASSWORD_POLICY = {
  minLength: 12,
  regex: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{12,128}$/,
  message: 'Password must be 12-128 characters and include upper-case, lower-case and a digit',
};
