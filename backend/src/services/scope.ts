import { Op, type WhereOptions } from 'sequelize';
import type { Camera } from '../models';
import { AppError } from '../utils/errors';
import type { AuthContext } from '../types/auth';

/** Site-scoped users may only see cameras whose `site` is in their scope. */
export function cameraScopeWhere(ctx: AuthContext): WhereOptions<Camera> {
  const where: Record<string | symbol, unknown> = { organizationId: ctx.organizationId };
  if (ctx.siteScope) where.site = { [Op.in]: ctx.siteScope };
  return where as WhereOptions<Camera>;
}

export function cameraInScope(ctx: AuthContext, camera: Pick<Camera, 'organizationId' | 'site'> | null): boolean {
  if (!camera || camera.organizationId !== ctx.organizationId) return false;
  if (!ctx.siteScope) return true;
  return camera.site !== null && ctx.siteScope.includes(camera.site);
}

export function assertCameraInScope(ctx: AuthContext, camera: Pick<Camera, 'organizationId' | 'site'> | null) {
  if (!cameraInScope(ctx, camera)) throw AppError.notFound('Camera');
}
