import type { CameraSchedule } from '../models/Camera';

function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** Returns true if monitoring is permitted at `now` according to the camera schedule. */
export function isWithinSchedule(schedule: CameraSchedule | null | undefined, now = new Date()): boolean {
  if (!schedule || !schedule.enabled) return true;
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: schedule.timezone || 'UTC',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now);
  } catch {
    return true;
  }
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun';
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekday);
  const cur = Number(parts.find((p) => p.type === 'hour')?.value) * 60 + Number(parts.find((p) => p.type === 'minute')?.value);
  const start = minutes(schedule.start);
  const end = minutes(schedule.end);

  if (start <= end) {
    return schedule.days.includes(day) && cur >= start && cur < end;
  }
  // Overnight window (e.g. 20:00 -> 06:00): the early-morning part belongs to the previous day's schedule.
  if (cur >= start) return schedule.days.includes(day);
  if (cur < end) return schedule.days.includes((day + 6) % 7);
  return false;
}
