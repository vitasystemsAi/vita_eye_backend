import type { Transaction } from 'sequelize';
import { AuditLog } from '../models';
import { logger } from '../config/logger';
import { currentTenant } from '../db/tenantContext';

export interface AuditEntry {
  organizationId: string | null;
  userId?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  ipAddress?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * Persist an audit record. Inside a transaction a failure aborts the business operation (the audit
 * trail is mandatory for biometric changes); outside a transaction failures are logged, not thrown.
 */
export async function audit(entry: AuditEntry, transaction?: Transaction): Promise<void> {
  const impersonatedBy = currentTenant()?.impersonatedBy;
  const row = {
    organizationId: entry.organizationId,
    userId: entry.userId ?? null,
    action: entry.action,
    entityType: entry.entityType ?? null,
    entityId: entry.entityId ?? null,
    ipAddress: entry.ipAddress ?? null,
    metadata: impersonatedBy ? { ...(entry.metadata ?? {}), impersonatedBy } : (entry.metadata ?? null),
  };
  if (transaction) {
    await AuditLog.create(row, { transaction });
    return;
  }
  try {
    await AuditLog.create(row);
  } catch (err) {
    logger.error({ err, action: entry.action }, 'Failed to write audit log');
  }
}
