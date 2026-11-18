/* eslint-disable no-console */
/**
 * Re-encrypts every biometric template, camera credential and evidence file that is not yet under
 * DATA_ENCRYPTION_ACTIVE_KEY. Run after adding a new key and making it active; once it reports
 * nothing remaining, retired keys can be removed from DATA_ENCRYPTION_KEYS.
 *
 *   npm run keys:rewrap [-- --dry-run]
 */
import fs from 'node:fs/promises';
import { Op } from 'sequelize';
import { Camera, EventEvidence, FaceTemplate, sequelize } from '../models';
import { resolveStorage } from '../services/evidence.service';
import { forEachTenant } from '../services/tenancy.service';
import { cipher, credentialsAad, evidenceAad, portraitAad, templateAad } from '../utils/cipher';

const BATCH = 500;
const dryRun = process.argv.includes('--dry-run');
const active = cipher.activeKey;

type Tally = { checked: number; rewrapped: number; failed: number };
const tally = (): Tally => ({ checked: 0, rewrapped: 0, failed: 0 });

async function rewrapTemplates() {
  const t = tally();
  for (let offset = 0; ; offset += BATCH) {
    const rows = await FaceTemplate.scope('withEmbedding').findAll({ order: [['id', 'ASC']], limit: BATCH, offset });
    if (!rows.length) break;
    for (const row of rows) {
      t.checked++;
      if (cipher.keyIdOf(row.encryptedEmbedding) === active) continue;
      try {
        const aad = templateAad(row.id, row.registeredPersonId);
        const next = cipher.encryptString(cipher.decryptString(row.encryptedEmbedding, aad), aad);
        if (!dryRun) await row.update({ encryptedEmbedding: next }, { silent: true });
        t.rewrapped++;
      } catch (err) {
        t.failed++;
        console.error(`  template ${row.id}: ${(err as Error).message}`);
      }
      if (!row.previewReference) continue;
      try {
        const file = resolveStorage(row.previewReference);
        const blob = await fs.readFile(file);
        if (cipher.keyIdOf(blob) === active) continue;
        const aad = portraitAad(row.id, row.registeredPersonId);
        const next = cipher.encryptBuffer(cipher.decryptBuffer(blob, aad), aad);
        if (!dryRun) {
          const tmp = `${file}.rewrap`;
          await fs.writeFile(tmp, next, { mode: 0o600 });
          await fs.rename(tmp, file);
        }
        t.rewrapped++;
      } catch (err) {
        t.failed++;
        console.error(`  portrait ${row.id}: ${(err as Error).message}`);
      }
    }
  }
  return t;
}

async function rewrapCameraCredentials() {
  const t = tally();
  const rows = await Camera.scope('withCredentials').findAll({ where: { encryptedCredentials: { [Op.ne]: null } } });
  for (const row of rows) {
    t.checked++;
    const payload = row.encryptedCredentials!;
    if (cipher.keyIdOf(payload) === active) continue;
    try {
      const aad = credentialsAad(row.id);
      const next = cipher.encryptString(cipher.decryptString(payload, aad), aad);
      if (!dryRun) await row.update({ encryptedCredentials: next }, { silent: true });
      t.rewrapped++;
    } catch (err) {
      t.failed++;
      console.error(`  camera ${row.id}: ${(err as Error).message}`);
    }
  }
  return t;
}

async function rewrapEvidence() {
  const t = { ...tally(), missing: 0 };
  for (let offset = 0; ; offset += BATCH) {
    const rows = await EventEvidence.scope('withStorage').findAll({ order: [['id', 'ASC']], limit: BATCH, offset });
    if (!rows.length) break;
    for (const row of rows) {
      t.checked++;
      const file = resolveStorage(row.storageReference);
      let blob: Buffer;
      try {
        blob = await fs.readFile(file);
      } catch {
        t.missing++;
        continue;
      }
      if (cipher.keyIdOf(blob) === active) continue;
      try {
        const aad = evidenceAad(row.id);
        const next = cipher.encryptBuffer(cipher.decryptBuffer(blob, aad), aad);
        if (!dryRun) {
          const tmp = `${file}.rewrap`;
          await fs.writeFile(tmp, next, { mode: 0o600 });
          await fs.rename(tmp, file);
        }
        t.rewrapped++;
      } catch (err) {
        t.failed++;
        console.error(`  evidence ${row.id}: ${(err as Error).message}`);
      }
    }
  }
  return t;
}

function add<T extends Record<string, number>>(into: T, from: T) {
  for (const k of Object.keys(from) as Array<keyof T>) (into[k] as number) += from[k];
}

async function main() {
  await sequelize.authenticate();
  console.log(`${dryRun ? '[dry run] ' : ''}Re-encrypting data under active key "${active}"`);
  const templates = tally();
  const cameras = tally();
  const evidence = { ...tally(), missing: 0 };
  const seen = new Set<string>();
  // Every organization database holds its own templates, credentials and evidence references.
  await forEachTenant(async (tenant) => {
    const key = tenant.database ?? '<primary>';
    if (seen.has(key)) return;
    seen.add(key);
    add(templates, await rewrapTemplates());
    add(cameras, await rewrapCameraCredentials());
    add(evidence, await rewrapEvidence());
  });
  console.table({ templates, cameraCredentials: cameras, evidence });
  const failed = templates.failed + cameras.failed + evidence.failed;
  if (failed) {
    console.error(`${failed} item(s) could not be re-encrypted. Keep all keys configured and investigate before removing any.`);
    process.exitCode = 1;
  } else if (!dryRun) {
    console.log('All encrypted data now uses the active key. Retired keys can be removed from DATA_ENCRYPTION_KEYS.');
  }
  await sequelize.close();
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  await sequelize.close().catch(() => undefined);
  process.exit(1);
});
