import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import PDFDocument from 'pdfkit';
import { Organization } from '../models';
import { audit } from './audit.service';
import { findEventsForExport, type EventFilters, type ExportRow } from './detections.service';
import { readEvidenceBatch } from './evidence.service';
import type { AuthContext } from '../types/auth';

export type ExportFormat = 'csv' | 'xlsx' | 'pdf';

export interface ExportOptions {
  format: ExportFormat;
  images: boolean;
  /** Minutes east of UTC used to print local times in PDF / Excel. */
  tzOffset: number;
}

export interface ExportFile {
  body: Buffer;
  contentType: string;
  fileName: string;
}

/** Image exports decrypt every photo in memory, so they are capped. */
export const MAX_IMAGE_ROWS = 500;

const TYPE_LABEL: Record<string, string> = { KNOWN: 'Known person', UNKNOWN: 'Unrecognized person', UNCERTAIN: 'Uncertain match' };
const TYPE_COLOR: Record<string, { fg: string; bg: string; argb: string }> = {
  KNOWN: { fg: '#047857', bg: '#d1fae5', argb: 'FF047857' },
  UNKNOWN: { fg: '#b91c1c', bg: '#fee2e2', argb: 'FFB91C1C' },
  UNCERTAIN: { fg: '#b45309', bg: '#fef3c7', argb: 'FFB45309' },
};
const REVIEW_LABEL: Record<string, string> = { NEW: 'New', ACKNOWLEDGED: 'Acknowledged', INVESTIGATING: 'Investigating', RESOLVED: 'Resolved' };

interface ReportMeta {
  organization: string;
  generatedBy: string;
  generatedAt: Date;
  tzOffset: number;
  filters: string;
  images: boolean;
  truncated: boolean;
}

