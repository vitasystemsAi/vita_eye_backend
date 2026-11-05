import crypto from 'node:crypto';
import JSZip from 'jszip';
import { bestIdentityScore } from './identityMatch';
import type { ImportIssue } from './peopleWorkbook';
import type { PersonStatus } from '../utils/personStatus';

export const MAX_FACE_PEOPLE = 10_000;
export const MAX_TEMPLATES_PER_PERSON = 10;
export const MAX_FACE_TEMPLATES = 40_000;

const FORMAT = 'vita-eye-faces';
const VERSION = 1;
const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

export interface FaceTemplateRecord {
  modelName: string;
  modelVersion: string;
  qualityScore: number | null;
  embedding: number[];
}

export interface FacePerson {
  referenceId: string;
  personName: string;
  department: string | null;
  status: PersonStatus;
  legalBasis: string | null;
  consentReference: string | null;
  templates: FaceTemplateRecord[];
}

export interface OpenedFacePackage {
  exportedAt: string;
  organizationName: string;
  models: string[];
  people: FacePerson[];
}

export interface FaceLabels {
  hostel: boolean;
  reference: string;
  department: string;
}

export type FaceAction = 'create' | 'restore' | 'add' | 'skip' | 'conflict' | 'error';

export interface FacePlanRow {
  referenceId: string;
  personName: string;
  action: FaceAction;
  detail: string;
  existingId: string | null;
  person: FacePerson | null;
}

export interface StoredFace {
  personId: string;
  referenceId: string;
  embedding: number[];
  quality: number;
}

export interface FaceExisting {
  id: string;
  referenceId: string;
  personName: string;
  department: string | null;
  status: PersonStatus;
  templateCount: number;
}

export function passphraseProblem(value: string): string | null {
  if (value.length < 12 || value.length > 128) return 'Use a passphrase of 12 to 128 characters.';
  if (new Set(value).size < 4) return 'Use a passphrase with at least 4 different characters.';
  return null;
}

function modelKey(template: FaceTemplateRecord) {
  return `${template.modelName}@${template.modelVersion}`;
}

function encodeEmbedding(values: number[]): string {
  return Buffer.from(new Float32Array(values).buffer).toString('base64');
}

function decodeEmbedding(value: string): number[] {
  const raw = Buffer.from(value, 'base64');
  if (!raw.length || raw.length % 4 !== 0) throw new Error('The package is damaged or was not exported by Vita Eye.');
  const aligned = Buffer.alloc(raw.length);
  raw.copy(aligned);
  return Array.from(new Float32Array(aligned.buffer, aligned.byteOffset, aligned.length / 4));
}

function aadFor(exportedAt: string, personCount: number, templateCount: number) {
  return `vita-eye-faces:v${VERSION}:${exportedAt}:${personCount}:${templateCount}`;
}

function deriveKey(passphrase: string, salt: Buffer) {
  return crypto.scryptSync(passphrase, salt, 32, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
}

export async function sealFacePackage(input: { organizationName: string; exportedAt: Date; people: FacePerson[]; passphrase: string }): Promise<Buffer> {
  const problem = passphraseProblem(input.passphrase);
  if (problem) throw new Error(problem);
  if (!input.people.length) throw new Error('There are no stored faces to export.');
  if (input.people.length > MAX_FACE_PEOPLE) throw new Error(`A facial package can hold ${MAX_FACE_PEOPLE} people. Split the export.`);
  const templateCount = input.people.reduce((sum, person) => sum + person.templates.length, 0);
  if (templateCount > MAX_FACE_TEMPLATES) throw new Error(`A facial package can hold ${MAX_FACE_TEMPLATES} templates. Split the export.`);

  const exportedAt = input.exportedAt.toISOString();
  const models = [...new Set(input.people.flatMap((person) => person.templates.map(modelKey)))].sort();
  const packed = {
    people: input.people.map((person) => ({
      ...person,
      templates: person.templates.map((template) => ({ ...template, embedding: encodeEmbedding(template.embedding) })),
    })),
  };
  const plain = Buffer.from(JSON.stringify(packed), 'utf8');
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = deriveKey(input.passphrase, salt);
  try {
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(aadFor(exportedAt, input.people.length, templateCount)));
    const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
    const blob = Buffer.concat([Buffer.from('VFX1'), salt, iv, cipher.getAuthTag(), ciphertext]);
    const manifest = {
      format: FORMAT,
      version: VERSION,
      exportedAt,
      organizationName: input.organizationName,
      personCount: input.people.length,
      templateCount,
      models,
      kdf: 'scrypt',
      cipher: 'aes-256-gcm',
    };
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify(manifest));
    zip.file('faces.enc', blob);
    return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  } finally {
    key.fill(0);
  }
}

