import { describe, expect, it } from 'vitest';
import { DELETE_HOLD_MS, canDiscardRegistration, deletionHold, statusAuditAction } from './personStatus';

const DAY = 24 * 60 * 60 * 1000;

describe('deletionHold', () => {
  const now = Date.parse('2026-10-13T00:00:00.000Z');

  it('never deletes an active registration from the list', () => {
    expect(deletionHold('ACTIVE', new Date(now - 30 * DAY), now).canDelete).toBe(false);
  });

  it('keeps suspended and inactive registrations for 7 days', () => {
    const recent = new Date(now - 6 * DAY);
    expect(deletionHold('SUSPENDED', recent, now).canDelete).toBe(false);
    expect(deletionHold('INACTIVE', recent, now).canDelete).toBe(false);
    const held = deletionHold('INACTIVE', recent, now);
    expect(held.deleteAvailableAt).toBe(new Date(recent.getTime() + DELETE_HOLD_MS).toISOString());
  });

  it('allows deletion once the hold has passed', () => {
    expect(deletionHold('SUSPENDED', new Date(now - 7 * DAY), now).canDelete).toBe(true);
    expect(deletionHold('INACTIVE', new Date(now - 8 * DAY), now).canDelete).toBe(true);
  });
});

describe('canDiscardRegistration', () => {
  it('allows immediate removal only when no face was stored', () => {
    expect(canDiscardRegistration('PENDING', 0)).toBe(true);
    expect(canDiscardRegistration('FAILED', 0)).toBe(true);
    expect(canDiscardRegistration('ENROLLED', 0)).toBe(false);
    expect(canDiscardRegistration('PENDING', 2)).toBe(false);
    expect(canDiscardRegistration('REVOKED', 0)).toBe(false);
  });
});

describe('statusAuditAction', () => {
  it('names retrieve separately from a suspended reactivation', () => {
    expect(statusAuditAction('INACTIVE', 'ACTIVE')).toBe('PERSON_RETRIEVED');
    expect(statusAuditAction('SUSPENDED', 'ACTIVE')).toBe('PERSON_ACTIVATED');
    expect(statusAuditAction('ACTIVE', 'SUSPENDED')).toBe('PERSON_SUSPENDED');
    expect(statusAuditAction('ACTIVE', 'INACTIVE')).toBe('PERSON_DEACTIVATED');
  });
});
