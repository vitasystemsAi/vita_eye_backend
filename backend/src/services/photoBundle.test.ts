import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { matchPhotoGroups, readPhotoBundle, referenceFromPath } from './photoBundle';

describe('photo enrollment names', () => {
  it('uses a folder name or a file name and keeps hyphenated ids', () => {
    expect(referenceFromPath('EMP-100/front.jpg')).toBe('EMP-100');
    expect(referenceFromPath('photos/EMP-100_2.jpeg')).toBe('EMP-100');
    expect(referenceFromPath('people/9876543210.png')).toBe('9876543210');
    expect(referenceFromPath('notes/readme.txt')).toBeNull();
    expect(referenceFromPath('../EMP-1/secret.jpg')).toBeNull();
  });

  it('groups a zip and matches registered people', async () => {
    const zip = new JSZip();
    zip.file('EMP-100/front.jpg', Buffer.from('a'));
    zip.file('EMP-100/side.jpg', Buffer.from('b'));
    zip.file('EMP-100/extra-1.jpg', Buffer.from('c'));
    zip.file('EMP-100/extra-2.jpg', Buffer.from('d'));
    zip.file('EMP-100/extra-3.jpg', Buffer.from('e'));
    zip.file('EMP-100/extra-4.jpg', Buffer.from('f'));
    zip.file('missing/one.jpg', Buffer.from('g'));
    zip.file('readme.txt', Buffer.from('nope'));
    const read = await readPhotoBundle(await zip.generateAsync({ type: 'nodebuffer' }));
    expect(read.issues).toEqual([]);
    const emp = read.groups.find((group) => group.referenceId === 'EMP-100');
    expect(emp?.files).toHaveLength(5);
    expect(emp?.omitted).toBe(1);
    const rows = matchPhotoGroups(read.groups, [{ id: 'p1', referenceId: 'emp-100', personName: 'Jane', templateCount: 0 }], false);
    expect(rows.find((row) => row.referenceId === 'EMP-100')?.action).toBe('ready');
    expect(rows.find((row) => row.referenceId === 'missing')?.action).toBe('missing');
  });
});
