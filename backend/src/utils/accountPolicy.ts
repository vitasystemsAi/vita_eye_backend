import type { OrganizationStatus } from '../models/Organization';

export type AccountAction = 'ACTIVATE' | 'SUSPEND' | 'HOLD' | 'REACTIVATE' | 'DEACTIVATE' | 'ARCHIVE';
export type HoldPolicy = 'ACCOUNT' | 'LEGAL' | 'INVESTIGATION';

/** Organizations whose dedicated database exists and can be inspected. */
export const PROVISIONED_STATUSES: readonly OrganizationStatus[] = ['ACTIVE', 'SUSPENDED', 'ON_HOLD', 'DEACTIVATED', 'ARCHIVED'];

export function streamsAllowed(status: OrganizationStatus): boolean {
  return status === 'ACTIVE';
}

/** Ordinary user sessions. Platform "view as" is decided separately. */
export function loginAllowed(status: OrganizationStatus): boolean {
  return status === 'ACTIVE';
}

export function impersonationAllowed(status: OrganizationStatus): boolean {
  return PROVISIONED_STATUSES.includes(status);
}

/** Account suspension does not skip cleanup. Legal and investigation holds do. */
export function retentionRuns(status: OrganizationStatus): boolean {
  return PROVISIONED_STATUSES.includes(status);
}

export function canRetryProvisioning(status: OrganizationStatus): boolean {
  return status === 'FAILED';
}

export function statusForAction(action: AccountAction): OrganizationStatus {
  switch (action) {
    case 'ACTIVATE':
    case 'REACTIVATE':
      return 'ACTIVE';
    case 'SUSPEND':
      return 'SUSPENDED';
    case 'HOLD':
      return 'ON_HOLD';
    case 'DEACTIVATE':
      return 'DEACTIVATED';
    case 'ARCHIVE':
      return 'ARCHIVED';
  }
}

export function actionBlocksAccess(action: AccountAction): boolean {
  return action !== 'ACTIVATE' && action !== 'REACTIVATE';
}

/** Legal and investigation holds pause destructive cleanup. An account hold does not. */
export function holdPausesCleanup(policy: HoldPolicy | null | undefined): boolean {
  return policy === 'LEGAL' || policy === 'INVESTIGATION';
}

export function loginBlockMessage(status: OrganizationStatus): string {
  switch (status) {
    case 'SUSPENDED':
      return 'This organization is suspended. Data is retained. Contact VITA Systems support.';
    case 'ON_HOLD':
      return 'This organization is on hold. Contact VITA Systems support.';
    case 'DEACTIVATED':
      return 'This organization is deactivated. Contact VITA Systems support.';
    case 'ARCHIVED':
      return 'This organization is archived.';
    default:
      return 'This account is disabled. Contact your administrator.';
  }
}
