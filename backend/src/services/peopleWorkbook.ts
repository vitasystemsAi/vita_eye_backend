import ExcelJS from 'exceljs';
import { AppError } from '../utils/errors';
import type { PersonStatus } from '../utils/personStatus';

export const MAX_PEOPLE_ROWS = 5000;
const MAX_SCAN_ROWS = 5200;

const PEOPLE = 'People';
const EXAMPLE = 'Example';
const INSTRUCTIONS = 'Instructions';

export interface ImportIssue {
  path: string;
  message: string;
}

export interface PeopleLabels {
  hostel: boolean;
  reference: string;
  department: string;
}

export interface PlannedPerson {
  row: number;
  personName: string;
  referenceId: string;
  department: string | null;
  departmentSpecified: boolean;
  status: PersonStatus | null;
  problems: string[];
}

export interface PeopleExportRow {
  personName: string;
  referenceId: string;
  department: string | null;
  status: PersonStatus;
  enrollmentStatus: string;
  templateCount: number;
  legalBasis: string | null;
  consentReference: string | null;
  createdAt: Date;
}

export interface ExistingPerson {
  id: string;
  referenceId: string;
  personName: string;
  department: string | null;
  status: PersonStatus;
}

export type PeopleAction = 'create' | 'update' | 'unchanged' | 'error';

export interface ResolvedPerson {
  row: number;
  existingId: string | null;
  referenceId: string;
  personName: string;
  department: string | null;
  departmentSpecified: boolean;
  status: PersonStatus | null;
  action: PeopleAction;
  detail: string;
}

const HEADER_FIELDS: Record<string, 'name' | 'referenceId' | 'department' | 'status'> = {
  name: 'name',
  'person name': 'name',
  'full name': 'name',
  'tenant name': 'name',
  'reference id': 'referenceId',
  reference_id: 'referenceId',
  reference: 'referenceId',
  'employee id': 'referenceId',
  'mobile number': 'referenceId',
  mobile: 'referenceId',
  phone: 'referenceId',
  department: 'department',
  'room number': 'department',
  room: 'department',
  ward: 'department',
  status: 'status',
};

const STATUS_FROM_LABEL: Record<string, PersonStatus> = {
  active: 'ACTIVE',
  suspended: 'SUSPENDED',
  inactive: 'INACTIVE',
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  INACTIVE: 'INACTIVE',
};

const STATUS_LABEL: Record<PersonStatus, string> = {
  ACTIVE: 'Active',
  SUSPENDED: 'Suspended',
  INACTIVE: 'Inactive',
};

const ENROLLMENT_LABEL: Record<string, string> = {
  ENROLLED: 'Enrolled',
  PENDING: 'Not enrolled',
  FAILED: 'Failed',
  REVOKED: 'Revoked',
};

function clean(value: string): string {
  return value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function fold(value: string): string {
  return clean(value).toLowerCase();
}

function unescapeCell(value: string): string {
  const text = clean(value);
  if (text.startsWith("'") && /^[=+\-@\t\r]/.test(text.slice(1))) return text.slice(1);
  return text;
}

function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? '' : value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function fileSlug(organizationName: string): string {
  const slug = organizationName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  return slug || 'organization';
}

export function peopleHeaders(labels: PeopleLabels): string[] {
  return ['Name', labels.reference, labels.department, 'Status', 'Enrollment', 'Templates', 'Legal basis', 'Consent reference', 'Registered'];
}

function parseCsv(text: string): string[][] {
  const source = text.replace(/^\uFEFF/, '');
  const first = source.split(/\r?\n/, 1)[0] ?? '';
  const commas = (first.match(/,/g) ?? []).length;
  const semis = (first.match(/;/g) ?? []).length;
  const tabs = (first.match(/\t/g) ?? []).length;
  const delimiter = tabs > commas && tabs > semis ? '\t' : semis > commas ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') {
      quoted = true;
      continue;
    }
    if (ch === delimiter) {
      row.push(cell);
      cell = '';
      continue;
    }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && source[i + 1] === '\n') i += 1;
      row.push(cell);
      cell = '';
      rows.push(row.map(unescapeCell));
      row = [];
      continue;
    }
    cell += ch;
  }
  row.push(cell);
  if (row.some((value) => value !== '') || rows.length === 0) rows.push(row.map(unescapeCell));
  return rows;
}

