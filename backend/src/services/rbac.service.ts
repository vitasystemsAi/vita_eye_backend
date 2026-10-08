import { Permission as PermissionModel, Role } from '../models';
import type { Permission, RoleName } from '../config/rbac';

interface RoleInfo {
  id: number;
  name: RoleName;
  permissions: Set<Permission>;
}

let cache: { byId: Map<number, RoleInfo>; byName: Map<RoleName, RoleInfo>; loadedAt: number } | null = null;
const TTL_MS = 60_000;

async function load() {
  const roles = await Role.findAll({ include: [{ model: PermissionModel, as: 'permissions', through: { attributes: [] } }] });
  const byId = new Map<number, RoleInfo>();
  const byName = new Map<RoleName, RoleInfo>();
  for (const r of roles) {
    const info: RoleInfo = {
      id: r.id,
      name: r.name,
      permissions: new Set((r.permissions ?? []).map((p) => p.name as Permission)),
    };
    byId.set(r.id, info);
    byName.set(r.name, info);
  }
  cache = { byId, byName, loadedAt: Date.now() };
  return cache;
}

async function getCache() {
  if (!cache || Date.now() - cache.loadedAt > TTL_MS) return load();
  return cache;
}

export async function roleById(id: number): Promise<RoleInfo | undefined> {
  return (await getCache()).byId.get(id);
}

export async function roleByName(name: RoleName): Promise<RoleInfo | undefined> {
  return (await getCache()).byName.get(name);
}

export async function listRoles(): Promise<RoleInfo[]> {
  return [...(await getCache()).byId.values()];
}
