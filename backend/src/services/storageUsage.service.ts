import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveStorage } from './evidence.service';

/** Bytes used by one organization's private evidence prefix. Missing directories count as zero. */
export async function organizationStorageBytes(organizationId: string): Promise<number> {
  if (!/^[0-9a-f-]{36}$/i.test(organizationId)) return 0;
  const root = resolveStorage(organizationId);
  let total = 0;
  async function walk(dir: string) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const child = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(child);
      else if (entry.isFile()) total += (await fs.stat(child)).size;
    }
  }
  await walk(root);
  return total;
}