function matrixFromSheet(sheet: ExcelJS.Worksheet): string[][] {
  const rows: string[][] = [];
  const last = Math.min(sheet.rowCount, MAX_SCAN_ROWS);
  for (let r = 1; r <= last; r++) {
    const excelRow = sheet.getRow(r);
    const width = Math.max(excelRow.cellCount, sheet.columnCount, 1);
    const cells: string[] = [];
    for (let c = 1; c <= Math.min(width, 20); c++) cells.push(unescapeCell(excelRow.getCell(c).text ?? ''));
    rows.push(cells);
  }
  return rows;
}

function sheetByName(workbook: ExcelJS.Workbook, name: string) {
  const want = name.toLowerCase();
  return workbook.worksheets.find((sheet) => sheet.name.toLowerCase() === want);
}

export function planPeopleSheet(matrix: string[][], labels: PeopleLabels): { issues: ImportIssue[]; people: PlannedPerson[] } {
  let headerAt = -1;
  let columns: Partial<Record<'name' | 'referenceId' | 'department' | 'status', number>> = {};
  const scan = Math.min(matrix.length, 15);
  for (let r = 0; r < scan; r++) {
    const found: Partial<Record<'name' | 'referenceId' | 'department' | 'status', number>> = {};
    matrix[r]?.forEach((cell, index) => {
      const field = HEADER_FIELDS[fold(cell)];
      if (field && found[field] === undefined) found[field] = index;
    });
    if (found.name !== undefined && found.referenceId !== undefined) {
      headerAt = r;
      columns = found;
      break;
    }
  }
  if (headerAt < 0 || columns.name === undefined || columns.referenceId === undefined) {
    return { issues: [{ path: 'People', message: `The header row must include Name and ${labels.reference}.` }], people: [] };
  }

  const people: PlannedPerson[] = [];
  const seen = new Map<string, number>();
  for (let r = headerAt + 1; r < matrix.length; r++) {
    const line = matrix[r] ?? [];
    if (!line.some((cell) => cell !== '')) continue;
    if (people.length >= MAX_PEOPLE_ROWS) {
      return { issues: [{ path: 'File', message: `This sheet has more than ${MAX_PEOPLE_ROWS} people. Split it and import each part.` }], people: [] };
    }
    const personName = clean(line[columns.name] ?? '');
    const referenceId = clean(line[columns.referenceId] ?? '');
    const departmentRaw = columns.department === undefined ? '' : clean(line[columns.department] ?? '');
    const statusRaw = columns.status === undefined ? '' : clean(line[columns.status] ?? '');
    const problems: string[] = [];
    if (!personName) problems.push('Name is required');
    else if (personName.length > 160) problems.push('Name must be 160 characters or fewer');
    if (!referenceId) problems.push(`${labels.reference} is required`);
    else if (referenceId.length > 64) problems.push(`${labels.reference} must be 64 characters or fewer`);
    else if (labels.hostel) {
      if (!/^\d{10}$/.test(referenceId)) problems.push('Enter a 10-digit mobile number');
    } else if (!/^[A-Za-z0-9._\-/]+$/.test(referenceId)) {
      problems.push(`${labels.reference} may contain letters, digits, . _ - /`);
    }
    if (labels.hostel && columns.department !== undefined && !departmentRaw) problems.push(`${labels.department} is required`);
    if (departmentRaw.length > 120) problems.push(`${labels.department} must be 120 characters or fewer`);
    let status: PersonStatus | null = null;
    if (statusRaw) {
      status = STATUS_FROM_LABEL[statusRaw] ?? STATUS_FROM_LABEL[statusRaw.toUpperCase()] ?? null;
      if (!status) problems.push('Status must be Active, Suspended or Inactive');
    }
    const key = fold(referenceId);
    if (key) {
      const previous = seen.get(key);
      if (previous) problems.push(`This ${labels.reference.toLowerCase()} is already used on row ${previous}`);
      else seen.set(key, r + 1);
    }
    people.push({
      row: r + 1,
      personName,
      referenceId,
      department: departmentRaw || null,
      departmentSpecified: columns.department !== undefined && departmentRaw !== '',
      status,
      problems,
    });
  }
  if (!people.length) return { issues: [{ path: 'People', message: 'Add at least one person below the header row.' }], people: [] };
  return { issues: [], people };
}

