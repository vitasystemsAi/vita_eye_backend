import { describe, expect, it } from 'vitest';
import { isWithinSchedule } from './schedule';

// 2026-10-07 is a Wednesday (day 3).
const at = (iso: string) => new Date(iso);
const weekdays = { enabled: true, days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00', timezone: 'UTC' };

describe('isWithinSchedule', () => {
  it('always allows monitoring when no schedule is enabled', () => {
    expect(isWithinSchedule(null)).toBe(true);
    expect(isWithinSchedule({ ...weekdays, enabled: false }, at('2026-10-11T03:00:00Z'))).toBe(true);
  });

  it('applies day-time windows', () => {
    expect(isWithinSchedule(weekdays, at('2026-10-07T10:00:00Z'))).toBe(true);
    expect(isWithinSchedule(weekdays, at('2026-10-07T18:00:00Z'))).toBe(false);
    expect(isWithinSchedule(weekdays, at('2026-10-11T10:00:00Z'))).toBe(false); // Sunday
  });

  it('handles overnight windows, attributing early hours to the previous day', () => {
    const nights = { enabled: true, days: [5], start: '20:00', end: '06:00', timezone: 'UTC' }; // Friday night
    expect(isWithinSchedule(nights, at('2026-10-09T21:00:00Z'))).toBe(true); // Fri 21:00
    expect(isWithinSchedule(nights, at('2026-10-10T05:00:00Z'))).toBe(true); // Sat 05:00
    expect(isWithinSchedule(nights, at('2026-10-10T07:00:00Z'))).toBe(false);
    expect(isWithinSchedule(nights, at('2026-10-09T05:00:00Z'))).toBe(false); // Fri 05:00 belongs to Thursday
  });

  it('evaluates in the camera time zone', () => {
    const ist = { ...weekdays, timezone: 'Asia/Kolkata' };
    expect(isWithinSchedule(ist, at('2026-10-07T04:00:00Z'))).toBe(true); // 09:30 IST
    expect(isWithinSchedule(ist, at('2026-10-07T13:00:00Z'))).toBe(false); // 18:30 IST
  });
});
