export type PersonStatus = 'ACTIVE' | 'SUSPENDED' | 'INACTIVE';

/** Suspended and inactive registrations stay for a week before permanent deletion is offered. */
export const DELETE_HOLD_MS = 7 * 24 * 60 * 60 * 1000;

/** A registration with no face can be removed at once. Enrolled faces stay on the 7-day hold. */
export function canDiscardRegistration(enrollmentStatus: string, templateCount: number) {
  return templateCount === 0 && (enrollmentStatus === 'PENDING' || enrollmentStatus === 'FAILED');
}

export function deletionHold(status: PersonStatus, statusChangedAt: Date | string | null | undefined, now = Date.now()) {
  if (status === 'ACTIVE' || !statusChangedAt) {
    return { canDelete: false, deleteAvailableAt: null as string | null };
  }
  const available = new Date(statusChangedAt).getTime() + DELETE_HOLD_MS;
  return { canDelete: now >= available, deleteAvailableAt: new Date(available).toISOString() };
}

export function statusAuditAction(from: PersonStatus, to: PersonStatus) {
  if (to === 'SUSPENDED') return 'PERSON_SUSPENDED';
  if (to === 'INACTIVE') return 'PERSON_DEACTIVATED';
  if (from === 'INACTIVE') return 'PERSON_RETRIEVED';
  return 'PERSON_ACTIVATED';
}
