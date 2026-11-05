import JSZip from 'jszip';
import type { ImportIssue } from './peopleWorkbook';

export const MAX_PHOTO_IMAGES = 200;
export const MAX_PHOTOS_PER_PERSON = 5;
const MAX_UNCOMPRESSED = 80 * 1024 * 1024;

const IMAGE = /\.(jpe?g|png|webp)$/i;
const GENERIC = new Set(['images', 'image', 'photos', 'photo', 'faces', 'face', 'enrollment', 'import', 'people', 'persons', 'person']);

export interface PhotoFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
}

export interface PhotoGroup {
  referenceId: string;
  files: PhotoFile[];
  omitted: number;
}

export function referenceFromPath(filePath: string): string | null {
  const parts = filePath.replace(/\\/g, '/').split('/').filter((part) => part && part !== '.' && !part.startsWith('__MACOSX'));
  if (parts.some((part) => part === '..')) return null;
  const file = parts.pop();
  if (!file || file.startsWith('.') || !IMAGE.test(file)) return null;
  const parent = [...parts].reverse().find((part) => !GENERIC.has(part.toLowerCase()));
  if (parent) return parent.trim();
  const stem = file.replace(/\.[^.]+$/, '').replace(/(?:_\d+|\s+\d+|\s*\(\d+\))$/, '').trim();
  return stem || null;
}

function mimeOf(name: string): string | null {
  const lower = name.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  return null;
}

export async function readPhotoBundle(buffer: Buffer): Promise<{ issues: ImportIssue[]; notes: string[]; groups: PhotoGroup[] }> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    return { issues: [{ path: 'File', message: 'Upload a ZIP of face photos.' }], notes: [], groups: [] };
  }
  if (zip.file('manifest.json') && zip.file('faces.enc')) {
    return { issues: [{ path: 'File', message: 'This is an encrypted facial package. Use Restore a facial package for this file.' }], notes: [], groups: [] };
  }
  const groups = new Map<string, PhotoGroup>();
  const display = new Map<string, string>();
  let images = 0;
  let skipped = 0;
  let total = 0;
  for (const file of Object.values(zip.files)) {
    if (file.dir) continue;
    const reference = referenceFromPath(file.name);
    const mime = mimeOf(file.name);
    if (!reference || !mime) {
      if (!file.name.startsWith('__MACOSX') && !file.name.split('/').pop()?.startsWith('.')) skipped += 1;
      continue;
    }
    const data = await file.async('nodebuffer');
    total += data.length;
    if (total > MAX_UNCOMPRESSED) return { issues: [{ path: 'File', message: 'This ZIP is too large. Split it into smaller folders.' }], notes: [], groups: [] };
    images += 1;
    if (images > MAX_PHOTO_IMAGES) return { issues: [{ path: 'File', message: `A photo import can hold ${MAX_PHOTO_IMAGES} images. Split the ZIP.` }], notes: [], groups: [] };
    const key = reference.toLowerCase();
    const group = groups.get(key) ?? { referenceId: display.get(key) ?? reference, files: [], omitted: 0 };
    display.set(key, group.referenceId);
    if (group.files.length >= MAX_PHOTOS_PER_PERSON) group.omitted += 1;
    else group.files.push({ buffer: data, mimetype: mime, originalname: file.name.split('/').pop() ?? file.name });
    groups.set(key, group);
  }
  if (!groups.size) {
    return { issues: [{ path: 'File', message: 'No face photos were found. Name each file with the reference ID, or put the photos in a folder of that name.' }], notes: [], groups: [] };
  }
  const notes = ['People must already be in the directory. A photo import does not create or delete anyone.'];
  if (skipped) notes.push(`${skipped} ${skipped === 1 ? 'file was' : 'files were'} skipped because the name was not a reference ID.`);
  return { issues: [], notes, groups: [...groups.values()] };
}

export interface PhotoMatchRow {
  referenceId: string;
  personName: string;
  personId: string | null;
  images: number;
  omitted: number;
  action: 'ready' | 'missing' | 'error';
  detail: string;
}

export function matchPhotoGroups(
  groups: PhotoGroup[],
  people: Array<{ id: string; referenceId: string; personName: string; templateCount: number }>,
  replaceExisting: boolean,
): PhotoMatchRow[] {
  const byRef = new Map(people.map((person) => [person.referenceId.trim().toLowerCase(), person]));
  return groups.map((group) => {
    const person = byRef.get(group.referenceId.trim().toLowerCase());
    const extra = group.omitted ? ` ${group.omitted} extra ${group.omitted === 1 ? 'photo was' : 'photos were'} left out because five is the limit for one import.` : '';
    if (!person) {
      return { referenceId: group.referenceId, personName: group.referenceId, personId: null, images: group.files.length, omitted: group.omitted, action: 'missing', detail: `Nobody with this reference ID is registered.${extra}` };
    }
    if (!replaceExisting && person.templateCount >= 10) {
      return { referenceId: group.referenceId, personName: person.personName, personId: person.id, images: group.files.length, omitted: group.omitted, action: 'error', detail: 'This person already has 10 templates. Choose replace to enroll a new set.' };
    }
    if (!replaceExisting && person.templateCount + group.files.length > 10) {
      return {
        referenceId: group.referenceId,
        personName: person.personName,
        personId: person.id,
        images: group.files.length,
        omitted: group.omitted,
        action: 'error',
        detail: `This person already has ${person.templateCount} templates. Choose replace, or import fewer photos.`,
      };
    }
    const holding = person.templateCount ? ` ${person.templateCount} ${person.templateCount === 1 ? 'template is' : 'templates are'} already stored.` : '';
    return { referenceId: group.referenceId, personName: person.personName, personId: person.id, images: group.files.length, omitted: group.omitted, action: 'ready', detail: `${group.files.length} ${group.files.length === 1 ? 'photo' : 'photos'} will be enrolled.${holding}${extra}` };
  });
}