export async function openFacePackage(buffer: Buffer, passphrase: string): Promise<OpenedFacePackage> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    throw new Error('This file is not a Vita Eye facial package. To enroll from photos, use photo enrollment.');
  }
  const manifestFile = zip.file('manifest.json');
  const blobFile = zip.file('faces.enc');
  if (!manifestFile || !blobFile) throw new Error('This file is not a Vita Eye facial package. To enroll from photos, use photo enrollment.');
  let manifest: {
    format?: string;
    version?: number;
    exportedAt?: string;
    organizationName?: string;
    personCount?: number;
    templateCount?: number;
    models?: string[];
  };
  try {
    manifest = JSON.parse(await manifestFile.async('string')) as typeof manifest;
  } catch {
    throw new Error('The package is damaged or was not exported by Vita Eye.');
  }
  if (manifest.format !== FORMAT || manifest.version !== VERSION || !manifest.exportedAt || !manifest.personCount || manifest.templateCount === undefined) {
    throw new Error('This facial package was made by a newer or older Vita Eye and cannot be read here.');
  }
  const blob = await blobFile.async('nodebuffer');
  if (blob.length > 80 * 1024 * 1024) throw new Error('This facial package is too large.');
  const key = deriveKey(passphrase, blob.subarray(4, 20));
  let plain: Buffer;
  try {
    if (blob.subarray(0, 4).toString() !== 'VFX1') throw new Error('damaged');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, blob.subarray(20, 32));
    decipher.setAAD(Buffer.from(aadFor(manifest.exportedAt, manifest.personCount, manifest.templateCount)));
    decipher.setAuthTag(blob.subarray(32, 48));
    plain = Buffer.concat([decipher.update(blob.subarray(48)), decipher.final()]);
  } catch {
    throw new Error('The package could not be opened. Check the passphrase and use the original file.');
  } finally {
    key.fill(0);
  }
  return { exportedAt: manifest.exportedAt, organizationName: manifest.organizationName || 'Unknown organization', models: manifest.models ?? [], people: parsePeople(plain.toString('utf8')) };
}

function parsePeople(text: string): FacePerson[] {
  let parsed: { people?: unknown };
  try {
    parsed = JSON.parse(text) as { people?: unknown };
  } catch {
    throw new Error('The package is damaged or was not exported by Vita Eye.');
  }
  if (!Array.isArray(parsed.people)) throw new Error('The package is damaged or was not exported by Vita Eye.');
  if (parsed.people.length > MAX_FACE_PEOPLE) throw new Error(`A facial package can hold ${MAX_FACE_PEOPLE} people.`);
  const people = parsed.people.map((item) => parsePerson(item));
  const templates = people.reduce((sum, person) => sum + person.templates.length, 0);
  if (templates > MAX_FACE_TEMPLATES) throw new Error(`A facial package can hold ${MAX_FACE_TEMPLATES} templates.`);
  return people;
}

