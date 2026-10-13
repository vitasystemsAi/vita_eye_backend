import { describe, expect, it } from 'vitest';
import { deletionDecision, nextRetentionRun, retentionCutoff } from './retentionPolicy';
import { canRetryProvisioning, holdPausesCleanup, loginAllowed, retentionRuns, statusForAction } from './accountPolicy';
import { planSelectionErrors } from '../config/plans';
import { enabledFeatures, filterPermissions } from '../config/features';

describe('retention cutoff', () => {
  it('keeps the current local day and drops records older than the window', () => {
    const now = new Date('2026-10-13T08:30:00.000Z');
    const cutoff = retentionCutoff(now, 7, 0, 'Asia/Kolkata');
    expect(cutoff.toISOString()).toBe('2026-10-05T18:30:00.000Z');
    expect(new Date('2026-10-06T00:00:00.000+05:30').getTime()).toBe(cutoff.getTime());
    expect(cutoff.getTime()).toBeLessThan(now.getTime());
  });

  it('adds the grace period before anything becomes eligible', () => {
    const now = new Date('2026-10-13T08:30:00.000Z');
    const cutoff = retentionCutoff(now, 7, 1, 'UTC');
    expect(cutoff.toISOString()).toBe('2026-10-05T00:00:00.000Z');
  });

  it('schedules the next cleanup at minute 15 UTC', () => {
    const next = nextRetentionRun(new Date('2026-10-13T08:16:00.000Z'));
    expect(next.toISOString()).toBe('2026-10-13T09:15:00.000Z');
  });
});

describe('deletion decisions', () => {
  const base = { organizationLegalHold: false, eventLegalHold: false, underInvestigation: false, eligibleByCutoff: true, mode: 'ENFORCE' as const };

  it('never deletes while a legal hold or investigation hold is active', () => {
    expect(deletionDecision({ ...base, organizationLegalHold: true })).toBe('SKIP_LEGAL_HOLD');
    expect(deletionDecision({ ...base, eventLegalHold: true })).toBe('SKIP_RECORD_HOLD');
    expect(deletionDecision({ ...base, underInvestigation: true })).toBe('SKIP_RECORD_HOLD');
  });

  it('previews eligible rows without deleting them during a dry run', () => {
    expect(deletionDecision({ ...base, mode: 'DRY_RUN' })).toBe('DRY_RUN');
    expect(deletionDecision(base)).toBe('DELETE');
    expect(deletionDecision({ ...base, eligibleByCutoff: false })).toBe('SKIP_NOT_ELIGIBLE');
  });
});

describe('account policy', () => {
  it('keeps suspension separate from retention and legal holds', () => {
    expect(loginAllowed('SUSPENDED')).toBe(false);
    expect(loginAllowed('ACTIVE')).toBe(true);
    expect(retentionRuns('SUSPENDED')).toBe(true);
    expect(retentionRuns('FAILED')).toBe(false);
    expect(holdPausesCleanup('ACCOUNT')).toBe(false);
    expect(holdPausesCleanup('LEGAL')).toBe(true);
    expect(holdPausesCleanup('INVESTIGATION')).toBe(true);
    expect(statusForAction('SUSPEND')).toBe('SUSPENDED');
    expect(statusForAction('HOLD')).toBe('ON_HOLD');
    expect(canRetryProvisioning('FAILED')).toBe(true);
    expect(canRetryProvisioning('ACTIVE')).toBe(false);
  });
});

describe('plan and feature enforcement', () => {
  it('rejects features this deployment does not support', () => {
    const errors = planSelectionErrors('ENTERPRISE', { features: ['vehicleDetection'], retentionDays: 7, cameraLimit: null, storageLimitBytes: null });
    expect(errors.some((error) => error.includes('not available'))).toBe(true);
  });

  it('rejects features outside the selected plan', () => {
    const errors = planSelectionErrors('STARTER', { features: ['faceRegistration'], retentionDays: 7, cameraLimit: 4, storageLimitBytes: null });
    expect(errors.some((error) => error.includes('Starter'))).toBe(true);
  });

  it('removes a permission only when every feature that grants it is off', () => {
    const role = new Set(['events:export', 'dashboard:view'] as const);
    const withReports = enabledFeatures(['reportsExport', 'dashboard']);
    expect(filterPermissions(role, withReports).has('events:export')).toBe(true);
    const withoutReports = enabledFeatures(['dashboard']);
    expect(filterPermissions(role, withoutReports).has('events:export')).toBe(false);
    expect(filterPermissions(role, withoutReports).has('dashboard:view')).toBe(true);
  });
});
