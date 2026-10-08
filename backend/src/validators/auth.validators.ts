import { z } from 'zod';
import { PASSWORD_POLICY } from '../utils/password';

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  password: z.string().min(1).max(256),
});

export const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
});

export const passwordSchema = z.string().regex(PASSWORD_POLICY.regex, PASSWORD_POLICY.message);

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
});
