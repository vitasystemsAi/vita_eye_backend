import type { CameraStatus, DeliveryStatus, EnrollmentStatus, EventType, FaceLabel, ReviewStatus } from '@/lib/types';
import { Badge } from './ui/primitives';

// Wording is deliberately neutral: an unrecognized face is not an accusation.
export const EVENT_LABELS: Record<EventType, string> = {
  KNOWN: 'Registered person',
  UNKNOWN: 'Unrecognized person',
  UNCERTAIN: 'Uncertain match',
};

export function EventTypeBadge({ type }: { type: EventType }) {
  const tone = type === 'KNOWN' ? 'green' : type === 'UNKNOWN' ? 'red' : 'amber';
  return (
    <Badge tone={tone} dot>
      {EVENT_LABELS[type]}
    </Badge>
  );
}

export function ReviewBadge({ status }: { status: ReviewStatus }) {
  const map: Record<ReviewStatus, ['neutral' | 'blue' | 'amber' | 'green' | 'red', string]> = {
    NEW: ['red', 'New'],
    ACKNOWLEDGED: ['blue', 'Acknowledged'],
    INVESTIGATING: ['amber', 'Investigating'],
    RESOLVED: ['green', 'Resolved'],
  };
  const [tone, label] = map[status];
  return <Badge tone={tone}>{label}</Badge>;
}

export function CameraStatusBadge({ status, monitoring }: { status: CameraStatus; monitoring?: boolean }) {
  const map: Record<CameraStatus, ['green' | 'neutral' | 'red' | 'amber', string]> = {
    ONLINE: ['green', 'Online'],
    OFFLINE: ['neutral', 'Offline'],
    ERROR: ['red', 'Error'],
    DISABLED: ['neutral', 'Disabled'],
  };
  const [tone, label] = map[status];
  return (
    <span className="inline-flex items-center gap-1.5">
      <Badge tone={tone} dot>
        {label}
      </Badge>
      {monitoring && status !== 'DISABLED' && <Badge tone="blue">Monitoring</Badge>}
    </span>
  );
}

export function EnrollmentBadge({ status }: { status: EnrollmentStatus }) {
  const map: Record<EnrollmentStatus, ['green' | 'neutral' | 'red' | 'amber', string]> = {
    ENROLLED: ['green', 'Enrolled'],
    PENDING: ['amber', 'Not enrolled'],
    FAILED: ['red', 'Enrollment failed'],
    REVOKED: ['neutral', 'Revoked'],
  };
  const [tone, label] = map[status];
  return <Badge tone={tone}>{label}</Badge>;
}

export function DeliveryBadge({ status }: { status: DeliveryStatus }) {
  const tone = { SENT: 'green', PENDING: 'blue', FAILED: 'red', SKIPPED: 'neutral' }[status] as 'green' | 'blue' | 'red' | 'neutral';
  return <Badge tone={tone}>{status.charAt(0) + status.slice(1).toLowerCase()}</Badge>;
}

export const FACE_COLORS: Record<FaceLabel, string> = {
  KNOWN: '#34d399',
  UNKNOWN: '#f87171',
  UNCERTAIN: '#fbbf24',
  LOW_QUALITY: '#8b98b6',
  PENDING: '#60a5fa',
};

export const FACE_LABELS: Record<FaceLabel, string> = {
  KNOWN: 'Registered',
  UNKNOWN: 'Unrecognized',
  UNCERTAIN: 'Uncertain',
  LOW_QUALITY: 'Low quality',
  PENDING: 'Verifying…',
};
