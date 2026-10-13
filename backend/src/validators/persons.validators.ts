import { z } from 'zod';
import { paginationSchema } from '../utils/http';

const text = (max: number) => z.string().trim().min(1).max(max);

export const createPersonSchema = z.object({
  personName: text(160),
  referenceId: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9._\-/]+$/, 'Reference ID may contain letters, digits, . _ - /'),
  department: z.string().trim().max(120).optional().nullable(),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'INACTIVE']).optional(),
});

export const poseTargetSchema = z.object({
  target: z.enum(['straight', 'left', 'right', 'up', 'down']),
});

export const setStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'SUSPENDED', 'INACTIVE']),
});

export const updatePersonSchema = createPersonSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'No changes supplied' });

export const listPersonsSchema = paginationSchema.extend({
  search: z.string().trim().max(100).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'INACTIVE']).optional(),
  enrollmentStatus: z.enum(['PENDING', 'ENROLLED', 'FAILED', 'REVOKED']).optional(),
  department: z.string().trim().max(120).optional(),
  sort: z.enum(['personName', 'referenceId', 'createdAt', 'updatedAt']).default('createdAt'),
});

export const enrollSchema = z.object({
  legalBasis: z.enum(['CONSENT', 'EMPLOYMENT', 'LEGAL_OBLIGATION', 'LEGITIMATE_USE', 'OTHER']),
  consentReference: text(255),
  consentConfirmed: z.enum(['true']).transform(() => true as const),
  replaceExisting: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});
