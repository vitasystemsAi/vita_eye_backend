import { z } from 'zod';

/** Mirrors the backend PASSWORD_POLICY (the server remains the authority). */
export const passwordRule = z
  .string()
  .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{12,128}$/, 'Use 12–128 characters including upper-case, lower-case and a digit');

export const referenceIdRule = z
  .string()
  .trim()
  .min(1, 'Reference ID is required')
  .max(64)
  .regex(/^[A-Za-z0-9._\-/]+$/, 'Letters, digits and . _ - / only');

/** Applies server-side validation details to react-hook-form fields; returns true if any matched. */
export function applyServerErrors(details: Record<string, string>, setError: (name: never, err: { message: string }) => void): boolean {
  let matched = false;
  for (const [path, message] of Object.entries(details)) {
    setError(path as never, { message });
    matched = true;
  }
  return matched;
}