export async function readPeopleWorkbook(buffer: Buffer, filename: string, labels: PeopleLabels): Promise<{ issues: ImportIssue[]; people: PlannedPerson[] }> {
  const name = filename.toLowerCase();
  if (name.endsWith('.xls') && !name.endsWith('.xlsx')) {
    throw AppError.badRequest('Save the file as an Excel workbook (.xlsx). The older .xls format cannot be imported.');
  }
  const zip = buffer.length >= 2 && buffer[0] === 0x50 && buffer[1] === 0x4b;
  if (name.endsWith('.csv') || (!zip && !name.endsWith('.xlsx') && !name.endsWith('.xlsm'))) {
    if (name.endsWith('.xlsx') || name.endsWith('.xlsm')) {
      throw AppError.badRequest('This file is not an Excel workbook. Download a fresh template and paste your data into it.');
    }
    return planPeopleSheet(parseCsv(buffer.toString('utf8')), labels);
  }
  if (!name.endsWith('.xlsx') && !name.endsWith('.xlsm')) {
    throw AppError.badRequest('Upload the Excel template (.xlsx) or a CSV file with the same columns.');
  }
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  } catch {
    throw AppError.badRequest('This file could not be read. Download a fresh template and paste your data into it.');
  }
  const peopleSheet = sheetByName(workbook, PEOPLE) ?? workbook.worksheets.find((sheet) => ![EXAMPLE, INSTRUCTIONS].includes(sheet.name));
  const planned = peopleSheet ? planPeopleSheet(matrixFromSheet(peopleSheet), labels) : { issues: [] as ImportIssue[], people: [] as PlannedPerson[] };
  if (planned.people.length || planned.issues.some((issue) => issue.path === 'File')) return planned;
  const example = sheetByName(workbook, EXAMPLE);
  const examplePeople = example ? planPeopleSheet(matrixFromSheet(example), labels).people : [];
  if (examplePeople.length) {
    return { issues: [{ path: 'People', message: 'The People sheet is empty. The Example sheet is only a sample and is not imported. Copy your rows onto People.' }], people: [] };
  }
  if (planned.issues.length) return planned;
  return { issues: [{ path: 'People', message: 'Add at least one person below the header row.' }], people: [] };
}

export function resolvePeopleImport(
  planned: PlannedPerson[],
  existing: ExistingPerson[],
  mode: 'add' | 'upsert',
  capacity: { limit: number | null; used: number } | null,
  labels: PeopleLabels,
): { issues: ImportIssue[]; rows: ResolvedPerson[] } {
  const byRef = new Map(existing.map((person) => [fold(person.referenceId), person]));
  const rows: ResolvedPerson[] = [];
  for (const person of planned) {
    if (person.problems.length) {
      rows.push({ ...blank(person), action: 'error', detail: person.problems.join('. ') });
      continue;
    }
    const current = byRef.get(fold(person.referenceId));
    if (!current) {
      if (labels.hostel && !person.departmentSpecified) {
        rows.push({ ...blank(person), action: 'error', detail: `${labels.department} is required` });
        continue;
      }
      rows.push({ ...blank(person), action: 'create', detail: 'Will be added', status: person.status ?? 'ACTIVE' });
      continue;
    }
    if (mode === 'add') {
      rows.push({ ...blank(person), existingId: current.id, action: 'unchanged', detail: 'Already registered. Left as it is.' });
      continue;
    }
    const changes: string[] = [];
    if (person.personName !== current.personName) changes.push('name');
    if (person.departmentSpecified && person.department !== current.department) changes.push(labels.department.toLowerCase());
    if (person.status && person.status !== current.status) changes.push('status');
    if (!changes.length) {
      rows.push({ ...blank(person), existingId: current.id, action: 'unchanged', detail: 'Already matches' });
      continue;
    }
    rows.push({ ...blank(person), existingId: current.id, action: 'update', detail: `Will update ${changes.join(', ')}` });
  }
  const creates = rows.filter((row) => row.action === 'create').length;
  const issues: ImportIssue[] = [];
  if (capacity && capacity.limit != null && capacity.used + creates > capacity.limit) {
    const remaining = Math.max(0, capacity.limit - capacity.used);
    issues.push({ path: 'Capacity', message: `This adds ${creates} ${creates === 1 ? 'person' : 'people'} and ${remaining} ${remaining === 1 ? 'place remains' : 'places remain'}.` });
  }
  return { issues, rows };
}

