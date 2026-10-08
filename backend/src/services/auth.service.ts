import jwt from 'jsonwebtoken';
import { Op } from 'sequelize';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { enabledFeatures, filterPermissions } from '../config/features';
import { Organization, PasswordResetToken, RefreshToken, User, sequelize } from '../models';
import type { OrganizationStatus } from '../models/Organization';
import { AppError } from '../utils/errors';
import { randomToken, sha256 } from '../utils/crypto';
import { hashPassword, needsRehash, verifyPassword } from '../utils/password';
import { audit } from './audit.service';
import { roleById } from './rbac.service';
import { emailConfigured, escapeHtml, sendEmail } from './email.service';
import { syncClientPassword } from './clientCredentials.service';
import { organizationForEmail, runInTenant } from './tenancy.service';
import type { AuthContext } from '../types/auth';

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const RESET_TOKEN_MINUTES = 30;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AccessClaims {
  sub: string;
  org: string;
  sid: string;
  /** Platform admin email for "view as" sessions. */
  imp?: string;
}

interface ClientInfo {
  ip: string | null;
  userAgent: string | null;
}

// Hash computed once so that unknown-email logins spend the same time verifying as real ones.
let dummyHash: Promise<string> | null = null;

export function signAccessToken(claims: AccessClaims): string {
  return jwt.sign(claims, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    expiresIn: env.JWT_ACCESS_TTL_SECONDS,
    issuer: 'vita-eye',
    audience: 'vita-eye-app',
  });
}

export function verifyAccessToken(token: string): AccessClaims {
  return jwt.verify(token, env.JWT_ACCESS_SECRET, {
    algorithms: ['HS256'],
    issuer: 'vita-eye',
    audience: 'vita-eye-app',
  }) as AccessClaims;
}

/**
 * Refresh and reset tokens are prefixed with the organization id ("<orgId>.<secret>") so the
 * database that stores their hash can be found before the token is looked up. Tokens issued before
 * multi-database tenancy have no prefix and live in the primary database.
 */
function withOrgPrefix(organizationId: string, secret: string) {
  return `${organizationId}.${secret}`;
}

export function organizationFromToken(token: string | undefined): string | null {
  const prefix = token?.split('.', 1)[0];
  return prefix && token!.includes('.') && UUID_RE.test(prefix) ? prefix : null;
}

/** Held (suspended) organizations stay reachable only through platform "view as" sessions. */
function organizationUsable(status: OrganizationStatus | undefined, impersonatedBy: string | null | undefined) {
  return status === 'ACTIVE' || (Boolean(impersonatedBy) && status === 'SUSPENDED');
}

/** Creates a session in the current tenant database. */
export async function issueSession(user: User, client: ClientInfo, impersonatedBy: string | null = null) {
  const refreshToken = withOrgPrefix(user.organizationId, randomToken(48));
  const session = await RefreshToken.create({
    userId: user.id,
    tokenHash: sha256(refreshToken),
    userAgent: client.userAgent?.slice(0, 255) ?? null,
    ipAddress: client.ip,
    expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86400_000),
    impersonatedBy,
  });
  const accessToken = signAccessToken({ sub: user.id, org: user.organizationId, sid: session.id, ...(impersonatedBy ? { imp: impersonatedBy } : {}) });
  return { accessToken, refreshToken };
}

/** Load a fresh auth context for a user id (used by middleware and sockets). Call inside the tenant context. */
export async function buildAuthContext(
  userId: string,
  sessionId: string | null,
  opts: { impersonatedBy?: string | null } = {},
): Promise<AuthContext | null> {
  const user = await User.findByPk(userId, { include: [{ model: Organization, as: 'organization' }] });
  if (!user || user.status !== 'ACTIVE' || !organizationUsable(user.organization?.status, opts.impersonatedBy)) return null;
  const role = await roleById(user.roleId);
  if (!role) return null;
  const features = enabledFeatures(user.organization?.features);
  return {
    userId: user.id,
    organizationId: user.organizationId,
    name: user.name,
    email: user.email,
    role: role.name,
    permissions: filterPermissions(role.permissions, features),
    features,
    siteScope: Array.isArray(user.siteScope) && user.siteScope.length ? user.siteScope : null,
    sessionId,
    impersonatedBy: opts.impersonatedBy ?? null,
  };
}

export async function login(emailRaw: string, password: string, client: ClientInfo) {
  const email = emailRaw.trim().toLowerCase();
  const organizationId = await organizationForEmail(email);
  return runInTenant(organizationId, () => loginInCurrentTenant(email, password, client));
}

