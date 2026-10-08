import { Op } from 'sequelize';
import { redis } from '../config/redis';
import { FaceTemplate, RegisteredPerson } from '../models';
import { cipher, templateAad } from '../utils/cipher';

const key = (orgId: string) => `vita:gallery:version:${orgId}`;

/** Monotonic per-organization gallery version; the AI service refetches templates when it changes. */
export async function galleryVersion(organizationId: string): Promise<string> {
  const v = await redis.get(key(organizationId));
  if (v) return v;
  await redis.set(key(organizationId), String(Date.now()), 'NX');
  return (await redis.get(key(organizationId)))!;
}

export async function bumpGalleryVersion(organizationId: string): Promise<string> {
  const v = await redis.incr(key(organizationId));
  return String(v);
}

export { templateAad };

/**
 * Decrypted gallery for the AI service only (internal endpoint). Includes templates of ACTIVE,
 * ENROLLED, non-deleted persons of a single organization.
 */
export async function loadGallery(organizationId: string) {
  const persons = await RegisteredPerson.findAll({
    where: { organizationId, status: 'ACTIVE', enrollmentStatus: 'ENROLLED', deletedAt: { [Op.is]: null } },
    attributes: ['id'],
    include: [{ model: FaceTemplate.scope('withEmbedding'), as: 'templates', required: true }],
  });
  const templates = persons.flatMap((p) =>
    (p.templates ?? []).map((t) => ({
      templateId: t.id,
      personId: p.id,
      modelVersion: t.modelVersion,
      embedding: cipher.decryptEmbedding(t.encryptedEmbedding, templateAad(t.id, p.id)),
    })),
  );
  return { version: await galleryVersion(organizationId), templates };
}
