'use client';

import { Download, FileArchive, FileSpreadsheet, FileText, Sheet } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { cn } from '@/components/ui/cn';
import { Button, Modal, Switch } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { downloadFile, errorMessage, type Query } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { tzOffsetMinutes } from '@/lib/format';

type Format = 'pdf' | 'xlsx' | 'csv';

/** Mirrors MAX_IMAGE_ROWS in the backend export service. */
const MAX_IMAGE_ROWS = 500;

const FORMATS: Array<{ value: Format; label: string; description: string; icon: ReactNode }> = [
  { value: 'pdf', label: 'PDF report', description: 'Printable report with face close-ups and full photos.', icon: <FileText className="h-5 w-5" /> },
  { value: 'xlsx', label: 'Excel (.xlsx)', description: 'Spreadsheet with images embedded in each row.', icon: <FileSpreadsheet className="h-5 w-5" /> },
  { value: 'csv', label: 'CSV', description: 'Plain data. With images, downloads a ZIP of the CSV plus image files.', icon: <Sheet className="h-5 w-5" /> },
];

export function ExportDialog({ open, onClose, query }: { open: boolean; onClose: () => void; query: Query }) {
  const { can } = useAuth();
  const notify = useToast();
  const canImages = can('evidence:view');
  const [format, setFormat] = useState<Format>('pdf');
  const [images, setImages] = useState(true);
  const [busy, setBusy] = useState(false);
  const withImages = canImages && images;

  async function run() {
    setBusy(true);
    try {
      const ext = format === 'csv' && withImages ? 'zip' : format;
      await downloadFile('/events/export', { ...query, format, images: withImages, tzOffset: tzOffsetMinutes() }, `vita-eye-events.${ext}`);
      notify('success', 'Export ready', 'The export has been recorded in the audit log.');
      onClose();
    } catch (err) {
      notify('error', 'Export failed', errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={busy ? () => undefined : onClose}
      title="Export detection history"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button icon={format === 'csv' && withImages ? <FileArchive className="h-4 w-4" /> : <Download className="h-4 w-4" />} loading={busy} onClick={() => void run()}>
            {busy ? 'Preparing…' : 'Download'}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-ink-300">Exports every event matching the current filters and sort order.</p>
      <div role="radiogroup" aria-label="Export format" className="grid gap-2 sm:grid-cols-3">
        {FORMATS.map((f) => (
          <button
            key={f.value}
            type="button"
            role="radio"
            aria-checked={format === f.value}
            onClick={() => setFormat(f.value)}
            className={cn(
              'flex flex-col items-start gap-1.5 rounded-xl border p-3 text-left transition',
              format === f.value ? 'border-brand-500/60 bg-brand-600/15 ring-1 ring-brand-500/40' : 'border-ink-700 hover:border-ink-600 hover:bg-ink-800/60',
            )}
          >
            <span className={format === f.value ? 'text-brand-300' : 'text-ink-300'}>{f.icon}</span>
            <span className="text-sm font-medium text-ink-100">{f.label}</span>
            <span className="text-xs text-ink-400">{f.description}</span>
          </button>
        ))}
      </div>
      <div className="mt-4 border-t border-ink-700/70 pt-2">
        <Switch
          checked={withImages}
          onChange={setImages}
          disabled={!canImages}
          label="Include images"
          description={
            canImages
              ? `Face close-up and full photo for each event. Limited to the first ${MAX_IMAGE_ROWS} events; expired evidence is left out.`
              : 'Your role cannot access evidence images, so the export contains data only.'
          }
        />
      </div>
      <p className="mt-2 text-xs text-amber-300/80">Exports with images contain biometric evidence. Store and share them according to your data-protection policy.</p>
    </Modal>
  );
}