async function loginInCurrentTenant(email: string, password: string, client: ClientInfo) {
  const user = await User.scope('withSecrets').findOne({
    where: { email },
    include: [{ model: Organization, as: 'organization' }],
  });

  if (!user) {
    dummyHash ??= hashPassword(randomToken(16));
    await verifyPassword(await dummyHash, password);
    await audit({ organizationId: null, action: 'LOGIN_FAILED', entityType: 'user', ipAddress: client.ip, metadata: { reason: 'unknown_email' } });
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    await audit({ organizationId: user.organizationId, userId: user.id, action: 'LOGIN_BLOCKED_LOCKED', entityType: 'user', entityId: user.id, ipAddress: client.ip });
    throw new AppError(423, 'ACCOUNT_LOCKED', 'Account temporarily locked after repeated failed attempts. Try again later.');
  }

  const valid = await verifyPassword(user.passwordHash, password);
  if (!valid) {
    const attempts = user.failedLoginAttempts + 1;
    const lock = attempts >= MAX_FAILED_ATTEMPTS;
    await user.update({
      failedLoginAttempts: lock ? 0 : attempts,
      lockedUntil: lock ? new Date(Date.now() + LOCK_MINUTES * 60_000) : user.lockedUntil,
    });
    await audit({
      organizationId: user.organizationId,
      userId: user.id,
      action: lock ? 'ACCOUNT_LOCKED' : 'LOGIN_FAILED',
      entityType: 'user',
      entityId: user.id,
      ipAddress: client.ip,
      metadata: { attempts },
    });
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  }

  if (user.organization?.status === 'SUSPENDED') {
    await audit({ organizationId: user.organizationId, userId: user.id, action: 'LOGIN_BLOCKED_ON_HOLD', entityType: 'user', entityId: user.id, ipAddress: client.ip });
    throw new AppError(403, 'ORGANIZATION_ON_HOLD', 'This organization account is on hold. Contact VITA Systems support.');
  }
  if (user.status !== 'ACTIVE' || user.organization?.status !== 'ACTIVE') {
    await audit({ organizationId: user.organizationId, userId: user.id, action: 'LOGIN_BLOCKED_DISABLED', entityType: 'user', entityId: user.id, ipAddress: client.ip });
    throw new AppError(403, 'ACCOUNT_DISABLED', 'This account is disabled. Contact your administrator.');
  }

  const updates: Partial<{ failedLoginAttempts: number; lockedUntil: Date | null; lastLoginAt: Date; passwordHash: string }> = {
    failedLoginAttempts: 0,
    lockedUntil: null,
    lastLoginAt: new Date(),
  };
  if (needsRehash(user.passwordHash)) updates.passwordHash = await hashPassword(password);
  await user.update(updates);

  const tokens = await issueSession(user, client);
  await audit({ organizationId: user.organizationId, userId: user.id, action: 'LOGIN_SUCCESS', entityType: 'user', entityId: user.id, ipAddress: client.ip });
  return { userId: user.id, organizationId: user.organizationId, ...tokens };
}

export async function refresh(refreshToken: string, client: ClientInfo) {
  return runInTenant(organizationFromToken(refreshToken), async () => {
    const existing = await RefreshToken.findOne({ where: { tokenHash: sha256(refreshToken) } });
    if (!existing) throw new AppError(401, 'UNAUTHENTICATED', 'Session expired');

    if (existing.revokedAt) {
      // A rotated token was replayed: assume theft and revoke every session of this user.
      await RefreshToken.update({ revokedAt: new Date() }, { where: { userId: existing.userId, revokedAt: null } });
      const u = await User.findByPk(existing.userId);
      await audit({ organizationId: u?.organizationId ?? null, userId: existing.userId, action: 'REFRESH_TOKEN_REUSE', entityType: 'user', entityId: existing.userId, ipAddress: client.ip });
      throw new AppError(401, 'UNAUTHENTICATED', 'Session revoked');
    }
    if (existing.expiresAt < new Date()) throw new AppError(401, 'UNAUTHENTICATED', 'Session expired');

    const user = await User.findByPk(existing.userId, { include: [{ model: Organization, as: 'organization' }] });
    if (!user || user.status !== 'ACTIVE' || !organizationUsable(user.organization?.status, existing.impersonatedBy)) {
      await existing.update({ revokedAt: new Date() });
      throw new AppError(401, 'UNAUTHENTICATED', 'Session revoked');
    }

    return sequelize.transaction(async (transaction) => {
      const [count] = await RefreshToken.update(
        { revokedAt: new Date() },
        { where: { id: existing.id, revokedAt: null }, transaction },
      );
      if (count !== 1) throw new AppError(401, 'UNAUTHENTICATED', 'Session already refreshed');
      const next = withOrgPrefix(user.organizationId, randomToken(48));
      const session = await RefreshToken.create(
        {
          userId: user.id,
          tokenHash: sha256(next),
          userAgent: client.userAgent?.slice(0, 255) ?? null,
          ipAddress: client.ip,
          expiresAt: existing.expiresAt,
          impersonatedBy: existing.impersonatedBy,
        },
        { transaction },
      );
      const imp = existing.impersonatedBy;
      return {
        userId: user.id,
        refreshToken: next,
        accessToken: signAccessToken({ sub: user.id, org: user.organizationId, sid: session.id, ...(imp ? { imp } : {}) }),
      };
    });
  });
}

