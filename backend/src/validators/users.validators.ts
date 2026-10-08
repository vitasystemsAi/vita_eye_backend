import { z } from 'zod';
import { ROLE_NAMES } from '../config/rbac';
import { paginationSchema } from '../utils/http';
import { passwordSchema } from './auth.validators';

const siteScope = z.array(z.string().trim().min(1).max(120)).max(50).nullable().optional();

export const createUserSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(255),
  password: passwordSchema,
  role: z.enum(ROLE_NAMES),
  siteScope,
});

export const updateUserSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    role: z.enum(ROLE_NAMES).optional(),
    status: z.enum(['ACTIVE', 'DISABLED']).optional(),
    password: passwordSchema.optional(),
    siteScope,
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No changes supplied' });

export const listUsersSchema = paginationSchema.extend({
  search: z.string().trim().max(100).optional(),
  role: z.enum(ROLE_NAMES).optional(),
  status: z.enum(['ACTIVE', 'DISABLED']).optional(),
});

export const idParam = z.object({ id: z.string().uuid() });
