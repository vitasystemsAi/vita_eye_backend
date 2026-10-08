import { z } from 'zod';
import { csvEnum, paginationSchema } from '../utils/http';

export const listEventsSchema = paginationSchema.extend({
  type: csvEnum(['KNOWN', 'UNKNOWN', 'UNCERTAIN'] as const).optional(),
  reviewStatus: csvEnum(['NEW', 'ACKNOWLEDGED', 'INVESTIGATING', 'RESOLVED'] as const).optional(),
  cameraId: z.string().uuid().optional(),
  personId: z.string().uuid().optional(),
  site: z.string().trim().max(120).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  search: z.string().trim().max(100).optional(),
  sort: z.enum(['eventTimestamp', 'eventType', 'reviewStatus', 'confidenceScore']).default('eventTimestamp'),
});

export const exportEventsSchema = listEventsSchema.extend({
  pageSize: z.coerce.number().int().min(1).max(10000).default(5000),
  format: z.enum(['csv', 'xlsx', 'pdf']).default('csv'),
  images: z
    .enum(['true', 'false', '1', '0'])
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  tzOffset: z.coerce.number().int().min(-840).max(840).default(0),
});

export const noteSchema = z.object({ note: z.string().trim().min(1).max(2000) });

export const resolveSchema = z.object({
  resolution: z.enum(['AUTHORIZED_VISITOR', 'EMPLOYEE_NOT_ENROLLED', 'FALSE_DETECTION', 'ESCALATED', 'NO_ACTION_REQUIRED', 'OTHER']),
  note: z.string().trim().max(2000).optional(),
});
