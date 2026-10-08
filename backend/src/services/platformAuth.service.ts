import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { PlatformAdmin, PlatformAuditLog } from '../models';
import { AppError } from '../utils/errors';
import { randomToken } from '../utils/crypto';
import { hashPassword, needsRehash, verifyPassword } from '../utils/password';
import type { PlatformAdminContext } from '../types/auth';

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const AUDIENCE = 'vita-eye-platform';

interface PlatformClaims {
  sub: string;
  /** PlatformAdmin.tokenVersion at issue time; bumping it revokes every outstanding session. */
  tv: number;
}

let dummyHash: Promise<string> | null = null;

export const platformSessionSeconds = () => env.PLATFORM_SESSION_TTL_HOURS * 3600;

export async function platformAudit(entry: {
  platformAdminId: string | null;
  organizationId?: string | null;
  action: string;
  ipAddress: string | null;
  metadata?: Record<string, unknown> | null;
}) {
  await PlatformAuditLog.create({
    platformAdminId: entry.platformAdminId,
    organizationId: entry.organizationId ?? null,
    action: entry.action,
    ipAddress: entry.ipAddress,
    metadata: entry.metadata ?? null,
  });
}

function signPlatformToken(admin: PlatformAdmin) {
  const claims: PlatformClaims = { sub: admin.id, tv: admin.tokenVersion };
  return jwt.sign(claims, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    expiresIn: platformSessionSeconds(),
    issuer: 'vita-eye',
    audience: AUDIENCE,
  });
}

const present = (a: PlatformAdmin): PlatformAdminContext => ({ id: a.id, name: a.name, email: a.email });

export async function platformLogin(emailRaw: string, password: string, ip: string | null) {
  const email = emailRaw.trim().toLowerCase();
  const admin = await PlatformAdmin.scope('withSecrets').findOne({ where: { email } });
  if (!admin) {
    dummyHash ??= hashPassword(randomToken(16));
    await verifyPassword(await dummyHash, password);
    await platformAudit({ platformAdminId: null, action: 'PLATFORM_LOGIN_FAILED', ipAddress: ip, metadata: { reason: 'unknown_email' } });
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  }
  if (admin.lockedUntil && admin.lockedUntil > new Date()) {
    await platformAudit({ platformAdminId: admin.id, action: 'PLATFORM_LOGIN_BLOCKED_LOCKED', ipAddress: ip });
    throw new AppError(423, 'ACCOUNT_LOCKED', 'Account temporarily locked after repeated failed attempts. Try again later.');
  }
  if (!(await verifyPassword(admin.passwordHash, password))) {
    const attempts = admin.failedLoginAttempts + 1;
    const lock = attempts >= MAX_FAILED_ATTEMPTS;
    await admin.update({
      failedLoginAttempts: lock ? 0 : attempts,
      lockedUntil: lock ? new Date(Date.now() + LOCK_MINUTES * 60_000) : admin.lockedUntil,
    });
    await platformAudit({ platformAdminId: admin.id, action: lock ? 'PLATFORM_ACCOUNT_LOCKED' : 'PLATFORM_LOGIN_FAILED', ipAddress: ip, metadata: { attempts } });
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  }
  if (admin.status !== 'ACTIVE') {
    await platformAudit({ platformAdminId: admin.id, action: 'PLATFORM_LOGIN_BLOCKED_DISABLED', ipAddress: ip });
    throw new AppError(403, 'ACCOUNT_DISABLED', 'This platform account is disabled.');
  }
  const updates: Partial<{ failedLoginAttempts: number; lockedUntil: Date | null; lastLoginAt: Date; passwordHash: string }> = {
    failedLoginAttempts: 0,
    lockedUntil: null,
    lastLoginAt: new Date(),
  };
  if (needsRehash(admin.passwordHash)) updates.passwordHash = await hashPassword(password);
  await admin.update(updates);
  await platformAudit({ platformAdminId: admin.id, action: 'PLATFORM_LOGIN_SUCCESS', ipAddress: ip });
  return { admin: present(admin), token: signPlatformToken(admin) };
}

/** Resolves a platform session cookie to its admin, or null when invalid, expired or revoked. */
export async function verifyPlatformSession(token: string): Promise<PlatformAdminContext | null> {
  let claims: PlatformClaims;
  try {
    claims = jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'], issuer: 'vita-eye', audience: AUDIENCE }) as PlatformClaims;
  } catch {
    return null;
  }
  const admin = await PlatformAdmin.findByPk(claims.sub);
  if (!admin || admin.status !== 'ACTIVE' || admin.tokenVersion !== claims.tv) return null;
  return present(admin);
}

/** Signs out every session of this admin (sessions are stateless JWTs bound to tokenVersion). */
export async function platformLogout(adminId: string, ip: string | null) {
  await PlatformAdmin.increment('tokenVersion', { where: { id: adminId } });
  await platformAudit({ platformAdminId: adminId, action: 'PLATFORM_LOGOUT', ipAddress: ip });
}