function parsePerson(value: unknown): FacePerson {
  if (!value || typeof value !== 'object') throw new Error('The package is damaged or was not exported by Vita Eye.');
  const row = value as Record<string, unknown>;
  const status = row.status;
  if (status !== 'ACTIVE' && status !== 'SUSPENDED' && status !== 'INACTIVE') throw new Error('The package is damaged or was not exported by Vita Eye.');
  if (typeof row.referenceId !== 'string' || typeof row.personName !== 'string' || !Array.isArray(row.templates) || !row.templates.length || row.templates.length > MAX_TEMPLATES_PER_PERSON) {
    throw new Error('The package is damaged or was not exported by Vita Eye.');
  }
  const templates = row.templates.map((item) => {
    if (!item || typeof item !== 'object') throw new Error('The package is damaged or was not exported by Vita Eye.');
    const template = item as Record<string, unknown>;
    if (typeof template.modelName !== 'string' || typeof template.modelVersion !== 'string' || typeof template.embedding !== 'string') {
      throw new Error('The package is damaged or was not exported by Vita Eye.');
    }
    if (template.modelName.length > 64 || template.modelVersion.length > 64) throw new Error('The package is damaged or was not exported by Vita Eye.');
    const quality = template.qualityScore;
    if (quality !== null && (typeof quality !== 'number' || !Number.isFinite(quality) || quality < 0 || quality > 1)) {
      throw new Error('The package is damaged or was not exported by Vita Eye.');
    }
    const embedding = decodeEmbedding(template.embedding);
    if (embedding.length < 32 || embedding.length > 1024 || embedding.some((n) => !Number.isFinite(n))) {
      throw new Error('The package is damaged or was not exported by Vita Eye.');
    }
    return { modelName: template.modelName, modelVersion: template.modelVersion, qualityScore: quality, embedding };
  });
  const width = templates[0]?.embedding.length ?? 0;
  if (templates.some((template) => template.embedding.length !== width)) throw new Error('The package is damaged or was not exported by Vita Eye.');
  return {
    referenceId: row.referenceId,
    personName: row.personName,
    department: typeof row.department === 'string' && row.department.trim() ? row.department.trim() : null,
    status,
    legalBasis: typeof row.legalBasis === 'string' ? row.legalBasis : null,
    consentReference: typeof row.consentReference === 'string' ? row.consentReference : null,
    templates,
  };
}

