'use client';

import { Download, FileSpreadsheet } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button, Card } from '@/components/ui/primitives';
import { ApiError, api, downloadFile, errorMessage } from '@/lib/api';
import type { PremisesImportResult, PremisesOverview } from '@/lib/premises';

function problems(err: unknown): { message: string; lines: string[] } {
  if (err instanceof ApiError && Array.isArray(err.details)) {
    const lines = (err.details as Array<{ path?: string; message?: string }>)
      .map((item) => [item.path, item.message].filter(Boolean).join(': '))
      .filter(Boolean);
    return { message: err.message, lines };
  }
  return { message: errorMessage(err), lines: [] };
}

export function PremisesImport({ lodging, onUpdated }: { lodging: boolean; onUpdated: (next: PremisesOverview) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [downloading, setDownloading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [tone, setTone] = useState<'ok' | 'bad'>('ok');
  const [lines, setLines] = useState<string[]>([]);

  async function download() {
    setDownloading(true);
    setNotice(null);
    setLines([]);
    try {
      await downloadFile('/premises/import/template', {}, 'vita-eye-floors-rooms-beds.xlsx');
    } catch (err) {
      setTone('bad');
      setNotice(errorMessage(err));
    } finally {
      setDownloading(false);
    }
  }

  async function upload(file: File) {
    setImporting(true);
    setNotice(null);
    setLines([]);
    try {
      const form = new FormData();
      form.append('file', file);
      const { data } = await api.post<PremisesImportResult>('/premises/import', form);
      onUpdated(data.overview);
      setTone('ok');
      setNotice(data.summary.message);
    } catch (err) {
      const parsed = problems(err);
      setTone('bad');
      setNotice(parsed.message);
      setLines(parsed.lines);
    } finally {
      setImporting(false);
    }
  }

  const hint = lodging
    ? 'One row per room. Leave bed labels blank to number the beds 1, 2, 3… up to that room’s capacity.'
    : 'One row per room. Repeat the floor name for every room on that floor.';

  return (
    <Card
      title="Bulk import"
      description="Download the template, fill in the Premises sheet, then import it. Existing floors, rooms and beds stay. Nothing is deleted."
      actions={
        <>
          <Button size="sm" variant="secondary" loading={downloading} disabled={importing} icon={<Download className="h-3.5 w-3.5" />} onClick={() => void download()}>
            Download template
          </Button>
          <Button size="sm" loading={importing} disabled={downloading} icon={<FileSpreadsheet className="h-3.5 w-3.5" />} onClick={() => input.current?.click()}>
            Import spreadsheet
          </Button>
          <input
            ref={input}
            type="file"
            accept=".xlsx,.xlsm,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void upload(file);
            }}
          />
        </>
      }
    >
      <div className="space-y-2 px-5 py-4">
        <p className="text-xs text-ink-400">{hint}</p>
        {notice && <p className={tone === 'ok' ? 'text-sm text-emerald-300' : 'text-sm text-red-300'}>{notice}</p>}
        {lines.length > 0 && (
          <ul className="space-y-1 text-xs text-red-200">
            {lines.slice(0, 8).map((line) => <li key={line}>{line}</li>)}
            {lines.length > 8 && <li>{lines.length - 8} more problems are in the file.</li>}
          </ul>
        )}
      </div>
    </Card>
  );
}
