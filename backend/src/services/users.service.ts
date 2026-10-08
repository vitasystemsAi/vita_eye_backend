import { Op, type WhereOptions } from 'sequelize';
import { RefreshToken, Role, User, sequelize } from '../models';
import { AppError } from '../utils/errors';
import { hashPassword } from '../utils/password';
import { pageMeta } from '../utils/http';
import { canAssignRole, type RoleName } from '../config/rbac';
import { audit } from './audit.service';
import { syncClientPassword } from './clientCredentials.service';
import { roleByName } from './rbac.service';
import { isEmailTaken, registerDirectoryEntry } from './tenancy.service';
import type { AuthContext } from '../types/auth';

function present(u: User) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role?.name ?? null,
    status: u.status,
    siteScope: u.siteScope ?? null,
    lastLoginAt: u.lastLoginAt,
    lockedUntil: u.lockedUntil && u.lockedUntil > new Date() ? u.lockedUntil : null,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  };
}

export async function listUsers(
  ctx: AuthContext,
  q: { page: number; pageSize: number; order: 'asc' | 'desc'; search?: string; role?: RoleName; status?: 'ACTIVE' | 'DISABLED' },
) {
  const where: WhereOptions<User> = { organizationId: ctx.organizationId };
  if (q.status) Object.assign(where, { status: q.status });
  if (q.search) {
    Object.assign(where, { [Op.or]: [{ name: { [Op.like]: `%${q.search}%` } }, { email: { [Op.like]: `%${q.search}%` } }] });
  }
  const { rows, count } = await User.findAndCountAll({
    where,
    include: [{ model: Role, as: 'role', ...(q.role ? { where: { name: q.role } } : {}) }],
    order: [['createdAt', q.order]],
    limit: q.pageSize,
    offset: (q.page - 1) * q.pageSize,
  });
  return { items: rows.map(present), meta: pageMeta(q.page, q.pageSize, count) };
}

export async function createUser(
  ctx: AuthContext,
  input: { name: string; email: string; password: string; role: RoleName; siteScope?: string[] | null },
  ip: string | null,
) {
  if (!canAssignRole(ctx.role, input.role)) throw AppError.forbidden('You cannot assign this role');
  const role = await roleByName(input.role);
  if (!role) throw AppError.badRequest('Unknown role');
  if (await isEmailTaken(input.email)) throw AppError.conflict('A user with this email already exists');
  const passwordHash = await hashPassword(input.password);
  return sequelize.transaction(async (transaction) => {
    const user = await User.create(
      {
        name: input.name,
        email: input.email,
        passwordHash,
        roleId: role.id,
        organizationId: ctx.organizationId,
        siteScope: input.siteScope?.length ? input.siteScope : null,
      },
      { transaction },
    );
    await registerDirectoryEntry(ctx.organizationId, user.id, input.email, transaction);
    await audit(
      { organizationId: ctx.organizationId, userId: ctx.userId, action: 'USER_CREATED', entityType: 'user', entityId: user.id, ipAddress: ip, metadata: { email: input.email, role: input.role } },
      transaction,
    );
    const fresh = await User.findByPk(user.id, { include: [{ model: Role, as: 'role' }], transaction });
    return present(fresh!);
  });
}

export async function updateUser(
  ctx: AuthContext,
  id: string,
  input: { name?: string; role?: RoleName; status?: 'ACTIVE' | 'DISABLED'; password?: string; siteScope?: string[] | null },
  ip: string | null,
) {
  const user = await User.findOne({ where: { id, organizationId: ctx.organizationId }, include: [{ model: Role, as: 'role' }] });
  if (!user) throw AppError.notFound('User');
  const currentRole = user.role!.name;

  if (currentRole === 'SUPER_ADMIN' && ctx.role !== 'SUPER_ADMIN') throw AppError.forbidden('Only a Super Admin can modify a Super Admin');
  if (input.role && !canAssignRole(ctx.role, input.role)) throw AppError.forbidden('You cannot assign this role');
  if (id === ctx.userId && (input.status === 'DISABLED' || (input.role && input.role !== currentRole))) {
    throw AppError.badRequest('You cannot disable your own account or change your own role');
  }

  const changes: Partial<{ name: string; roleId: number; status: 'ACTIVE' | 'DISABLED'; passwordHash: string; siteScope: string[] | null }> = {};
  if (input.name) changes.name = input.name;
  if (input.status) changes.status = input.status;
  if (input.siteScope !== undefined) changes.siteScope = input.siteScope?.length ? input.siteScope : null;
  if (input.password) changes.passwordHash = await hashPassword(input.password);
  if (input.role) {
    const role = await roleByName(input.role);
    if (!role) throw AppError.badRequest('Unknown role');
    changes.roleId = role.id;
  }

  return sequelize.transaction(async (transaction) => {
    // Keep at least one active Super Admin in every organization.
    if (currentRole === 'SUPER_ADMIN' && (changes.status === 'DISABLED' || (input.role && input.role !== 'SUPER_ADMIN'))) {
      const superRole = await roleByName('SUPER_ADMIN');
      const others = await User.count({
        where: { organizationId: ctx.organizationId, roleId: superRole!.id, status: 'ACTIVE', id: { [Op.ne]: id } },
        transaction,
      });
      if (others === 0) throw AppError.badRequest('At least one active Super Admin is required');
    }
    await user.update(changes, { transaction });
    if (changes.status === 'DISABLED' || changes.passwordHash || changes.roleId) {
      await RefreshToken.update({ revokedAt: new Date() }, { where: { userId: id, revokedAt: null }, transaction });
    }
    if (input.password) await syncClientPassword(id, input.password, ctx.email, transaction);
    await audit(
      {
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        action: 'USER_UPDATED',
        entityType: 'user',
        entityId: id,
        ipAddress: ip,
        metadata: { fields: Object.keys(input).filter((k) => k !== 'password'), passwordChanged: Boolean(input.password), role: input.role },
      },
      transaction,
    );
    const fresh = await User.findByPk(id, { include: [{ model: Role, as: 'role' }], transaction });
    return present(fresh!);
  });
}