// ---------- helpers ----------

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function tzLabel(tz: number) {
  const a = Math.abs(tz);
  return `UTC${tz >= 0 ? '+' : '-'}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

function shifted(d: Date | string, tz: number): Date {
  return new Date(new Date(d).getTime() + tz * 60_000);
}

function localTime(d: Date | string, tz: number): string {
  return shifted(d, tz).toISOString().replace('T', ' ').slice(0, 19);
}

function humanize(v: string | null | undefined): string {
  return v ? v.charAt(0) + v.slice(1).toLowerCase().replace(/_/g, ' ') : '';
}

function personText(e: ExportRow): string {
  if (!e.person) return '';
  return e.person.referenceId ? `${e.person.name} (${e.person.referenceId})` : e.person.name;
}

/** Width/height from a JPEG SOF marker, used to keep image aspect ratios in Excel. */
function jpegSize(buf: Buffer): [number, number] | null {
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = buf[i + 1];
    if (marker === 0xff) {
      i++;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      i += 2;
      continue;
    }
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)];
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

function fit(size: [number, number] | null, maxW: number, maxH: number): [number, number] {
  if (!size || !size[0] || !size[1]) return [maxW, maxH];
  const s = Math.min(maxW / size[0], maxH / size[1]);
  return [Math.round(size[0] * s), Math.round(size[1] * s)];
}

function describeFilters(f: EventFilters, tz: number): string {
  const parts: string[] = [];
  if (f.type?.length) parts.push(`Classification: ${f.type.map((t) => TYPE_LABEL[t] ?? t).join(', ')}`);
  if (f.reviewStatus?.length) parts.push(`Review: ${f.reviewStatus.map((s) => REVIEW_LABEL[s] ?? s).join(', ')}`);
  if (f.site) parts.push(`Site: ${f.site}`);
  if (f.cameraId) parts.push('Single camera');
  if (f.personId) parts.push('Single person');
  if (f.from) parts.push(`From: ${localTime(f.from, tz)}`);
  if (f.to) parts.push(`To: ${localTime(f.to, tz)}`);
  if (f.search) parts.push(`Search: "${f.search}"`);
  return parts.length ? parts.join(' · ') : 'All events';
}

function imageName(e: ExportRow, kind: 'face' | 'photo') {
  return `images/${e.id}-${kind}.jpg`;
}

// ---------- CSV / ZIP ----------

function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // CSV/formula injection guard
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function buildCsv(rows: ExportRow[], images: Map<string, Buffer> | null): string {
  const header = ['event_id', 'timestamp_utc', 'event_type', 'review_status', 'resolution', 'similarity', 'quality', 'camera', 'location', 'site', 'person_name', 'reference_id', 'model_version'];
  if (images) header.push('face_image', 'photo_image');
  const lines = [header.join(',')];
  for (const e of rows) {
    const cells: unknown[] = [e.id, e.eventTimestamp, e.eventType, e.reviewStatus, e.resolution, e.confidenceScore, e.qualityScore, e.camera?.name, e.camera?.location, e.camera?.site, e.person?.name, e.person?.referenceId, e.modelVersion];
    if (images) {
      cells.push(e.faceEvidenceId && images.has(e.faceEvidenceId) ? imageName(e, 'face') : '');
      cells.push(e.sceneEvidenceId && images.has(e.sceneEvidenceId) ? imageName(e, 'photo') : '');
    }
    lines.push(cells.map(csvCell).join(','));
  }
  return '\uFEFF' + lines.join('\r\n');
}

async function buildZip(rows: ExportRow[], images: Map<string, Buffer>): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('events.csv', buildCsv(rows, images));
  for (const e of rows) {
    const face = e.faceEvidenceId ? images.get(e.faceEvidenceId) : undefined;
    const photo = e.sceneEvidenceId ? images.get(e.sceneEvidenceId) : undefined;
    // JPEGs are already compressed; storing them avoids wasted CPU.
    if (face) zip.file(imageName(e, 'face'), face, { compression: 'STORE' });
    if (photo) zip.file(imageName(e, 'photo'), photo, { compression: 'STORE' });
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

// ---------- Excel ----------

const XLSX_ROW_PT = 64;
const colPx = (chars: number) => Math.round(chars * 7 + 5);

async function buildXlsx(rows: ExportRow[], images: Map<string, Buffer>, meta: ReportMeta): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'VITA EYE';
  wb.created = meta.generatedAt;
  const ws = wb.addWorksheet('Detection events', { views: [{ state: 'frozen', ySplit: 1 }] });

  const imageCols = meta.images
    ? [
        { header: 'Face', key: 'face', width: 13 },
        { header: 'Photo', key: 'photo', width: 22 },
      ]
    : [];
  ws.columns = [
    ...imageCols,
    { header: `Time (${tzLabel(meta.tzOffset)})`, key: 'time', width: 21, style: { numFmt: 'yyyy-mm-dd hh:mm:ss' } },
    { header: 'Classification', key: 'type', width: 20 },
    { header: 'Person', key: 'person', width: 24 },
    { header: 'Camera', key: 'camera', width: 20 },
    { header: 'Location', key: 'location', width: 18 },
    { header: 'Site', key: 'site', width: 14 },
    { header: 'Similarity', key: 'similarity', width: 11, style: { numFmt: '0.00' } },
    { header: 'Quality', key: 'quality', width: 9, style: { numFmt: '0.00' } },
    { header: 'Review', key: 'review', width: 14 },
    { header: 'Resolution', key: 'resolution', width: 22 },
    { header: 'Frames', key: 'frames', width: 8 },
    { header: 'Event ID', key: 'id', width: 38 },
    { header: 'Model', key: 'model', width: 18 },
  ];

  const header = ws.getRow(1);
  header.height = 22;
  header.eachCell((c) => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
    c.alignment = { vertical: 'middle' };
  });

  const rowPx = Math.round((XLSX_ROW_PT * 96) / 72);
  for (const e of rows) {
    const row = ws.addRow({
      time: shifted(e.eventTimestamp, meta.tzOffset),
      type: TYPE_LABEL[e.eventType] ?? e.eventType,
      person: personText(e),
      camera: e.camera?.name ?? '',
      location: e.camera?.location ?? '',
      site: e.camera?.site ?? '',
      similarity: e.confidenceScore,
      quality: e.qualityScore,
      review: REVIEW_LABEL[e.reviewStatus] ?? e.reviewStatus,
      resolution: humanize(e.resolution),
      frames: e.framesObserved,
      id: e.id,
      model: e.modelVersion,
    });
    row.alignment = { vertical: 'middle', wrapText: true };
    row.getCell('type').font = { bold: true, color: { argb: TYPE_COLOR[e.eventType]?.argb ?? 'FF000000' } };
    if (!meta.images) continue;

    row.height = XLSX_ROW_PT;
    const slots: Array<[string, string | null, number, number]> = [
      ['face', e.faceEvidenceId, 0, 13],
      ['photo', e.sceneEvidenceId, 1, 22],
    ];
    for (const [key, evidenceId, col, width] of slots) {
      const buf = evidenceId ? images.get(evidenceId) : undefined;
      if (!buf) {
        const cell = row.getCell(key);
        cell.value = e.evidenceExpired ? 'Expired' : 'No image';
        cell.font = { italic: true, color: { argb: 'FF94A3B8' } };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        continue;
      }
      const [w, h] = fit(jpegSize(buf), colPx(width) - 10, rowPx - 10);
      const imageId = wb.addImage({ buffer: buf as unknown as ExcelJS.Buffer, extension: 'jpeg' });
      ws.addImage(imageId, { tl: { col: col + 0.06, row: row.number - 1 + 0.06 }, ext: { width: w, height: h }, editAs: 'oneCell' });
    }
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columns.length } };

  const info = wb.addWorksheet('Report info');
  info.columns = [{ width: 22 }, { width: 90 }];
  const lines: Array<[string, string]> = [
    ['Report', 'VITA EYE — Detection History'],
    ['Organization', meta.organization],
    ['Generated', `${localTime(meta.generatedAt, meta.tzOffset)} (${tzLabel(meta.tzOffset)})`],
    ['Generated by', meta.generatedBy],
    ['Filters', meta.filters],
    ['Events', String(rows.length)],
    ['Images', meta.images ? 'Face close-up and full photo embedded' : 'Not included'],
  ];
  if (meta.truncated) lines.push(['Note', `Exports with images are limited to the first ${MAX_IMAGE_ROWS} matching events.`]);
  lines.push(['Confidentiality', 'Contains personal and biometric evidence. Handle according to your data-protection policy.']);
  for (const l of lines) info.addRow(l).getCell(1).font = { bold: true };

  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ---------- PDF ----------

interface PdfColumn {
  key: string;
  label: string;
  width: number;
}

async function buildPdf(rows: ExportRow[], images: Map<string, Buffer>, meta: ReportMeta): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    layout: 'landscape',
    margin: 32,
    bufferPages: true,
    info: { Title: 'VITA EYE — Detection History', Author: 'VITA EYE', Subject: meta.filters },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const finished = new Promise<void>((resolve, reject) => {
    doc.on('end', () => resolve());
    doc.on('error', reject);
  });

  const left = doc.page.margins.left;
  const usable = doc.page.width - left - doc.page.margins.right;
  const bottom = () => doc.page.height - doc.page.margins.bottom - 18;
  const base: PdfColumn[] = [
    ...(meta.images
      ? [
          { key: 'face', label: 'Face', width: 62 },
          { key: 'photo', label: 'Photo', width: 104 },
        ]
      : []),
    { key: 'time', label: `Time (${tzLabel(meta.tzOffset)})`, width: 104 },
    { key: 'type', label: 'Classification', width: 104 },
    { key: 'person', label: 'Person', width: 130 },
    { key: 'camera', label: 'Camera / Location', width: 140 },
    { key: 'similarity', label: 'Similarity', width: 56 },
    { key: 'review', label: 'Review', width: 90 },
  ];
  const scale = usable / base.reduce((s, c) => s + c.width, 0);
  const cols = base.map((c) => ({ ...c, width: c.width * scale }));
  const rowH = meta.images ? 66 : 34;

  // Title block
  doc.font('Helvetica-Bold').fontSize(18).fillColor('#0f172a').text('Detection History Report', left, doc.page.margins.top);
  doc.font('Helvetica').fontSize(9).fillColor('#475569');
  doc.text(`${meta.organization}  ·  Generated ${localTime(meta.generatedAt, meta.tzOffset)} (${tzLabel(meta.tzOffset)}) by ${meta.generatedBy}`);
  doc.text(`Filters: ${meta.filters}`);
  const counts = { UNKNOWN: 0, UNCERTAIN: 0, KNOWN: 0 } as Record<string, number>;
  for (const r of rows) counts[r.eventType] = (counts[r.eventType] ?? 0) + 1;
  doc.moveDown(0.4);
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#0f172a');
  doc.text(`${rows.length} events   ·   `, { continued: true });
  doc.fillColor(TYPE_COLOR.UNKNOWN.fg).text(`${counts.UNKNOWN} unrecognized   ·   `, { continued: true });
  doc.fillColor(TYPE_COLOR.UNCERTAIN.fg).text(`${counts.UNCERTAIN} uncertain   ·   `, { continued: true });
  doc.fillColor(TYPE_COLOR.KNOWN.fg).text(`${counts.KNOWN} known`);
  if (meta.truncated) {
    doc.font('Helvetica-Oblique').fontSize(8).fillColor('#b45309').text(`Exports with images are limited to the first ${MAX_IMAGE_ROWS} matching events.`);
  }
  let y = doc.y + 10;

  const drawHeader = () => {
    doc.rect(left, y, usable, 20).fill('#0f172a');
    let x = left;
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#ffffff');
    for (const c of cols) {
      doc.text(c.label, x + 5, y + 6, { width: c.width - 10, lineBreak: false, ellipsis: true });
      x += c.width;
    }
    y += 20;
  };

  const cellText = (text: string, x: number, w: number, opts: { color?: string; bold?: boolean; size?: number; sub?: string } = {}) => {
    const size = opts.size ?? 8;
    doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size);
    const mainH = Math.min(doc.heightOfString(text || ' ', { width: w - 10 }), rowH - 10);
    const subH = opts.sub ? 10 : 0;
    const top = y + (rowH - mainH - subH) / 2;
    doc.fillColor(opts.color ?? '#0f172a').text(text, x + 5, top, { width: w - 10, height: rowH - 10 - subH, ellipsis: true });
    if (opts.sub) doc.font('Helvetica').fontSize(6.5).fillColor('#94a3b8').text(opts.sub, x + 5, top + mainH + 1, { width: w - 10, lineBreak: false, ellipsis: true });
  };

  drawHeader();
  if (!rows.length) {
    doc.font('Helvetica-Oblique').fontSize(10).fillColor('#64748b').text('No events match the selected filters.', left, y + 16, { width: usable, align: 'center' });
  }

  rows.forEach((e, idx) => {
    if (y + rowH > bottom()) {
      doc.addPage();
      y = doc.page.margins.top;
      drawHeader();
    }
    if (idx % 2 === 1) doc.rect(left, y, usable, rowH).fill('#f8fafc');
    let x = left;
    for (const c of cols) {
      switch (c.key) {
        case 'face':
        case 'photo': {
          const id = c.key === 'face' ? e.faceEvidenceId : e.sceneEvidenceId;
          const buf = id ? images.get(id) : undefined;
          if (buf) {
            try {
              doc.image(buf, x + 4, y + 4, { fit: [c.width - 8, rowH - 8], align: 'center', valign: 'center' });
            } catch {
              cellText('Unreadable', x, c.width, { color: '#94a3b8' });
            }
          } else {
            cellText(e.evidenceExpired ? 'Expired' : 'No image', x, c.width, { color: '#94a3b8' });
          }
          break;
        }
        case 'time':
          cellText(localTime(e.eventTimestamp, meta.tzOffset), x, c.width, { sub: `#${e.id.slice(0, 8)}` });
          break;
        case 'type': {
          const label = TYPE_LABEL[e.eventType] ?? e.eventType;
          const color = TYPE_COLOR[e.eventType] ?? { fg: '#0f172a', bg: '#e2e8f0' };
          doc.font('Helvetica-Bold').fontSize(7.5);
          const pillW = Math.min(doc.widthOfString(label) + 12, c.width - 8);
          const pillY = y + rowH / 2 - 7;
          doc.roundedRect(x + 4, pillY, pillW, 14, 7).fill(color.bg);
          doc.fillColor(color.fg).text(label, x + 10, pillY + 3.5, { width: pillW - 12, lineBreak: false, ellipsis: true });
          break;
        }
        case 'person':
          cellText(e.person?.name ?? '—', x, c.width, { bold: !!e.person, sub: e.person?.referenceId || undefined, color: e.person ? '#0f172a' : '#94a3b8' });
          break;
        case 'camera':
          cellText(e.camera?.name ?? '—', x, c.width, { sub: [e.camera?.location, e.camera?.site].filter(Boolean).join(' · ') || undefined });
          break;
        case 'similarity':
          cellText(e.confidenceScore !== null ? e.confidenceScore.toFixed(2) : '—', x, c.width);
          break;
        case 'review':
          cellText(REVIEW_LABEL[e.reviewStatus] ?? e.reviewStatus, x, c.width, { sub: e.resolution ? humanize(e.resolution) : undefined });
          break;
      }
      x += c.width;
    }
    doc.moveTo(left, y + rowH).lineTo(left + usable, y + rowH).lineWidth(0.5).strokeColor('#e2e8f0').stroke();
    y += rowH;
  });

  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const keepBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0; // writing inside the margin must not trigger an automatic page break
    const fy = doc.page.height - keepBottom + 8;
    doc.font('Helvetica').fontSize(7).fillColor('#94a3b8');
    doc.text('VITA EYE · Confidential — contains personal and biometric evidence', left, fy, { width: usable / 2, lineBreak: false });
    doc.text(`Page ${i - range.start + 1} of ${range.count}`, left + usable / 2, fy, { width: usable / 2, align: 'right', lineBreak: false });
    doc.page.margins.bottom = keepBottom;
  }

  doc.end();
  await finished;
  return Buffer.concat(chunks);
}

