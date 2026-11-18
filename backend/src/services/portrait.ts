import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../config/logger';
import { cipher, portraitAad } from '../utils/cipher';
import { resolveStorage } from './evidence.service';

/** Encrypted enrollment photo, stored beside evidence and bound to one template row. */
export async function writePortrait(organizationId: string, templateId: string, personId: string, bytes: Buffer) {
  const reference = path.posix.join(organizationId, 'portraits', `${templateId}.bin`);
  const full = resolveStorage(reference);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, cipher.encryptBuffer(bytes, portraitAad(templateId, personId)), { mode: 0o600 });
  return reference;
}

export async function readPortrait(reference: string, templateId: string, personId: string) {
  const blob = await fs.readFile(resolveStorage(reference));
  return cipher.decryptBuffer(blob, portraitAad(templateId, personId));
}

export async function removePortraitFiles(references: Array<string | null | undefined>) {
  await Promise.all(
    references.filter((reference): reference is string => Boolean(reference)).map(async (reference) => {
      try {
        await fs.rm(resolveStorage(reference), { force: true });
      } catch (err) {
        logger.warn({ err: (err as Error).message, reference }, 'Could not remove enrollment photo');
      }
    }),
  );
}
