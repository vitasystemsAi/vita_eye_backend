import { z } from 'zod';
import { FEATURE_KEYS } from '../config/features';
import { ORGANIZATION_TYPE_CODES, isAllowedCapacity } from '../config/organizationTypes';
import { PLAN_CODES } from '../config/plans';
import { isValidTimeZone } from '../utils/retentionPolicy';

const features = z.array(z.enum(FEATURE_KEYS as [string, ...string[]])).max(FEATURE_KEYS.length).transform((v) => [...new Set(v)]);
const retentionDays = z.coerce.number().int().min(1).max(3650);
const graceDays = z.coerce.number().int().min(0).max(365).default(0);
const plan = z.enum(PLAN_CODES);
const orgStatus = z.enum(['PROVISIONING', 'PENDING', 'ACTIVE', 'SUSPENDED', 'ON_HOLD', 'DEACTIVATED', 'ARCHIVED', 'FAILED']);
const timezone = z.string().trim().min(1).max(64).refine(isValidTimeZone, 'Enter a valid IANA time zone such as Asia/Kolkata or UTC');
const orgCode = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9_-]{1,31}$/, 'Use 2–32 letters, numbers, underscores or hyphens');
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v === undefined ? undefined : v || null));
const optionalEmail = z
  .union([z.literal(''), z.string().trim().toLowerCase().email().max(255)])
  .optional()
  .nullable()
  .transform((v) => (v === undefined ? undefined : v || null));
const optionalLimit = z.union([z.null(), z.coerce.number().int().min(1).max(10_000_000_000_000)]).optional();
const organizationType = z.enum(ORGANIZATION_TYPE_CODES);
const capacity = z.coerce.number().int().positive();

export const registerOrganizationSchema = z.object({
  name: z.string().trim().min(2).max(160),
  code: orgCode,
  contactName: optionalText(120),
  contactEmail: z.string().trim().toLowerCase().email().max(255),
  contactPhone: optionalText(40),
  timezone,
  subscriptionPlan: plan,
  features,
  detectionRetentionDays: retentionDays,
  retentionGraceDays: graceDays,
  retentionMode: z.enum(['DRY_RUN', 'ENFORCE']).default('DRY_RUN'),
  cameraLimit: optionalLimit,
  storageLimitBytes: optionalLimit,
  admin: z.object({
    name: z.string().trim().min(2).max(120),
    email: z.string().trim().toLowerCase().email().max(255),
  }),
  organizationType,
  capacity,
}).superRefine((value, ctx) => {
  if (!isAllowedCapacity(value.organizationType, value.capacity)) {
    ctx.addIssue({ code: 'custom', path: ['capacity'], message: 'Choose a capacity listed for this organization type' });
  }
});

export const updateOrganizationSchema = z
  .object({
    name: z.string().trim().min(2).max(160).optional(),
    code: orgCode.optional(),
    contactName: optionalText(120),
    contactEmail: optionalEmail,
    contactPhone: optionalText(40),
    timezone: timezone.optional(),
    subscriptionPlan: plan.optional(),
    features: features.optional(),
    detectionRetentionDays: retentionDays.optional(),
    retentionGraceDays: z.coerce.number().int().min(0).max(365).optional(),
    retentionMode: z.enum(['DRY_RUN', 'ENFORCE']).optional(),
    cameraLimit: optionalLimit,
    storageLimitBytes: optionalLimit,
    organizationType: organizationType.optional(),
    capacity: capacity.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'No changes supplied' })
  .superRefine((value, ctx) => {
    if (value.organizationType && value.capacity != null && !isAllowedCapacity(value.organizationType, value.capacity)) {
      ctx.addIssue({ code: 'custom', path: ['capacity'], message: 'Choose a capacity listed for this organization type' });
    }
  });

export const accountSchema = z.object({
  action: z.enum(['ACTIVATE', 'SUSPEND', 'HOLD', 'REACTIVATE', 'DEACTIVATE', 'ARCHIVE']),
  reason: z.string().trim().max(255).optional().nullable(),
  holdType: z.enum(['ACCOUNT', 'LEGAL', 'INVESTIGATION']).optional().nullable(),
});

export const resetClientPasswordSchema = z.object({
  confirmPassword: z.string().min(1).max(256),
});

export const impersonateSchema = z.object({
  userId: z.string().uuid().optional(),
  purpose: z.enum(['CONSOLE', 'LIVE_PREVIEW']).optional(),
});

export const listClientsSchema = z.object({
  q: z.string().trim().max(160).optional(),
  status: orgStatus.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const detectionQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  cameraId: z.string().uuid().optional(),
  eventType: z.enum(['KNOWN', 'UNKNOWN', 'UNCERTAIN']).optional(),
  reviewStatus: z.enum(['NEW', 'ACKNOWLEDGED', 'INVESTIGATING', 'RESOLVED']).optional(),
});

export const dashboardQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export const auditQuerySchema = z.object({
  organizationId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  page: z.coerce.number().int().min(1).default(1),
});

export const orgIdParam = z.object({ id: z.string().uuid() });
export const holdIdParam = z.object({ id: z.string().uuid(), holdId: z.string().uuid() });