// ---------- entry point ----------

export async function exportEvents(ctx: AuthContext, f: EventFilters, opts: ExportOptions, ip: string | null): Promise<ExportFile> {
  const withImages = opts.images && ctx.permissions.has('evidence:view');
  const limit = withImages ? Math.min(f.pageSize, MAX_IMAGE_ROWS) : f.pageSize;
  // Fetch one extra row to tell whether the image cap cut the result short.
  const fetched = await findEventsForExport(ctx, { ...f, pageSize: withImages ? limit + 1 : limit });
  const truncated = withImages && fetched.length > limit;
  const rows = fetched.slice(0, limit);

  const ids = withImages ? rows.flatMap((e) => [e.faceEvidenceId, e.sceneEvidenceId]).filter((x): x is string => !!x) : [];
  const images = withImages ? await readEvidenceBatch(ctx, ids) : new Map<string, Buffer>();

  const org = await Organization.findByPk(ctx.organizationId, { attributes: ['name'] });
  const meta: ReportMeta = {
    organization: org?.name ?? 'VITA EYE',
    generatedBy: ctx.name,
    generatedAt: new Date(),
    tzOffset: opts.tzOffset,
    filters: describeFilters(f, opts.tzOffset),
    images: withImages,
    truncated,
  };

  const stamp = localTime(meta.generatedAt, opts.tzOffset).slice(0, 10);
  let file: ExportFile;
  if (opts.format === 'pdf') {
    file = { body: await buildPdf(rows, images, meta), contentType: 'application/pdf', fileName: `vita-eye-events-${stamp}.pdf` };
  } else if (opts.format === 'xlsx') {
    file = {
      body: await buildXlsx(rows, images, meta),
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      fileName: `vita-eye-events-${stamp}.xlsx`,
    };
  } else if (withImages) {
    file = { body: await buildZip(rows, images), contentType: 'application/zip', fileName: `vita-eye-events-${stamp}.zip` };
  } else {
    file = { body: Buffer.from(buildCsv(rows, null), 'utf8'), contentType: 'text/csv; charset=utf-8', fileName: `vita-eye-events-${stamp}.csv` };
  }

  await audit({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    action: 'EVENTS_EXPORTED',
    entityType: 'detection_event',
    ipAddress: ip,
    metadata: {
      format: opts.format,
      rows: rows.length,
      imagesRequested: opts.images,
      imagesExported: images.size,
      truncated,
      filters: { ...f, from: f.from?.toISOString(), to: f.to?.toISOString() },
    },
  });
  return file;
}