function blank(person: PlannedPerson): Omit<ResolvedPerson, 'action' | 'detail'> {
  return {
    row: person.row,
    existingId: null,
    referenceId: person.referenceId,
    personName: person.personName,
    department: person.department,
    departmentSpecified: person.departmentSpecified,
    status: person.status,
  };
}

function styleHeader(row: ExcelJS.Row) {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
  row.alignment = { vertical: 'middle' };
}

export async function buildPeopleWorkbook(input: {
  organizationName: string;
  labels: PeopleLabels;
  rows: PeopleExportRow[];
  template?: boolean;
}): Promise<{ body: Buffer; fileName: string }> {
  const headers = peopleHeaders(input.labels);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'VITA EYE';
  const sheet = workbook.addWorksheet(PEOPLE);
  sheet.addRow(headers);
  styleHeader(sheet.getRow(1));
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
  for (const person of input.rows) sheet.addRow(exportCells(person));
  sheet.columns.forEach((column, index) => {
    column.width = [28, 22, 22, 14, 16, 12, 20, 28, 22][index] ?? 18;
  });

  if (input.template) {
    const example = workbook.addWorksheet(EXAMPLE);
    example.addRow(headers);
    styleHeader(example.getRow(1));
    const sampleStatus = 'Active';
    example.addRow(
      input.labels.hostel
        ? ['Asha Example', '9876543210', '12', sampleStatus, '', '', '', '', '']
        : ['Jane Example', 'EMP-100', 'Front office', sampleStatus, '', '', '', '', ''],
    );
    example.addRow(
      input.labels.hostel
        ? ['Ravi Example', '9876543211', '14', 'Suspended', '', '', '', '', '']
        : ['Arun Example', 'EMP-101', 'Security', 'Inactive', '', '', '', '', ''],
    );
  }

  const instructions = workbook.addWorksheet(INSTRUCTIONS);
  instructions.getColumn(1).width = 110;
  const lines = [
    'How to import people',
    'Use the People sheet. One person per row. Do not rename the header row.',
    `Required columns: Name and ${input.labels.reference}.${input.labels.hostel ? ` ${input.labels.department} is required for a new tenant.` : ''}`,
    'Status may be Active, Suspended or Inactive. Leave it blank to add someone as Active, or to keep the current status when you update.',
    'Blank department cells do not clear an existing department. Enrollment, templates and consent columns are ignored on import.',
    'Importing never deletes a person and never changes a stored face. Choose "Add only" to skip people who already exist, or "Update and add" to refresh name, department and status.',
    'The Example sheet is a sample. Rows there are not imported.',
  ];
  lines.forEach((line, index) => {
    const row = instructions.getRow(index + 1);
    row.getCell(1).value = line;
    if (index === 0) row.font = { bold: true, size: 14 };
  });

  const body = Buffer.from(await workbook.xlsx.writeBuffer());
  const stamp = new Date().toISOString().slice(0, 10);
  const fileName = input.template
    ? `vita-eye-${fileSlug(input.organizationName)}-people-template.xlsx`
    : `vita-eye-${fileSlug(input.organizationName)}-people-${stamp}.xlsx`;
  return { body, fileName };
}

export function buildPeopleCsv(rows: PeopleExportRow[], labels: PeopleLabels): string {
  const lines = [peopleHeaders(labels).join(',')];
  for (const person of rows) lines.push(exportCells(person).map(csvCell).join(','));
  return `\uFEFF${lines.join('\r\n')}`;
}

function exportCells(person: PeopleExportRow): Array<string | number> {
  return [
    person.personName,
    person.referenceId,
    person.department ?? '',
    STATUS_LABEL[person.status] ?? person.status,
    ENROLLMENT_LABEL[person.enrollmentStatus] ?? person.enrollmentStatus,
    person.templateCount,
    person.legalBasis ?? '',
    person.consentReference ?? '',
    person.createdAt.toISOString(),
  ];
}
