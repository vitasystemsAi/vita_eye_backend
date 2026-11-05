import { z } from 'zod';

const flag = z.enum(['true', 'false']).transform((value) => value === 'true');

export const peopleExportSchema = z.object({
  format: z.enum(['csv', 'xlsx']).default('xlsx'),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'INACTIVE']).optional(),
  enrollmentStatus: z.enum(['PENDING', 'ENROLLED', 'FAILED', 'REVOKED']).optional(),
});

export const peopleImportSchema = z.object({
  mode: z.enum(['add', 'upsert']),
  dryRun: flag,
});

export const faceExportSchema = z.object({
  passphrase: z.string().min(1).max(128),
  scope: z.enum(['all', 'active']).default('all'),
});

export const faceImportSchema = z.object({
  passphrase: z.string().min(1).max(128),
  dryRun: flag,
  missingPeople: z.enum(['create', 'skip']),
  existingFaces: z.enum(['replace', 'skip', 'add']),
  acceptModel: flag,
});

export const photoImportSchema = z.object({
  dryRun: flag,
  replaceExisting: flag.optional().default(false),
  legalBasis: z.enum(['CONSENT', 'EMPLOYMENT', 'LEGAL_OBLIGATION', 'LEGITIMATE_USE', 'OTHER']).optional(),
  consentReference: z.string().trim().max(255).optional(),
});
