const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' });
const dateOnly = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
const timeOnly = new Intl.DateTimeFormat(undefined, { timeStyle: 'medium' });
const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

export function fmtDateTime(v: string | Date | null | undefined): string {
  return v ? dateTime.format(new Date(v)) : '—';
}

export function fmtDate(v: string | Date | null | undefined): string {
  return v ? dateOnly.format(new Date(v)) : '—';
}

export function fmtTime(v: string | Date | null | undefined): string {
  return v ? timeOnly.format(new Date(v)) : '—';
}

export function fmtRelative(v: string | Date | null | undefined): string {
  if (!v) return '—';
  const diff = (new Date(v).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return 'just now';
  if (abs < 3600) return relative.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return relative.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 30) return relative.format(Math.round(diff / 86400), 'day');
  return fmtDate(v);
}

export function fmtScore(v: number | null | undefined, digits = 2): string {
  return v === null || v === undefined ? '—' : Number(v).toFixed(digits);
}

export function fmtPercent(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : `${Math.round(Number(v) * 100)}%`;
}

export function fmtBytes(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size >= 10 || unit === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unit]}`;
}

export function humanize(code: string | null | undefined): string {
  if (!code) return '—';
  return code
    .toLowerCase()
    .split('_')
    .map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');
}

export const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  SECURITY_ADMIN: 'Security Admin',
  SECURITY_OPERATOR: 'Security Operator',
  AUDITOR: 'Read-Only Auditor',
  PREVIEW: 'Live Preview',
};

/** Minutes east of UTC for the browser, as expected by the dashboard endpoints. */
export function tzOffsetMinutes(): number {
  return -new Date().getTimezoneOffset();
}

/** The cipher failure is about a saved face, not the camera connection. */
export function friendlyCameraError(message: string): string {
  if (message.includes('unable to authenticate data') || message.includes('Unsupported state')) {
    return 'A saved face could not be opened. The camera keeps watching. Add that person again in Face Registration for their name to match.';
  }
  return message;
}
