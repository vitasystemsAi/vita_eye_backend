import type { Transaction } from 'sequelize';
import { ClientCredential } from '../models';

/**
 * Records which user is the organization's primary admin.
 * The password itself is never stored. Reset uses a one-time link.
 */
export async function rememberClientAdmin(
  input: { organizationId: string; userId: string; email: string; updatedBy: string | null },
  transaction?: Transaction,
) {
  await ClientCredential.upsert(
    {
      organizationId: input.organizationId,
      userId: input.userId,
      email: input.email,
      encryptedPassword: null,
      updatedBy: input.updatedBy,
    },
    { transaction },
  );
}

/** Drops any legacy recoverable password when the account holder sets a new one. */
export async function forgetClientPassword(userId: string, transaction?: Transaction) {
  await ClientCredential.update({ encryptedPassword: null }, { where: { userId }, transaction });
}
