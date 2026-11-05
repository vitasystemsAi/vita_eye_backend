import { describe, expect, it } from 'vitest';
import { openFacePackage, resolveFaceImport, sealFacePackage, type FacePerson } from './facePackage';

const labels = { hostel: false, reference: 'Reference ID', department: 'Department' };
const passphrase = 'correct-horse-battery';

function person(referenceId: string, embedding: number[], name = referenceId): FacePerson {
  const wide = Array.from({ length: 32 }, (_, index) => embedding[index] ?? 0);
  return {
    referenceId,
    personName: name,
    department: 'Desk',
    status: 'ACTIVE',
    legalBasis: 'CONSENT',
    consentReference: 'CONSENT-1',
    templates: [{ modelName: 'arcface', modelVersion: '1', qualityScore: 1, embedding: wide }],
  };
}

describe('facial package', () => {
  it('seals embeddings so the zip does not contain the plaintext and opens with the passphrase', async () => {
    const face = person('EMP-1', [1, 0, 0, 0]);
    const packed = await sealFacePackage({ organizationName: 'North Gate', exportedAt: new Date('2026-11-05T00:00:00.000Z'), people: [face], passphrase });
    expect(packed.includes(Buffer.from('EMP-1'))).toBe(false);
    const opened = await openFacePackage(packed, passphrase);
    expect(opened.organizationName).toBe('North Gate');
    expect(opened.people[0]?.templates[0]?.embedding[0]).toBeCloseTo(1);
    await expect(openFacePackage(packed, 'another-passphrase')).rejects.toThrow(/passphrase/);
  });

  it('replaces a person with their own face and refuses a second person who matches them', () => {
    const incoming = [person('EMP-1', [1, 0, 0, 0], 'Jane'), person('EMP-2', [1, 0, 0, 0], 'Lookalike'), person('EMP-3', [0, 1, 0, 0], 'Arun')];
    const plan = resolveFaceImport(
      incoming,
      [
        { id: 'id-1', referenceId: 'EMP-1', personName: 'Janet', department: 'Old', status: 'ACTIVE', templateCount: 1 },
      ],
      [{ personId: 'id-1', referenceId: 'EMP-1', embedding: [1, 0, 0, 0], quality: 1 }],
      { missingPeople: 'create', existingFaces: 'replace', threshold: 0.5, capacity: null },
      labels,
    );
    expect(plan.issues).toEqual([]);
    expect(plan.rows.find((row) => row.referenceId === 'EMP-1')?.action).toBe('restore');
    expect(plan.rows.find((row) => row.referenceId === 'EMP-2')?.action).toBe('conflict');
    expect(plan.rows.find((row) => row.referenceId === 'EMP-3')?.action).toBe('create');
  });

  it('skips an existing face and a missing person when that is what was asked', () => {
    const plan = resolveFaceImport(
      [person('EMP-1', [1, 0, 0, 0]), person('EMP-9', [0, 1, 0, 0])],
      [{ id: 'id-1', referenceId: 'EMP-1', personName: 'Jane', department: null, status: 'ACTIVE', templateCount: 2 }],
      [],
      { missingPeople: 'skip', existingFaces: 'skip', threshold: 0.5, capacity: { limit: 10, used: 1 } },
      labels,
    );
    expect(plan.rows.map((row) => row.action).sort()).toEqual(['skip', 'skip']);
  });
});
