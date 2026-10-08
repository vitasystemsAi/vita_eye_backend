import type { Transaction } from 'sequelize';
import { ClientCredential } from '../models';
import { cipher } from '../utils/cipher';

const aad = (organizationId: string, userId: string) => `client_credential:${organizationId}:${userId}`;

/** Stores (or replaces) the recoverable password of an organization's primary admin account. */
export async function storeClientPassword(
  input: { organizationId: string; userId: string; email: string; password: string; updatedBy: string | null },
  transaction?: Transaction,
) {
  await ClientCredential.upsert(
    {
      organizationId: input.organizationId,
      userId: input.userId,
      email: input.email,
      encryptedPassword: cipher.encryptString(input.password, aad(input.organizationId, input.userId)),
      updatedBy: input.updatedBy,
    },
    { transaction },
  );
}

/** Keeps the vault in sync when a tracked admin changes their own password. */
export async function syncClientPassword(userId: string, password: string, updatedBy: string | null, transaction?: Transaction) {
  const row = await ClientCredential.findOne({ where: { userId }, transaction });
  if (!row) return;
  await row.update({ encryptedPassword: cipher.encryptString(password, aad(row.organizationId, userId)), updatedBy }, { transaction });
}

export async function revealClientPassword(organizationId: string): Promise<{ email: string; userId: string; password: string; updatedAt: Date } | null> {
  const row = await ClientCredential.scope('withSecret').findByPk(organizationId);
  if (!row) return null;
  return { email: row.email, userId: row.userId, password: cipher.decryptString(row.encryptedPassword, aad(organizationId, row.userId)), updatedAt: row.updatedAt };
}
