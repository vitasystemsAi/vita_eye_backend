import { z } from 'zod';
import { BED_STATUSES } from '../config/organizationTypes';

const name = z.string().trim().min(1, 'Enter a name').max(80);
const label = z.string().trim().min(1, 'Enter a label').max(40);

function notesField(mode: 'create' | 'update') {
  return z
    .string()
    .trim()
    .max(255)
    .nullable()
    .optional()
    .transform((value) => {
      if (value === undefined) return mode === 'create' ? null : undefined;
      return value || null;
    });
}

function codeField(mode: 'create' | 'update', required = false) {
  return z
    .string()
    .trim()
    .max(16)
    .nullable()
    .optional()
    .transform((value) => {
      if (value === undefined) return mode === 'create' ? null : undefined;
      if (value == null || value === '') return null;
      return value.toUpperCase();
    })
    .refine((value) => value == null || /^[A-Z0-9][A-Z0-9_-]{0,15}$/.test(value), 'Use 1–16 letters, numbers, underscores or hyphens')
    .refine((value) => !required || (typeof value === 'string' && value.length > 0), 'Enter a code');
}

const changed = (value: Record<string, unknown>) => Object.values(value).some((item) => item !== undefined);

export const idParam = z.object({ id: z.string().uuid() });

export const createFloorSchema = z.object({
  name,
  code: codeField('create'),
  sortOrder: z.coerce.number().int().min(-20).max(200).default(0),
  notes: notesField('create'),
});

export const updateFloorSchema = z
  .object({
    name: name.optional(),
    code: codeField('update'),
    sortOrder: z.coerce.number().int().min(-20).max(200).optional(),
    notes: notesField('update'),
  })
  .refine(changed, { message: 'No changes supplied' });

export const createRoomSchema = z.object({
  floorId: z.string().uuid(),
  name,
  roomType: z.string().trim().min(1).max(32),
  capacity: z.coerce.number().int().min(1).max(5000),
  notes: notesField('create'),
});

export const updateRoomSchema = z
  .object({
    floorId: z.string().uuid().optional(),
    name: name.optional(),
    roomType: z.string().trim().min(1).max(32).optional(),
    capacity: z.coerce.number().int().min(1).max(5000).optional(),
    notes: notesField('update'),
  })
  .refine(changed, { message: 'No changes supplied' });

export const createBedSchema = z.object({
  roomId: z.string().uuid(),
  label,
  status: z.enum(BED_STATUSES).default('AVAILABLE'),
});

export const updateBedSchema = z
  .object({
    label: label.optional(),
    status: z.enum(BED_STATUSES).optional(),
  })
  .refine(changed, { message: 'No changes supplied' });

export const createEmployeeTypeSchema = z.object({
  name,
  code: codeField('create', true),
  description: notesField('create'),
  sortOrder: z.coerce.number().int().min(0).max(1000).default(0),
  active: z.boolean().default(true),
});

export const updateEmployeeTypeSchema = z
  .object({
    name: name.optional(),
    code: codeField('update', false),
    description: notesField('update'),
    sortOrder: z.coerce.number().int().min(0).max(1000).optional(),
    active: z.boolean().optional(),
  })
  .refine(changed, { message: 'No changes supplied' })
  .refine((value) => value.code !== null, { path: ['code'], message: 'Enter a code' });

const seatLimit = z.union([z.null(), z.coerce.number().int().min(1).max(100_000)]);

export const createDepartmentSchema = z.object({
  name,
  code: codeField('create', true),
  description: notesField('create'),
  seatLimit: seatLimit.optional().transform((value) => (value === undefined ? null : value)),
});

export const updateDepartmentSchema = z
  .object({
    name: name.optional(),
    code: codeField('update', false),
    description: notesField('update'),
    seatLimit: seatLimit.optional(),
  })
  .refine(changed, { message: 'No changes supplied' })
  .refine((value) => value.code !== null, { path: ['code'], message: 'Enter a code' });
