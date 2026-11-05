/** Same identity score the live gallery uses. Keep this aligned with ai-service gallery.fuse_identity_score. */

const OUTLIER_GAP = 0.12;

export function dot(a: number[], b: number[]): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += (a[i] ?? 0) * (b[i] ?? 0);
  return s;
}

export function identityScore(probe: number[], templates: Array<{ embedding: number[]; quality: number }>): number {
  if (!templates.length || !probe.length) return -1;
  const dim = probe.length;
  const centroid = new Array<number>(dim).fill(0);
  let weightSum = 0;
  let templateMax = -1;
  for (const t of templates) {
    const weight = Math.max(0.25, Math.min(1, t.quality));
    weightSum += weight;
    for (let i = 0; i < dim; i++) centroid[i] += (t.embedding[i] ?? 0) * weight;
    templateMax = Math.max(templateMax, dot(probe, t.embedding));
  }
  if (weightSum <= 0) return templateMax;
  let norm = 0;
  for (let i = 0; i < dim; i++) {
    centroid[i] /= weightSum;
    norm += centroid[i] * centroid[i];
  }
  norm = Math.sqrt(norm) || 1;
  let centroidSim = 0;
  for (let i = 0; i < dim; i++) centroidSim += (probe[i] ?? 0) * (centroid[i] / norm);
  if (templateMax <= centroidSim + OUTLIER_GAP) return 0.8 * centroidSim + 0.2 * templateMax;
  return centroidSim;
}

export function bestIdentityScore(probes: Array<{ embedding: number[]; quality: number }>, templates: Array<{ embedding: number[]; quality: number }>): number {
  if (!probes.length || !templates.length) return -1;
  return Math.max(...probes.map((probe) => identityScore(probe.embedding, templates)));
}
