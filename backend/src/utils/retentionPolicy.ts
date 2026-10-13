/** Preset retention windows offered in the platform console. Custom values are also allowed. */
export const RETENTION_PRESETS = [1, 3, 7, 15, 30, 60, 90] as const;

export type RetentionMode = 'DRY_RUN' | 'ENFORCE';

export function isValidTimeZone(timeZone: string): boolean {
  try {
    Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

function zonedParts(date: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const bag: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) bag[part.type] = part.value;
  return {
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day),
    hour: Number(bag.hour),
    minute: Number(bag.minute),
    second: Number(bag.second),
  };
}

/** UTC instant of local midnight on the given calendar date in `timeZone`. */
export function zonedMidnight(date: CalendarDate, timeZone: string): Date {
  const guess = new Date(Date.UTC(date.year, date.month - 1, date.day, 0, 0, 0));
  const parts = zonedParts(guess, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return new Date(guess.getTime() - (asUtc - guess.getTime()));
}

function addCalendarDays(date: CalendarDate, delta: number): CalendarDate {
  const utc = new Date(Date.UTC(date.year, date.month - 1, date.day + delta));
  return { year: utc.getUTCFullYear(), month: utc.getUTCMonth() + 1, day: utc.getUTCDate() };
}

/**
 * Records with `eventTimestamp < cutoff` are eligible for deletion.
 * The cutoff is local midnight, `retentionDays + graceDays` before the current local date,
 * so detections from the current local day always stay inside the window.
 *
 * A seven-day policy (no grace) on 13 Oct deletes records timestamped before local midnight on 6 Oct.
 */
export function retentionCutoff(now: Date, retentionDays: number, graceDays: number, timeZone: string): Date {
  if (!Number.isInteger(retentionDays) || retentionDays < 1) throw new Error('retentionDays must be a positive integer');
  if (!Number.isInteger(graceDays) || graceDays < 0) throw new Error('graceDays must be a non-negative integer');
  if (!isValidTimeZone(timeZone)) throw new Error(`Invalid time zone "${timeZone}"`);
  const local = zonedParts(now, timeZone);
  const shifted = addCalendarDays(local, -(retentionDays + graceDays));
  return zonedMidnight(shifted, timeZone);
}

/** Next hourly cleanup. The worker cron `15 * * * *` fires at minute 15 UTC. */
export function nextRetentionRun(now = new Date()): Date {
  const next = new Date(now);
  next.setUTCSeconds(0, 0);
  next.setUTCMinutes(15);
  if (next.getTime() <= now.getTime()) next.setUTCHours(next.getUTCHours() + 1);
  return next;
}

export type DeletionDecision = 'SKIP_LEGAL_HOLD' | 'SKIP_RECORD_HOLD' | 'SKIP_NOT_ELIGIBLE' | 'DRY_RUN' | 'DELETE';

export function deletionDecision(input: {
  organizationLegalHold: boolean;
  eventLegalHold: boolean;
  underInvestigation: boolean;
  eligibleByCutoff: boolean;
  mode: RetentionMode;
}): DeletionDecision {
  if (input.organizationLegalHold) return 'SKIP_LEGAL_HOLD';
  if (input.eventLegalHold || input.underInvestigation) return 'SKIP_RECORD_HOLD';
  if (!input.eligibleByCutoff) return 'SKIP_NOT_ELIGIBLE';
  if (input.mode === 'DRY_RUN') return 'DRY_RUN';
  return 'DELETE';
}
