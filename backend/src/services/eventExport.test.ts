import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthContext } from '../types/auth';
import type { EventFilters, ExportRow } from './detections.service';

// 16x12 baseline JPEG.
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCAAMABADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwCWiiivLPVP/9k=',
  'base64',
);

const mocks = vi.hoisted(() => ({
  findEventsForExport: vi.fn(),
  readEvidenceBatch: vi.fn(),
  audit: vi.fn(),
}));
vi.mock('../models', () => ({ Organization: { findByPk: vi.fn().mockResolvedValue({ name: 'Demo Org' }) } }));
vi.mock('./audit.service', () => ({ audit: mocks.audit }));
vi.mock('./detections.service', () => ({ findEventsForExport: mocks.findEventsForExport }));
vi.mock('./evidence.service', () => ({ readEvidenceBatch: mocks.readEvidenceBatch }));

const { exportEvents } = await import('./eventExport.service');

function row(i: number, type: 'UNKNOWN' | 'UNCERTAIN' | 'KNOWN'): ExportRow {
  return {
    id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    eventType: type,
    confidenceScore: 0.31,
    qualityScore: 0.8,
    eventTimestamp: new Date('2026-10-08T10:31:59Z'),
    reviewStatus: 'NEW',
    modelVersion: 'buffalo_l',
    framesObserved: 3,
    camera: { id: 'c1', name: 'laptop camera', location: 'room', site: null },
    person: type === 'KNOWN' ? { id: 'p1', name: 'Asha', referenceId: 'EMP-1', department: null, deleted: false } : null,
    hasEvidence: true,
    evidenceId: `face-${i}`,
    faceEvidenceId: `face-${i}`,
    sceneEvidenceId: `scene-${i}`,
    evidenceExpired: false,
    createdAt: new Date('2026-10-08T10:31:59Z'),
    resolution: null,
  } as unknown as ExportRow;
}

const filters: EventFilters = { page: 1, pageSize: 5000, order: 'desc', sort: 'eventTimestamp' };
const ctx = (perms: string[]) => ({ userId: 'u1', organizationId: 'o1', name: 'Admin', permissions: new Set(perms) }) as unknown as AuthContext;

describe('exportEvents', () => {
  const rows = [row(1, 'UNKNOWN'), row(2, 'UNCERTAIN'), row(3, 'KNOWN')];

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findEventsForExport.mockResolvedValue(rows);
    mocks.readEvidenceBatch.mockImplementation(async (_c: unknown, ids: string[]) => new Map(ids.map((id) => [id, JPEG])));
  });

  it('builds a PDF report with embedded images', async () => {
    const file = await exportEvents(ctx(['evidence:view']), filters, { format: 'pdf', images: true, tzOffset: 330 }, null);
    expect(file.contentType).toBe('application/pdf');
    expect(file.body.subarray(0, 5).toString()).toBe('%PDF-');
    expect(file.body.toString('latin1')).toContain('/Subtype /Image');
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'EVENTS_EXPORTED', metadata: expect.objectContaining({ format: 'pdf', imagesExported: 6 }) }));
  });

  it('builds an Excel workbook with one face and one photo per event', async () => {
    const file = await exportEvents(ctx(['evidence:view']), filters, { format: 'xlsx', images: true, tzOffset: 330 }, null);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(file.body as unknown as ExcelJS.Buffer);
    const ws = wb.getWorksheet('Detection events')!;
    expect(ws.rowCount).toBe(4);
    expect(ws.getImages()).toHaveLength(6);
    expect(ws.getRow(2).getCell(4).value).toBe('Unrecognized person');
  });

  it('bundles CSV and images into a ZIP when images are requested', async () => {
    const file = await exportEvents(ctx(['evidence:view']), filters, { format: 'csv', images: true, tzOffset: 0 }, null);
    expect(file.fileName).toMatch(/\.zip$/);
    const zip = await JSZip.loadAsync(file.body);
    const csv = await zip.file('events.csv')!.async('string');
    expect(csv).toContain('face_image,photo_image');
    expect(zip.file(`images/${rows[0].id}-face.jpg`)).not.toBeNull();
  });

  it('never includes images without the evidence:view permission', async () => {
    const file = await exportEvents(ctx([]), filters, { format: 'csv', images: true, tzOffset: 0 }, null);
    expect(file.contentType).toContain('text/csv');
    expect(mocks.readEvidenceBatch).not.toHaveBeenCalled();
  });

  it('caps image exports and reports truncation', async () => {
    await exportEvents(ctx(['evidence:view']), { ...filters, pageSize: 5000 }, { format: 'xlsx', images: true, tzOffset: 0 }, null);
    expect(mocks.findEventsForExport).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ pageSize: 501 }));
  });
});