export async function logout(refreshToken: string | undefined, ctx: AuthContext | undefined, ip: string | null) {
  await runInTenant(organizationFromToken(refreshToken) ?? ctx?.organizationId ?? null, async () => {
    if (refreshToken) {
      await RefreshToken.update({ revokedAt: new Date() }, { where: { tokenHash: sha256(refreshToken), revokedAt: null } });
    }
    if (ctx) {
      await audit({ organizationId: ctx.organizationId, userId: ctx.userId, action: 'LOGOUT', entityType: 'user', entityId: ctx.userId, ipAddress: ip });
    }
  });
}

export async function requestPasswordReset(emailRaw: string, ip: string | null): Promise<void> {
  const email = emailRaw.trim().toLowerCase();
  const organizationId = await organizationForEmail(email);
  const token = await runInTenant(organizationId, async () => {
    const user = await User.findOne({ where: { email, status: 'ACTIVE' } });
    if (!user) return null;
    const secret = withOrgPrefix(user.organizationId, randomToken(32));
    await PasswordResetToken.update({ usedAt: new Date() }, { where: { userId: user.id, usedAt: null } });
    await PasswordResetToken.create({
      userId: user.id,
      tokenHash: sha256(secret),
      expiresAt: new Date(Date.now() + RESET_TOKEN_MINUTES * 60_000),
    });
    await audit({ organizationId: user.organizationId, userId: user.id, action: 'PASSWORD_RESET_REQUESTED', entityType: 'user', entityId: user.id, ipAddress: ip });
    return secret;
  });
  if (!token) return;

  const link = `${env.PUBLIC_APP_URL.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(token)}`;
  if (!emailConfigured()) {
    if (!env.isProduction) {
      logger.warn({ email }, `SMTP not configured — development password reset link: ${link}`);
    } else {
      logger.error({ email }, 'Password reset requested but SMTP is not configured');
    }
    return;
  }
  try {
    await sendEmail(
      email,
      'VITA EYE password reset',
      `A password reset was requested for your VITA EYE account.\n\nReset link (valid ${RESET_TOKEN_MINUTES} minutes): ${link}\n\nIf you did not request this, ignore this email.`,
      `<p>A password reset was requested for your VITA EYE account.</p><p><a href="${escapeHtml(link)}">Reset your password</a> (valid ${RESET_TOKEN_MINUTES} minutes).</p><p>If you did not request this, ignore this email.</p>`,
    );
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'Failed to send password reset email');
  }
}

export async function resetPassword(token: string, newPassword: string, ip: string | null): Promise<void> {
  await runInTenant(organizationFromToken(token), async () => {
    const row = await PasswordResetToken.findOne({
      where: { tokenHash: sha256(token), usedAt: null, expiresAt: { [Op.gt]: new Date() } },
    });
    if (!row) throw AppError.badRequest('This reset link is invalid or has expired');
    const user = await User.findByPk(row.userId);
    if (!user) throw AppError.badRequest('This reset link is invalid or has expired');

    const passwordHash = await hashPassword(newPassword);
    await sequelize.transaction(async (transaction) => {
      await row.update({ usedAt: new Date() }, { transaction });
      await User.update({ passwordHash, failedLoginAttempts: 0, lockedUntil: null }, { where: { id: user.id }, transaction });
      await RefreshToken.update({ revokedAt: new Date() }, { where: { userId: user.id, revokedAt: null }, transaction });
      await syncClientPassword(user.id, newPassword, user.email, transaction);
      await audit({ organizationId: user.organizationId, userId: user.id, action: 'PASSWORD_RESET_COMPLETED', entityType: 'user', entityId: user.id, ipAddress: ip }, transaction);
    });
  });
}
