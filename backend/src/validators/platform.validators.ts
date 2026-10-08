import { z } from 'zod';
import { FEATURE_KEYS } from '../config/features';
import { passwordSchema } from './auth.validators';

const features = z.array(z.enum(FEATURE_KEYS as [string, ...string[]])).max(FEATURE_KEYS.length).transform((v) => [...new Set(v)]);
const retentionDays = z.coerce.number().int().min(1).max(3650);
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

export const registerOrganizationSchema = z.object({
  name: z.string().trim().min(2).max(160),
  contactName: optionalText(120),
  contactEmail: optionalEmail,
  contactPhone: optionalText(40),
  features,
  detectionRetentionDays: retentionDays,
  admin: z.object({
    name: z.string().trim().min(2).max(120),
    email: z.string().trim().toLowerCase().email().max(255),
    /** Omit to have a strong password generated. */
    password: z.union([z.literal(''), passwordSchema]).optional().transform((v) => (v ? v : undefined)),
  }),
});

export const updateOrganizationSchema = z
  .object({
    name: z.string().trim().min(2).max(160).optional(),
    contactName: optionalText(120),
    contactEmail: optionalEmail,
    contactPhone: optionalText(40),
    features: features.optional(),
    detectionRetentionDays: retentionDays.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'No changes supplied' });

export const holdSchema = z.object({
  onHold: z.boolean(),
  reason: z.string().trim().max(255).optional().nullable(),
});

export const resetClientPasswordSchema = z.object({
  /** Omit to generate a strong password. */
  password: z.union([z.literal(''), passwordSchema]).optional().transform((v) => (v ? v : undefined)),
});

export const impersonateSchema = z.object({
  userId: z.string().uuid().optional(),
});

export const auditQuerySchema = z.object({
  organizationId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export const orgIdParam = z.object({ id: z.string().uuid() });