function fold(value: string) {
  return value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

function validDestination(person: FacePerson, labels: FaceLabels): string | null {
  if (!person.personName.trim() || person.personName.length > 160) return 'Name in the package is missing or too long';
  if (!person.referenceId.trim() || person.referenceId.length > 64) return `${labels.reference} in the package is missing or too long`;
  if (labels.hostel) {
    if (!/^\d{10}$/.test(person.referenceId)) return 'Mobile number in the package must be 10 digits';
    if (!person.department) return `${labels.department} is required`;
  } else if (!/^[A-Za-z0-9._\-/]+$/.test(person.referenceId)) {
    return `${labels.reference} in the package contains characters this organization cannot store`;
  }
  if (person.department && person.department.length > 120) return `${labels.department} in the package is too long`;
  return null;
}

export function resolveFaceImport(
  incoming: FacePerson[],
  existing: FaceExisting[],
  gallery: StoredFace[],
  options: { missingPeople: 'create' | 'skip'; existingFaces: 'replace' | 'skip' | 'add'; threshold: number; capacity: { limit: number | null; used: number } | null },
  labels: FaceLabels,
): { issues: ImportIssue[]; notes: string[]; rows: FacePlanRow[] } {
  const byRef = new Map(existing.map((person) => [fold(person.referenceId), person]));
  const grouped = new Map<string, { personId: string; referenceId: string; templates: Array<{ embedding: number[]; quality: number }> }>();
  for (const face of gallery) {
    const bucket = grouped.get(face.personId) ?? { personId: face.personId, referenceId: face.referenceId, templates: [] };
    bucket.templates.push({ embedding: face.embedding, quality: face.quality });
    grouped.set(face.personId, bucket);
  }
  const seen = new Set<string>();
  const rows: FacePlanRow[] = [];
  const ordered = [...incoming].sort((a, b) => a.referenceId.localeCompare(b.referenceId));
  for (const person of ordered) {
    const key = fold(person.referenceId);
    if (seen.has(key)) {
      rows.push({ referenceId: person.referenceId, personName: person.personName, action: 'error', detail: `This ${labels.reference.toLowerCase()} appears twice in the package`, existingId: null, person: null });
      continue;
    }
    seen.add(key);
    const problem = validDestination(person, labels);
    if (problem) {
      rows.push({ referenceId: person.referenceId, personName: person.personName, action: 'error', detail: problem, existingId: null, person: null });
      continue;
    }
    const current = byRef.get(key);
    if (!current && options.missingPeople === 'skip') {
      rows.push({ referenceId: person.referenceId, personName: person.personName, action: 'skip', detail: `No ${labels.reference.toLowerCase()} matches this person`, existingId: null, person: null });
      continue;
    }
    if (current && current.templateCount > 0 && options.existingFaces === 'skip') {
      rows.push({ referenceId: person.referenceId, personName: person.personName, action: 'skip', detail: 'Already has a face. Left unchanged.', existingId: current.id, person: null });
      continue;
    }
    const adding = !current || current.templateCount === 0 || options.existingFaces === 'add';
    if (current && options.existingFaces === 'add' && current.templateCount + person.templates.length > MAX_TEMPLATES_PER_PERSON) {
      rows.push({
        referenceId: person.referenceId,
        personName: person.personName,
        action: 'error',
        detail: `This person already has ${current.templateCount} templates. A person can keep ${MAX_TEMPLATES_PER_PERSON}. Choose replace to store this set instead.`,
        existingId: current.id,
        person: null,
      });
      continue;
    }
    const probes = person.templates.map((template) => ({ embedding: template.embedding, quality: template.qualityScore ?? 0.75 }));
    let conflict: { referenceId: string; similarity: number } | null = null;
    for (const other of grouped.values()) {
      if (current && other.personId === current.id) continue;
      const similarity = bestIdentityScore(probes, other.templates);
      if (similarity >= options.threshold) {
        conflict = { referenceId: other.referenceId, similarity };
        break;
      }
    }
    if (conflict) {
      rows.push({
        referenceId: person.referenceId,
        personName: person.personName,
        action: 'conflict',
        detail: `This face matches ${conflict.referenceId} (${conflict.similarity.toFixed(2)}). It was left out.`,
        existingId: current?.id ?? null,
        person: null,
      });
      continue;
    }
    const action: FaceAction = !current ? 'create' : adding && current.templateCount > 0 ? 'add' : 'restore';
    const detail = action === 'create' ? 'Will be added with this face' : action === 'add' ? 'Templates will be added' : current && current.templateCount > 0 ? 'Stored face will be replaced' : 'This face will be stored';
    rows.push({ referenceId: person.referenceId, personName: person.personName, action, detail, existingId: current?.id ?? null, person });
    const personId = current?.id ?? `new:${key}`;
    const bucket = grouped.get(personId) ?? { personId, referenceId: person.referenceId, templates: [] };
    if (action === 'restore') bucket.templates = [];
    bucket.templates.push(...probes);
    grouped.set(personId, bucket);
  }

  const creates = rows.filter((row) => row.action === 'create').length;
  const issues: ImportIssue[] = [];
  if (options.capacity && options.capacity.limit != null && options.capacity.used + creates > options.capacity.limit) {
    const remaining = Math.max(0, options.capacity.limit - options.capacity.used);
    issues.push({ path: 'Capacity', message: `This adds ${creates} ${creates === 1 ? 'person' : 'people'} and ${remaining} ${remaining === 1 ? 'place remains' : 'places remain'}.` });
  }
  const models = [...new Set(incoming.flatMap((person) => person.templates.map(modelKey)))].sort();
  const notes = [models.length ? `These templates were built with ${models.join(', ')}. Restore them only when this server runs the same model.` : 'The package did not name a recognition model.'];
  return { issues, notes, rows };
}
