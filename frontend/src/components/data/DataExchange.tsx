'use client';

import { ArrowLeftRight, Download, FileArchive, FileSpreadsheet, ScanFace, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { Badge, Button, Card, Field, Input, PageHeader, PasswordInput, Select } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { ApiError, api, downloadBlob, downloadFile, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';

interface ExchangeReport {
  applied: boolean;
  ready: boolean;
  message: string;
  issues: Array<{ path: string; message: string }>;
  notes: string[];
  counts: Record<string, number>;
  rows: Array<{ label: string; action: string; detail: string }>;
}

const ACTION_TONE: Record<string, 'green' | 'red' | 'neutral' | 'amber'> = {
  create: 'green',
  update: 'green',
  restore: 'green',
  add: 'green',
  ready: 'green',
  enrolled: 'green',
  unchanged: 'neutral',
  skip: 'neutral',
  missing: 'amber',
  conflict: 'red',
  error: 'red',
  failed: 'red',
};

function Report({ report }: { report: ExchangeReport | null }) {
  if (!report) return null;
  return (
    <div className="space-y-3 border-t border-ink-700/70 px-5 py-4">
      <p className={report.ready || report.applied ? 'text-sm text-emerald-300' : 'text-sm text-amber-200'}>{report.message}</p>
      {report.notes.map((note) => (
        <p key={note} className="text-xs text-ink-400">{note}</p>
      ))}
      {report.issues.length > 0 && (
        <ul className="space-y-1 text-xs text-red-200">
          {report.issues.slice(0, 8).map((issue) => (
            <li key={`${issue.path}:${issue.message}`}>{issue.path}: {issue.message}</li>
          ))}
        </ul>
      )}
      {report.rows.length > 0 && (
        <ul className="divide-y divide-ink-800 rounded-xl border border-ink-700">
          {report.rows.slice(0, 8).map((row) => (
            <li key={`${row.label}:${row.detail}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span className="min-w-0">
                <span className="block text-sm text-ink-100">{row.label}</span>
                <span className="block text-xs text-ink-400">{row.detail}</span>
              </span>
              <Badge tone={ACTION_TONE[row.action] ?? 'neutral'}>{row.action}</Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function useFile() {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  return { input, file, setFile, clear: () => setFile(null) };
}

export function DataExchange() {
  const { can, user } = useAuth();
  const hostel = user?.organization?.organizationType === 'HOSTEL';
  const reference = hostel ? 'mobile number' : 'reference ID';
  const department = hostel ? 'room number' : 'department';
  const canImport = can('data:import');
  const canFacesOut = can('faces:export');
  const canFacesIn = can('faces:import');

  return (
    <>
      <PageHeader
        title="Data exchange"
        icon={<ArrowLeftRight className="h-5 w-5" />}
        description="Move the people directory and stored faces into or out of this organization. A spreadsheet never contains a face. A face package does not open without its passphrase."
      />
      <Card>
        <ol className="space-y-2 px-5 py-4 text-sm text-ink-200">
          <li><span className="font-medium text-ink-100">1. People.</span> Export or import the directory. Faces that are already stored stay where they are.</li>
          <li><span className="font-medium text-ink-100">2. Faces.</span> Export an encrypted package, restore one, or enroll a ZIP of photos for people who are already registered.</li>
          <li><span className="font-medium text-ink-100">3. Preview, then confirm.</span> The preview is the exact change that will be saved. An import never deletes a person.</li>
        </ol>
      </Card>
      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <PeopleExport hostel={hostel} />
        {canImport && <PeopleImport reference={reference} department={department} />}
        {canFacesOut && <FaceExport />}
        {canFacesIn && <FaceImport />}
      </div>
      {canFacesIn && (
        <div className="mt-4">
          <PhotoImport reference={reference} />
        </div>
      )}
      {!canImport && !canFacesOut && (
        <p className="mt-4 text-sm text-ink-400">Super admins and Security admins can also import records and move facial data.</p>
      )}
    </>
  );
}

function PeopleExport({ hostel }: { hostel: boolean }) {
  const notify = useToast();
  const [format, setFormat] = useState<'xlsx' | 'csv'>('xlsx');
  const [status, setStatus] = useState('');
  const [enrollment, setEnrollment] = useState('');
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      await downloadFile('/data/people/export', { format, status, enrollmentStatus: enrollment }, `vita-eye-people.${format}`);
      notify('success', 'Directory exported', 'The file has names and status only. It does not contain faces.');
    } catch (err) {
      notify('error', 'Export failed', errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Export people" description="A spreadsheet of the directory. Share it as ordinary personal data, not as biometric data.">
      <div className="grid gap-3 px-5 py-4 sm:grid-cols-3">
        <Field label="Format">
          <Select value={format} onChange={(event) => setFormat(event.target.value as 'xlsx' | 'csv')}>
            <option value="xlsx">Excel (.xlsx)</option>
            <option value="csv">CSV</option>
          </Select>
        </Field>
        <Field label="Status">
          <Select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">Everyone</option>
            <option value="ACTIVE">Active</option>
            <option value="SUSPENDED">Suspended</option>
            <option value="INACTIVE">Inactive</option>
          </Select>
        </Field>
        <Field label="Enrollment">
          <Select value={enrollment} onChange={(event) => setEnrollment(event.target.value)}>
            <option value="">Any enrollment</option>
            <option value="ENROLLED">Enrolled</option>
            <option value="PENDING">Not enrolled</option>
            <option value="FAILED">Failed</option>
            <option value="REVOKED">Revoked</option>
          </Select>
        </Field>
      </div>
      <div className="flex justify-end border-t border-ink-700/70 px-5 py-4">
        <Button icon={<Download className="h-4 w-4" />} loading={busy} onClick={() => void run()}>Download {hostel ? 'tenants' : 'people'}</Button>
      </div>
    </Card>
  );
}

function PeopleImport({ reference, department }: { reference: string; department: string }) {
  const notify = useToast();
  const picker = useFile();
  const [mode, setMode] = useState<'add' | 'upsert'>('upsert');
  const [busy, setBusy] = useState(false);
  const [templateBusy, setTemplateBusy] = useState(false);
  const [report, setReport] = useState<ExchangeReport | null>(null);

  async function template() {
    setTemplateBusy(true);
    try {
      await downloadFile('/data/people/template', {}, 'vita-eye-people-template.xlsx');
    } catch (err) {
      notify('error', 'Template failed', errorMessage(err));
    } finally {
      setTemplateBusy(false);
    }
  }

  async function run(dryRun: boolean) {
    if (!picker.file) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', picker.file);
      form.append('mode', mode);
      form.append('dryRun', String(dryRun));
      const { data } = await api.post<ExchangeReport>('/data/people/import', form);
      setReport(data);
      if (!dryRun && data.applied) notify('success', 'People imported', data.message);
    } catch (err) {
      notify('error', 'Import failed', errorMessage(err));
      if (err instanceof ApiError) setReport(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Import people"
      description={`Match on ${reference}. Blank ${department} cells keep the current value. Faces are not touched.`}
      actions={
        <Button size="sm" variant="secondary" icon={<Download className="h-3.5 w-3.5" />} loading={templateBusy} onClick={() => void template()}>
          Template
        </Button>
      }
    >
      <div className="space-y-3 px-5 py-4">
        <Field label="When the person already exists">
          <Select value={mode} onChange={(event) => { setMode(event.target.value as 'add' | 'upsert'); setReport(null); }}>
            <option value="upsert">Update name, {department} and status, and add new people</option>
            <option value="add">Add new people only</option>
          </Select>
        </Field>
        <FilePick picker={picker} accept=".xlsx,.xlsm,.csv" label="Spreadsheet" onChange={() => setReport(null)} />
      </div>
      <Report report={report} />
      <div className="flex flex-wrap justify-end gap-2 border-t border-ink-700/70 px-5 py-4">
        <Button variant="secondary" icon={<FileSpreadsheet className="h-4 w-4" />} disabled={!picker.file} loading={busy && !report?.ready} onClick={() => void run(true)}>Preview</Button>
        <Button icon={<Upload className="h-4 w-4" />} disabled={!report?.ready || report.applied} loading={busy && Boolean(report?.ready)} onClick={() => void run(false)}>Import people</Button>
      </div>
    </Card>
  );
}

function FaceExport() {
  const notify = useToast();
  const [scope, setScope] = useState<'all' | 'active'>('all');
  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const mismatch = confirm.length > 0 && passphrase !== confirm;

  async function run() {
    if (passphrase.length < 12 || passphrase !== confirm) return;
    setBusy(true);
    try {
      await downloadBlob('/data/faces/export', { passphrase, scope }, 'vita-eye-faces.zip');
      setPassphrase('');
      setConfirm('');
      notify('success', 'Facial package exported', 'The file is encrypted. Keep the passphrase with it — Vita Eye cannot recover it.');
    } catch (err) {
      notify('error', 'Export failed', errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Export facial data" description="Every stored template is sealed with your passphrase. The download does not contain a readable face or embedding.">
      <div className="space-y-3 px-5 py-4">
        <Field label="Who to include">
          <Select value={scope} onChange={(event) => setScope(event.target.value as 'all' | 'active')}>
            <option value="all">Everyone with a stored face, including suspended and inactive</option>
            <option value="active">Active enrolled people only</option>
          </Select>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Passphrase" hint="12 to 128 characters. Store it outside this file.">
            <PasswordInput autoComplete="new-password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} />
          </Field>
          <Field label="Confirm passphrase" error={mismatch ? 'The passphrases do not match' : undefined}>
            <PasswordInput autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} />
          </Field>
        </div>
        <p className="text-xs text-amber-200/90">Treat this file as biometric data. The audit log records that an export happened, not the passphrase and not the faces.</p>
      </div>
      <div className="flex justify-end border-t border-ink-700/70 px-5 py-4">
        <Button icon={<FileArchive className="h-4 w-4" />} loading={busy} disabled={passphrase.length < 12 || passphrase !== confirm} onClick={() => void run()}>
          Download encrypted package
        </Button>
      </div>
    </Card>
  );
}

function FaceImport() {
  const notify = useToast();
  const picker = useFile();
  const [passphrase, setPassphrase] = useState('');
  const [missingPeople, setMissingPeople] = useState<'create' | 'skip'>('create');
  const [existingFaces, setExistingFaces] = useState<'replace' | 'skip' | 'add'>('skip');
  const [acceptModel, setAcceptModel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<ExchangeReport | null>(null);

  function resetPlan() {
    setReport(null);
    setAcceptModel(false);
  }

  async function run(dryRun: boolean) {
    if (!picker.file || !passphrase) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', picker.file);
      form.append('passphrase', passphrase);
      form.append('dryRun', String(dryRun));
      form.append('missingPeople', missingPeople);
      form.append('existingFaces', existingFaces);
      form.append('acceptModel', String(!dryRun && acceptModel));
      const { data } = await api.post<ExchangeReport>('/data/faces/import', form);
      setReport(data);
      if (!dryRun && data.applied) notify('success', 'Faces restored', data.message);
    } catch (err) {
      notify('error', 'Restore failed', errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Restore a facial package" description="Opens a package from this organization or another Vita Eye organization. People are matched by reference ID.">
      <div className="space-y-3 px-5 py-4">
        <FilePick picker={picker} accept=".zip,application/zip" label="Package (.zip)" onChange={resetPlan} />
        <Field label="Passphrase">
          <PasswordInput autoComplete="current-password" value={passphrase} onChange={(event) => { setPassphrase(event.target.value); resetPlan(); }} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="If the person is not registered">
            <Select value={missingPeople} onChange={(event) => { setMissingPeople(event.target.value as 'create' | 'skip'); resetPlan(); }}>
              <option value="create">Create them and store the face</option>
              <option value="skip">Skip them</option>
            </Select>
          </Field>
          <Field label="If they already have a face">
            <Select value={existingFaces} onChange={(event) => { setExistingFaces(event.target.value as 'replace' | 'skip' | 'add'); resetPlan(); }}>
              <option value="skip">Leave the stored face</option>
              <option value="replace">Replace it with the package</option>
              <option value="add">Add the package templates</option>
            </Select>
          </Field>
        </div>
      </div>
      <Report report={report} />
      <div className="space-y-3 border-t border-ink-700/70 px-5 py-4">
        <label className="flex items-start gap-2 text-sm text-ink-200">
          <input type="checkbox" className="mt-1" checked={acceptModel} onChange={(event) => setAcceptModel(event.target.checked)} />
          <span>These templates match the recognition model running here. A different model will not recognize them.</span>
        </label>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" icon={<ScanFace className="h-4 w-4" />} disabled={!picker.file || passphrase.length < 12} loading={busy && !report?.ready} onClick={() => void run(true)}>Preview</Button>
          <Button icon={<Upload className="h-4 w-4" />} disabled={!report?.ready || !acceptModel || report.applied} loading={busy && Boolean(report?.ready)} onClick={() => void run(false)}>Restore faces</Button>
        </div>
      </div>
    </Card>
  );
}

function PhotoImport({ reference }: { reference: string }) {
  const notify = useToast();
  const picker = useFile();
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [legalBasis, setLegalBasis] = useState('CONSENT');
  const [consentReference, setConsentReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<ExchangeReport | null>(null);

  async function run(dryRun: boolean) {
    if (!picker.file) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', picker.file);
      form.append('dryRun', String(dryRun));
      form.append('replaceExisting', String(replaceExisting));
      if (!dryRun) {
        form.append('legalBasis', legalBasis);
        form.append('consentReference', consentReference.trim());
      }
      const { data } = await api.post<ExchangeReport>('/data/faces/photos', form);
      setReport(data);
      if (!dryRun && data.applied) notify('success', 'Photos enrolled', data.message);
      if (!dryRun && !data.applied) notify('error', 'No photos enrolled', data.message);
    } catch (err) {
      notify('error', 'Enrollment failed', errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Enroll faces from photos" description={`ZIP of JPEG, PNG or WebP. Name a file with the ${reference} (EMP-100.jpg) or put the photos in a folder of that name (EMP-100/front.jpg). Up to five photos per person.`}>
      <div className="grid gap-3 px-5 py-4 lg:grid-cols-3">
        <FilePick picker={picker} accept=".zip,application/zip" label="Photo ZIP" onChange={() => setReport(null)} />
        <Field label="Photos already on file">
          <Select value={replaceExisting ? 'replace' : 'keep'} onChange={(event) => { setReplaceExisting(event.target.value === 'replace'); setReport(null); }}>
            <option value="keep">Keep stored templates and add these</option>
            <option value="replace">Replace stored templates</option>
          </Select>
        </Field>
        <Field label="Lawful basis">
          <Select value={legalBasis} onChange={(event) => setLegalBasis(event.target.value)}>
            <option value="CONSENT">Explicit consent of the individual</option>
            <option value="EMPLOYMENT">Employment-related purpose (documented)</option>
            <option value="LEGAL_OBLIGATION">Compliance with a legal obligation</option>
            <option value="LEGITIMATE_USE">Other legitimate use permitted by law</option>
            <option value="OTHER">Other (documented in the reference)</option>
          </Select>
        </Field>
        <Field label="Consent or policy reference" hint="Recorded on every person this ZIP enrolls.">
          <Input value={consentReference} placeholder="CONSENT-2026-0042" onChange={(event) => setConsentReference(event.target.value)} />
        </Field>
      </div>
      <Report report={report} />
      <div className="flex flex-wrap justify-end gap-2 border-t border-ink-700/70 px-5 py-4">
        <Button variant="secondary" disabled={!picker.file} loading={busy && !report?.ready} onClick={() => void run(true)}>Preview</Button>
        <Button icon={<Upload className="h-4 w-4" />} disabled={!report?.ready || report.applied || consentReference.trim().length < 2} loading={busy && Boolean(report?.ready)} onClick={() => void run(false)}>Enroll photos</Button>
      </div>
    </Card>
  );
}

function FilePick({ picker, accept, label, onChange }: { picker: ReturnType<typeof useFile>; accept: string; label: string; onChange: () => void }) {
  return (
    <Field label={label}>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="secondary" onClick={() => picker.input.current?.click()}>Choose file</Button>
        <span className="truncate text-xs text-ink-300">{picker.file ? picker.file.name : 'No file chosen'}</span>
        <input
          ref={picker.input}
          type="file"
          accept={accept}
          className="hidden"
          onChange={(event) => {
            picker.setFile(event.target.files?.[0] ?? null);
            event.target.value = '';
            onChange();
          }}
        />
      </div>
    </Field>
  );
}
