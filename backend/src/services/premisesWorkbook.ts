import ExcelJS from 'exceljs';
import { BED_STATUSES, roomTypeOf, type BedStatus, type OrganizationTypeDefinition } from '../config/organizationTypes';
import { AppError } from '../utils/errors';

const MAX_ROWS = 2000;
const MAX_SCAN_ROWS = 2500;
const VALIDATION_ROWS = 2000;
const MAX_BEDS_PER_ROOM = 500;

const SHEET = 'Premises';
const EXAMPLE = 'Example';
const INSTRUCTIONS = 'Instructions';
const LISTS = 'Lists';

type Field = 'floorName' | 'floorCode' | 'level' | 'floorNotes' | 'roomName' | 'roomType' | 'capacity' | 'roomNotes' | 'bedLabels' | 'bedStatus';

const HEADER_FIELDS: Record<string, Field> = {
  'floor name': 'floorName',
  floor: 'floorName',
  'floor code': 'floorCode',
  code: 'floorCode',
  'floor level': 'level',
  level: 'level',
  'sort order': 'level',
  'floor notes': 'floorNotes',
  'room name': 'roomName',
  room: 'roomName',
  'room type': 'roomType',
  type: 'roomType',
  'maximum beds': 'capacity',
  'student seats': 'capacity',
  occupants: 'capacity',
  'room capacity': 'capacity',
  capacity: 'capacity',
  'room notes': 'roomNotes',
  notes: 'roomNotes',
  'bed labels': 'bedLabels',
  'bed label': 'bedLabels',
  beds: 'bedLabels',
  'bed status': 'bedStatus',
  status: 'bedStatus',
};

const STATUS_LABELS: Record<BedStatus, string> = {
  AVAILABLE: 'Available',
  OCCUPIED: 'Occupied',
  RESERVED: 'Reserved',
  MAINTENANCE: 'Maintenance',
};

export interface ImportIssue {
  path: string;
  message: string;
}

export interface PlannedRoom {
  name: string;
  roomType: string;
  capacity: number;
  capacitySpecified: boolean;
  notes: string | null;
  rows: number[];
  beds: { mode: 'auto'; status: BedStatus } | { mode: 'list'; items: Array<{ label: string; status: BedStatus }> } | null;
}

export interface PlannedFloor {
  key: string;
  name: string;
  code: string | null;
  sortOrder: number | null;
  notes: string | null;
  rows: number[];
  rooms: PlannedRoom[];
}

export interface ImportPlan {
  floors: PlannedFloor[];
}

export interface ExistingPremises {
  floors: Array<{ id: string; name: string; code: string | null; sortOrder: number; notes: string | null }>;
  rooms: Array<{ id: string; floorId: string; name: string; roomType: string; capacity: number; notes: string | null }>;
  beds: Array<{ roomId: string; label: string }>;
}

export interface ImportActions {
  createFloors: Array<{ key: string; name: string; code: string | null; sortOrder: number; notes: string | null }>;
  updateFloors: Array<{ id: string; code?: string; notes?: string }>;
  createRooms: Array<{ floorKey: string; name: string; roomType: string; capacity: number; notes: string | null }>;
  updateRooms: Array<{ id: string; notes: string }>;
  createBeds: Array<{ floorKey: string; roomName: string; label: string; status: BedStatus }>;
}

export interface ImportSummaryCounts {
  floorsCreated: number;
  floorsReused: number;
  roomsCreated: number;
  roomsReused: number;
  bedsCreated: number;
  bedsSkipped: number;
}

export interface WorkbookRead {
  matrix: string[][];
  exampleOnly: boolean;
  tooMany: boolean;
}

interface SheetWithValidation extends ExcelJS.Worksheet {
  dataValidations: { add: (address: string, validation: Record<string, unknown>) => void };
}

function clean(value: string): string {
  return value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function fold(value: string): string {
  return clean(value).toLowerCase();
}

function headerKey(value: string): string {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function loose(value: string): string {
  return value.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function rowLabel(rows: number[]): string {
  const unique = [...new Set(rows)].sort((a, b) => a - b);
  if (unique.length === 0) return 'File';
  if (unique.length === 1) return `Row ${unique[0]}`;
  if (unique.length === 2) return `Rows ${unique[0]} and ${unique[1]}`;
  if (unique.length <= 4) return `Rows ${unique.join(', ')}`;
  return `Rows ${unique.slice(0, 3).join(', ')} and ${unique.length - 3} more`;
}

function countUnit(count: number, unit: string): string {
  if (count === 1 && unit.endsWith('s')) return `1 ${unit.slice(0, -1)}`;
  return `${count.toLocaleString()} ${unit}`;
}

function joinAnd(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

export function describeImportSummary(summary: ImportSummaryCounts): string {
  const created = [
    summary.floorsCreated ? `${summary.floorsCreated} ${summary.floorsCreated === 1 ? 'floor' : 'floors'}` : '',
    summary.roomsCreated ? `${summary.roomsCreated} ${summary.roomsCreated === 1 ? 'room' : 'rooms'}` : '',
    summary.bedsCreated ? `${summary.bedsCreated} ${summary.bedsCreated === 1 ? 'bed' : 'beds'}` : '',
  ].filter(Boolean);
  let text = created.length
    ? `Added ${joinAnd(created)}.`
    : 'Nothing new to add. Those floors, rooms and beds are already on file.';
  if (created.length && (summary.floorsReused || summary.roomsReused)) text += ' Existing floors and rooms were left as they are.';
  if (summary.bedsSkipped === 1) text += ' 1 bed was already in its room.';
  else if (summary.bedsSkipped) text += ` ${summary.bedsSkipped} beds were already in their rooms.`;
  return text;
}

function columnLetter(index: number): string {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function columnsFor(type: OrganizationTypeDefinition) {
  const capacityHeader = type.roomCapacityLabel ?? 'Capacity';
  const columns: Array<{ header: string; field: Field; width: number; note: string }> = [
    { header: 'Floor name', field: 'floorName', width: 22, note: 'Required. Repeat this name for every room on the floor. Examples: Ground, First, Basement.' },
    { header: 'Floor code', field: 'floorCode', width: 14, note: 'Optional. 1–16 letters or numbers, such as G or F. Leave blank if this floor already has a code.' },
    { header: 'Level', field: 'level', width: 12, note: 'Optional. 0 is ground. A negative number is a basement.' },
    { header: 'Floor notes', field: 'floorNotes', width: 28, note: 'Optional. Saved only when the floor does not already have notes.' },
    { header: 'Room name', field: 'roomName', width: 18, note: 'Required for a room. Leave the room columns blank to add a floor on its own.' },
    {
      header: 'Room type',
      field: 'roomType',
      width: 18,
      note: `Choose one of: ${type.roomTypes.map((room) => room.label).join(', ')}.`,
    },
    {
      header: capacityHeader,
      field: 'capacity',
      width: 18,
      note: `How many ${type.capacityUnit} this room holds. Leave blank to use the default for the room type.`,
    },
    { header: 'Room notes', field: 'roomNotes', width: 28, note: 'Optional. Saved only when the room does not already have notes.' },
  ];
  if (type.master === 'lodging') {
    columns.push(
      {
        header: 'Bed labels',
        field: 'bedLabels',
        width: 32,
        note: 'Leave blank to create beds numbered 1, 2, 3… up to the room capacity. Or list labels: A, B or 1-4. A value such as ICU-1 is one label.',
      },
      {
        header: 'Bed status',
        field: 'bedStatus',
        width: 16,
        note: 'Optional. Available, Occupied, Reserved or Maintenance. Blank means Available. Existing beds keep their current status.',
      },
    );
  }
  return columns;
}

function examplesFor(type: OrganizationTypeDefinition): string[][] {
  if (type.code === 'HOSPITAL') {
    return [
      ['Ground', 'G', '0', '', 'Ward A', 'Ward', '6', 'General ward', '1-6', 'Available'],
      ['First', 'F', '1', '', 'ICU 1', 'ICU', '1', '', '1', 'Available'],
    ];
  }
  if (type.code === 'SCHOOL') {
    return [
      ['Block A', 'A', '0', '', 'Room 101', 'Classroom', '40', ''],
      ['Block A', 'A', '0', '', 'Science lab', 'Laboratory', '30', 'Chemistry'],
    ];
  }
  if (type.code === 'HOME') {
    return [
      ['Ground', 'G', '0', '', 'Living room', 'Living room', '4', ''],
      ['First', 'F', '1', '', 'Bedroom', 'Bedroom', '2', ''],
    ];
  }
  return [
    ['Ground', 'G', '0', 'Main entrance', '101', 'Single', '1', '', '', 'Available'],
    ['Ground', 'G', '0', 'Main entrance', '102', 'Double', '2', 'Near the stairs', 'A, B', 'Available'],
    ['First', 'F', '1', '', '201', 'Dormitory', '6', '', '1-6', 'Available'],
  ];
}

function instructionLines(organizationName: string, type: OrganizationTypeDefinition, capacity: number | null): Array<[string, string]> {
  const lines: Array<[string, string]> = [
    ['Template', 'VITA EYE floors, rooms and beds'],
    ['Organization', organizationName],
    ['Organization type', type.label],
    ['Licensed capacity', capacity == null ? 'No limit is set' : `${capacity.toLocaleString()} ${type.capacityUnit}`],
    ['Where to type', 'Use the Premises sheet. The Example sheet is a sample and is never imported.'],
    ['Rows', 'Enter one row per room. Repeat the floor name for every room on that floor. A row with only a floor name adds the floor and no rooms.'],
    ['Room type', `Use the dropdown. Accepted values: ${type.roomTypes.map((room) => room.label).join(', ')}.`],
    ['Capacity', `Leave ${type.roomCapacityLabel ?? 'capacity'} blank to use the default for that room type. The total counts toward the licensed ${type.capacityLabel.toLowerCase()}.`],
  ];
  if (type.master === 'lodging') {
    lines.push(
      ['Beds', 'Leave Bed labels blank to create beds numbered 1, 2, 3… up to the room capacity.'],
      ['Bed lists', 'You can also list labels separated by commas (A, B, C), or use a range such as 1-4 or A-D. ICU-1 is a single label, not a range.'],
      ['Bed status', 'Blank means Available. Beds that already exist are skipped and keep their current status.'],
    );
  }
  lines.push(
    ['Updating', 'Import adds what is missing. It does not delete or rename anything. A floor or room that is already on file is kept.'],
    ['Checking', 'The whole file is checked first. If any row has a problem, nothing is saved.'],
    ['Upload', 'Save this workbook and choose Import spreadsheet on the floors, rooms and beds page. A CSV export of the Premises sheet is also accepted.'],
  );
  return lines;
}

function fileSlug(organizationName: string): string {
  const slug = organizationName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  return slug || 'premises';
}

function styleHeader(row: ExcelJS.Row) {
  row.height = 22;
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Calibri', size: 11 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F2744' } };
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
  });
}

export async function buildPremisesTemplate(input: { organizationName: string; type: OrganizationTypeDefinition; capacity: number | null }) {
  const { type } = input;
  const columns = columnsFor(type);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'VITA EYE';
  workbook.title = 'Floors, rooms and beds';
  workbook.created = new Date();

  const lists = workbook.addWorksheet(LISTS, { state: 'veryHidden' });
  type.roomTypes.forEach((room, index) => {
    lists.getCell(index + 1, 1).value = room.label;
  });
  if (type.master === 'lodging') {
    BED_STATUSES.forEach((status, index) => {
      lists.getCell(index + 1, 3).value = STATUS_LABELS[status];
    });
  }

  const premises = workbook.addWorksheet(SHEET, { views: [{ state: 'frozen', ySplit: 1 }] }) as SheetWithValidation;
  premises.columns = columns.map((column) => ({ header: column.header, width: column.width }));
  styleHeader(premises.getRow(1));
  columns.forEach((column, index) => {
    premises.getRow(1).getCell(index + 1).note = column.note;
  });
  premises.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };

  const roomTypeCol = columnLetter(columns.findIndex((column) => column.field === 'roomType'));
  const levelCol = columnLetter(columns.findIndex((column) => column.field === 'level'));
  const capacityCol = columnLetter(columns.findIndex((column) => column.field === 'capacity'));
  const last = VALIDATION_ROWS + 1;
  premises.dataValidations.add(`${roomTypeCol}2:${roomTypeCol}${last}`, {
    type: 'list',
    allowBlank: true,
    formulae: [`${LISTS}!$A$1:$A$${type.roomTypes.length}`],
    showErrorMessage: true,
    errorStyle: 'stop',
    errorTitle: 'Room type',
    error: `Choose ${type.roomTypes.map((room) => room.label).join(', ')}.`,
  });
  premises.dataValidations.add(`${levelCol}2:${levelCol}${last}`, {
    type: 'whole',
    operator: 'between',
    allowBlank: true,
    formulae: ['-20', '200'],
    showErrorMessage: true,
    errorStyle: 'stop',
    errorTitle: 'Level',
    error: 'Use a whole number from -20 to 200. 0 is ground.',
  });
  premises.dataValidations.add(`${capacityCol}2:${capacityCol}${last}`, {
    type: 'whole',
    operator: 'between',
    allowBlank: true,
    formulae: ['1', '5000'],
    showErrorMessage: true,
    errorStyle: 'stop',
    errorTitle: type.roomCapacityLabel ?? 'Capacity',
    error: 'Use a whole number from 1 to 5000, or leave the cell blank.',
  });
  if (type.master === 'lodging') {
    const statusCol = columnLetter(columns.findIndex((column) => column.field === 'bedStatus'));
    premises.dataValidations.add(`${statusCol}2:${statusCol}${last}`, {
      type: 'list',
      allowBlank: true,
      formulae: [`${LISTS}!$C$1:$C$${BED_STATUSES.length}`],
      showErrorMessage: true,
      errorStyle: 'stop',
      errorTitle: 'Bed status',
      error: 'Choose Available, Occupied, Reserved or Maintenance.',
    });
  }

  const example = workbook.addWorksheet(EXAMPLE);
  example.mergeCells(1, 1, 1, columns.length);
  const banner = example.getCell(1, 1);
  banner.value = 'Sample only. These rows are not imported. Copy the ones you need onto the Premises sheet, then change the names and numbers.';
  banner.font = { italic: true, color: { argb: 'FF475569' }, name: 'Calibri', size: 11 };
  banner.alignment = { wrapText: true, vertical: 'middle' };
  example.getRow(1).height = 32;
  columns.forEach((column, index) => {
    example.getCell(2, index + 1).value = column.header;
    example.getColumn(index + 1).width = column.width;
  });
  styleHeader(example.getRow(2));
  for (const sample of examplesFor(type)) {
    const row = example.addRow(sample.slice(0, columns.length));
    row.eachCell((cell) => {
      cell.font = { name: 'Calibri', size: 11, color: { argb: 'FF334155' } };
    });
  }

  const instructions = workbook.addWorksheet(INSTRUCTIONS);
  instructions.columns = [{ width: 24 }, { width: 108 }];
  for (const [label, detail] of instructionLines(input.organizationName, type, input.capacity)) {
    const row = instructions.addRow([label, detail]);
    row.getCell(1).font = { bold: true, name: 'Calibri', size: 11, color: { argb: 'FF0F2744' } };
    row.getCell(2).alignment = { wrapText: true, vertical: 'top' };
    row.getCell(2).font = { name: 'Calibri', size: 11 };
  }
  instructions.getRow(1).font = { bold: true, size: 14, color: { argb: 'FF0F2744' } };

  const ordered = (sheet: ExcelJS.Worksheet, orderNo: number) => {
    (sheet as ExcelJS.Worksheet & { orderNo: number }).orderNo = orderNo;
  };
  ordered(premises, 0);
  ordered(example, 1);
  ordered(instructions, 2);
  ordered(lists, 3);

  const body = Buffer.from(await workbook.xlsx.writeBuffer());
  return { body, fileName: `vita-eye-${fileSlug(input.organizationName)}-floors-rooms-beds.xlsx` };
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
      rows.push(row.map(clean));
      row = [];
      continue;
    }
    cell += ch;
  }
  row.push(cell);
  if (row.some((value) => value !== '') || rows.length === 0) rows.push(row.map(clean));
  return rows;
}

function matrixFromSheet(sheet: ExcelJS.Worksheet): string[][] {
  const rows: string[][] = [];
  const last = Math.min(sheet.rowCount, MAX_SCAN_ROWS);
  for (let r = 1; r <= last; r++) {
    const excelRow = sheet.getRow(r);
    const width = Math.max(excelRow.cellCount, sheet.columnCount, 1);
    const cells: string[] = [];
    for (let c = 1; c <= Math.min(width, 30); c++) cells.push(clean(excelRow.getCell(c).text ?? ''));
    rows.push(cells);
  }
  return rows;
}

function sheetByName(workbook: ExcelJS.Workbook, name: string) {
  const want = name.toLowerCase();
  return workbook.worksheets.find((sheet) => sheet.name.toLowerCase() === want);
}

export async function readPremisesWorkbook(buffer: Buffer, filename: string): Promise<WorkbookRead> {
  const name = filename.toLowerCase();
  if (name.endsWith('.xls') && !name.endsWith('.xlsx')) {
    throw AppError.badRequest('Save the file as an Excel workbook (.xlsx). The older .xls format cannot be imported.');
  }
  const zip = buffer.length >= 2 && buffer[0] === 0x50 && buffer[1] === 0x4b;
  if (name.endsWith('.csv') || (!zip && !name.endsWith('.xlsx') && !name.endsWith('.xlsm'))) {
    if (name.endsWith('.xlsx') || name.endsWith('.xlsm')) {
      throw AppError.badRequest('This file is not an Excel workbook. Download a fresh template and paste your data into it.');
    }
    return { matrix: parseCsv(buffer.toString('utf8')), exampleOnly: false, tooMany: false };
  }
  if (!name.endsWith('.xlsx') && !name.endsWith('.xlsm') && !name.endsWith('.csv')) {
    throw AppError.badRequest('Upload the Excel template (.xlsx) or a CSV file with the same columns.');
  }
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  } catch {
    throw AppError.badRequest('This file could not be read. Download a fresh template and paste your data into it.');
  }
  const premises = sheetByName(workbook, SHEET) ?? workbook.worksheets.find((sheet) => !['example', 'instructions', 'lists'].includes(sheet.name.toLowerCase()));
  if (!premises) throw AppError.badRequest('The workbook has no Premises sheet. Download a fresh template.');
  if (premises.rowCount > MAX_SCAN_ROWS) return { matrix: [], exampleOnly: false, tooMany: true };
  const matrix = matrixFromSheet(premises);
  const example = sheetByName(workbook, EXAMPLE);
  let exampleHasRows = false;
  if (example) {
    for (let r = 3; r <= Math.min(example.rowCount, 30); r++) {
      if (clean(example.getRow(r).getCell(1).text ?? '')) exampleHasRows = true;
    }
  }
  const filledRows = matrix.filter((row) => row.some((cell) => cell !== '')).length;
  return { matrix, exampleOnly: exampleHasRows && filledRows <= 1, tooMany: false };
}

function findHeader(matrix: string[][], capacityLabel: string | null) {
  const limit = Math.min(matrix.length, 20);
  for (let r = 0; r < limit; r++) {
    const columns: Partial<Record<Field, number>> = {};
    matrix[r].forEach((cell, index) => {
      const key = headerKey(cell);
      const field = (capacityLabel && key === headerKey(capacityLabel) ? 'capacity' : HEADER_FIELDS[key]) as Field | undefined;
      if (field && columns[field] === undefined) columns[field] = index;
    });
    if (columns.floorName !== undefined && columns.roomName !== undefined) return { index: r, columns };
  }
  return null;
}

function cellAt(row: string[], index: number | undefined): string {
  if (index === undefined) return '';
  return clean(row[index] ?? '');
}

function parseWhole(raw: string, min: number, max: number): number | null | 'bad' {
  if (!raw) return null;
  const text = raw.replace(/,/g, '');
  if (!/^-?\d+(\.0+)?$/.test(text)) return 'bad';
  const value = Number(text);
  if (!Number.isInteger(value) || value < min || value > max) return 'bad';
  return value;
}

function parseCode(raw: string): string | null | 'bad' {
  if (!raw) return null;
  const code = raw.toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]{0,15}$/.test(code)) return 'bad';
  return code;
}

function parseStatus(raw: string): BedStatus | null | 'bad' {
  if (!raw) return null;
  const key = loose(raw).replace(/\s+/g, '');
  const match = BED_STATUSES.find((status) => status.toLowerCase() === key || loose(STATUS_LABELS[status]).replace(/\s+/g, '') === key);
  return match ?? 'bad';
}

function matchRoomType(type: OrganizationTypeDefinition, raw: string) {
  const key = loose(raw);
  return type.roomTypes.find((room) => loose(room.code) === key || loose(room.label) === key);
}

/** Blank, or the word AUTO, means numbered beds. "1-4" and "A-D" expand. "ICU-1" stays one label. */
export function expandBedLabels(raw: string): { ok: true; auto: true } | { ok: true; auto: false; labels: string[] } | { ok: false; message: string } {
  const text = clean(raw);
  if (!text || /^auto$/i.test(text)) return { ok: true, auto: true };
  const tokens = text.split(/[,;|]/).map((token) => token.trim()).filter(Boolean);
  if (!tokens.length) return { ok: true, auto: true };
  const labels: string[] = [];
  for (const token of tokens) {
    const numeric = /^(\d+)\s*-\s*(\d+)$/.exec(token);
    const letter = /^([A-Za-z])\s*-\s*([A-Za-z])$/.exec(token);
    if (numeric) {
      const start = Number(numeric[1]);
      const end = Number(numeric[2]);
      if (end < start) return { ok: false, message: `Bed range ${token} goes backwards.` };
      if (end - start + 1 > MAX_BEDS_PER_ROOM) return { ok: false, message: `Bed range ${token} is longer than ${MAX_BEDS_PER_ROOM} beds.` };
      for (let n = start; n <= end; n++) labels.push(String(n));
    } else if (letter) {
      const start = letter[1].toUpperCase().charCodeAt(0);
      const end = letter[2].toUpperCase().charCodeAt(0);
      if (end < start) return { ok: false, message: `Bed range ${token} goes backwards.` };
      for (let n = start; n <= end; n++) labels.push(String.fromCharCode(n));
    } else if (token.length > 40) {
      return { ok: false, message: 'A bed label can be at most 40 characters.' };
    } else labels.push(token);
  }
  if (labels.length > MAX_BEDS_PER_ROOM) return { ok: false, message: `A room can include at most ${MAX_BEDS_PER_ROOM} beds in one import.` };
  const seen = new Set<string>();
  for (const label of labels) {
    const key = fold(label);
    if (seen.has(key)) return { ok: false, message: `Bed label "${label}" is listed twice.` };
    seen.add(key);
  }
  return { ok: true, auto: false, labels };
}

interface FloorBuild {
  key: string;
  name: string;
  code: string | null;
  sortOrder: number | null;
  notes: string | null;
  rows: number[];
  rooms: Map<string, RoomBuild>;
}

interface RoomBuild {
  name: string;
  roomType: string | null;
  capacity: number | null;
  capacitySpecified: boolean;
  notes: string | null;
  rows: number[];
  bedMode: 'none' | 'auto' | 'list';
  autoStatus: BedStatus | null;
  labels: Map<string, { label: string; status: BedStatus }>;
}

export function planPremisesImport(matrix: string[][], type: OrganizationTypeDefinition): { issues: ImportIssue[]; plan: ImportPlan | null } {
  const lodging = type.master === 'lodging';
  const header = findHeader(matrix, type.roomCapacityLabel);
  if (!header) {
    return {
      issues: [{ path: 'Premises', message: 'The sheet needs Floor name and Room name columns. Download a fresh template and keep that header row.' }],
      plan: null,
    };
  }
  const issues: ImportIssue[] = [];
  const floors = new Map<string, FloorBuild>();
  let dataRows = 0;

  const take = (row: string[], index: number | undefined) => cellAt(row, index);

  for (let r = header.index + 1; r < matrix.length; r++) {
    const source = matrix[r] ?? [];
    if (source.every((cell) => !clean(cell))) continue;
    const excelRow = r + 1;
    const floorName = take(source, header.columns.floorName);
    const roomName = take(source, header.columns.roomName);
    if (fold(floorName) === 'floor name' && (!roomName || fold(roomName) === 'room name')) continue;
    dataRows += 1;
    if (dataRows > MAX_ROWS) {
      return { issues: [{ path: 'File', message: `The sheet has more than ${MAX_ROWS.toLocaleString()} rows. Split it into smaller files.` }], plan: null };
    }

    const where = `Row ${excelRow}`;
    const floorCodeRaw = take(source, header.columns.floorCode);
    const levelRaw = take(source, header.columns.level);
    const floorNotes = take(source, header.columns.floorNotes);
    const roomTypeRaw = take(source, header.columns.roomType);
    const capacityRaw = take(source, header.columns.capacity);
    const roomNotes = take(source, header.columns.roomNotes);
    const bedLabels = take(source, header.columns.bedLabels);
    const statusRaw = take(source, header.columns.bedStatus);
    let rowOk = true;
    const mark = (message: string) => {
      issues.push({ path: where, message });
      rowOk = false;
    };
    if ([floorName, floorCodeRaw, levelRaw, floorNotes, roomName, roomTypeRaw, capacityRaw, roomNotes, bedLabels, statusRaw].some((value) => value.startsWith('='))) {
      mark('Replace the formula with the value it should show.');
      continue;
    }
    if (!floorName) mark('Enter a floor name.');
    else if (floorName.length > 80) mark('Floor name can be at most 80 characters.');
    const floorCode = parseCode(floorCodeRaw);
    if (floorCode === 'bad') mark('Floor code must be 1–16 letters, numbers, underscores or hyphens.');
    const level = parseWhole(levelRaw, -20, 200);
    if (level === 'bad') mark('Level must be a whole number from -20 to 200. 0 is ground.');
    if (floorNotes.length > 255) mark('Floor notes can be at most 255 characters.');
    if (roomName.length > 80) mark('Room name can be at most 80 characters.');
    if (roomNotes.length > 255) mark('Room notes can be at most 255 characters.');
    const capacity = parseWhole(capacityRaw, 1, 5000);
    if (capacity === 'bad') mark(`${type.roomCapacityLabel ?? 'Capacity'} must be a whole number from 1 to 5000.`);
    const bedStatus = parseStatus(statusRaw);
    if (bedStatus === 'bad') mark('Bed status must be Available, Occupied, Reserved or Maintenance.');
    const roomBits = Boolean(roomName || roomTypeRaw || capacityRaw || roomNotes || bedLabels || statusRaw);
    if (!roomName && roomBits) mark('Enter a room name, or clear the other room and bed cells to add the floor on its own.');
    if (roomName && !roomTypeRaw) mark('Choose a room type.');
    const roomType = roomTypeRaw ? matchRoomType(type, roomTypeRaw) : undefined;
    if (roomTypeRaw && !roomType) mark(`"${roomTypeRaw}" is not a room type for this organization. Choose ${type.roomTypes.map((room) => room.label).join(', ')}.`);
    if (!lodging && (bedLabels || statusRaw)) mark(`${type.label} organizations do not track individual beds. Remove the bed columns from this row.`);

    let expanded: ReturnType<typeof expandBedLabels> | null = null;
    if (lodging && bedLabels) {
      expanded = expandBedLabels(bedLabels);
      if (!expanded.ok) mark(expanded.message);
    }
    if (!rowOk || !floorName || floorName.length > 80) continue;

    const floorKey = fold(floorName);
    let floor = floors.get(floorKey);
    if (!floor) {
      floor = { key: floorKey, name: floorName, code: null, sortOrder: null, notes: null, rows: [], rooms: new Map() };
      floors.set(floorKey, floor);
    }
    floor.rows.push(excelRow);
    if (floorCode && floorCode !== 'bad') {
      if (floor.code && floor.code !== floorCode) issues.push({ path: where, message: `${floor.name} already uses code ${floor.code} in this file. This row says ${floorCode}.` });
      else floor.code = floorCode;
    }
    if (typeof level === 'number') {
      if (floor.sortOrder != null && floor.sortOrder !== level) issues.push({ path: where, message: `${floor.name} is level ${floor.sortOrder} earlier in the file. This row says ${level}.` });
      else floor.sortOrder = level;
    }
    if (floorNotes && !floor.notes) floor.notes = floorNotes;
    if (!roomName || !roomType || capacity === 'bad') continue;

    const roomKey = fold(roomName);
    let room = floor.rooms.get(roomKey);
    if (!room) {
      room = {
        name: roomName,
        roomType: roomType.code,
        capacity: typeof capacity === 'number' ? capacity : null,
        capacitySpecified: typeof capacity === 'number',
        notes: roomNotes || null,
        rows: [],
        bedMode: 'none',
        autoStatus: null,
        labels: new Map(),
      };
      floor.rooms.set(roomKey, room);
    }
    room.rows.push(excelRow);
    if (room.roomType && room.roomType !== roomType.code) {
      issues.push({ path: where, message: `${room.name} on ${floor.name} is already ${labelOf(type, room.roomType)} in this file. This row says ${roomType.label}.` });
    }
    if (typeof capacity === 'number') {
      if (room.capacitySpecified && room.capacity !== capacity) {
        issues.push({ path: where, message: `${room.name} on ${floor.name} is already set to ${room.capacity} earlier in the file. This row says ${capacity}.` });
      } else {
        room.capacity = capacity;
        room.capacitySpecified = true;
      }
    }
    if (roomNotes && !room.notes) room.notes = roomNotes;
    if (!lodging || bedStatus === 'bad' || (expanded && !expanded.ok)) continue;
    const status = bedStatus ?? 'AVAILABLE';
    const wantsAuto = !expanded || expanded.auto;
    if (wantsAuto) {
      if (room.bedMode === 'list') issues.push({ path: where, message: `${room.name} on ${floor.name} already lists bed labels. Leave bed labels blank on every row for that room, or list them on every row.` });
      else {
        room.bedMode = 'auto';
        if (statusRaw) {
          if (room.autoStatus && room.autoStatus !== status) issues.push({ path: where, message: `${room.name} on ${floor.name} already uses bed status ${STATUS_LABELS[room.autoStatus]}.` });
          else room.autoStatus = status;
        }
      }
    } else if (expanded && expanded.ok && !expanded.auto) {
      if (room.bedMode === 'auto') {
        issues.push({ path: where, message: `${room.name} on ${floor.name} already leaves bed labels blank. Use the same approach on every row for that room.` });
      } else {
        room.bedMode = 'list';
        for (const label of expanded.labels) {
          const key = fold(label);
          const previous = room.labels.get(key);
          if (previous && previous.status !== status) issues.push({ path: where, message: `Bed ${label} in ${room.name} is already ${STATUS_LABELS[previous.status]}.` });
          else if (!previous) room.labels.set(key, { label, status });
        }
      }
    }
  }

  if (!dataRows) {
    return { issues: [{ path: 'Premises', message: 'Add at least one floor or room below the header row.' }], plan: null };
  }

  const codeOwner = new Map<string, FloorBuild>();
  for (const floor of floors.values()) {
    if (floor.code) {
      const owner = codeOwner.get(floor.code);
      if (owner) issues.push({ path: rowLabel(floor.rows), message: `Floor code ${floor.code} is used for both ${owner.name} and ${floor.name}.` });
      else codeOwner.set(floor.code, floor);
    }
    for (const room of floor.rooms.values()) {
      if (!room.capacitySpecified || room.capacity == null) {
        const definition = room.roomType ? roomTypeOf(type.code, room.roomType) : undefined;
        room.capacity = definition?.defaultCapacity ?? 1;
      }
      if (room.bedMode === 'none') room.bedMode = 'auto';
      if (room.bedMode === 'auto' && !room.autoStatus) room.autoStatus = 'AVAILABLE';
      if (room.bedMode === 'list' && room.capacitySpecified && room.capacity != null && room.labels.size > room.capacity) {
        issues.push({
          path: rowLabel(room.rows),
          message: `${room.name} on ${floor.name} lists ${room.labels.size} beds, but its capacity is ${room.capacity}.`,
        });
      }
    }
  }

  if (issues.length) return { issues, plan: null };
  return {
    issues: [],
    plan: {
      floors: [...floors.values()].map((floor) => ({
        key: floor.key,
        name: floor.name,
        code: floor.code,
        sortOrder: floor.sortOrder,
        notes: floor.notes,
        rows: floor.rows,
        rooms: [...floor.rooms.values()].map((room) => ({
          name: room.name,
          roomType: room.roomType ?? '',
          capacity: room.capacity ?? 1,
          capacitySpecified: room.capacitySpecified,
          notes: room.notes,
          rows: room.rows,
          beds: lodging
            ? room.bedMode === 'list'
              ? { mode: 'list' as const, items: [...room.labels.values()] }
              : { mode: 'auto' as const, status: room.autoStatus ?? 'AVAILABLE' }
            : null,
        })),
      })),
    },
  };
}

function labelOf(type: OrganizationTypeDefinition, code: string): string {
  return type.roomTypes.find((room) => room.code === code)?.label ?? code;
}

function desiredBeds(room: PlannedRoom, capacity: number): Array<{ label: string; status: BedStatus }> {
  if (!room.beds) return [];
  if (room.beds.mode === 'auto') return Array.from({ length: capacity }, (_, index) => ({ label: String(index + 1), status: room.beds && room.beds.mode === 'auto' ? room.beds.status : 'AVAILABLE' }));
  return room.beds.items;
}

export function resolvePremisesImport(
  plan: ImportPlan,
  existing: ExistingPremises,
  type: OrganizationTypeDefinition,
  licensed: number | null,
): { issues: ImportIssue[]; actions: ImportActions; summary: ImportSummaryCounts } {
  const issues: ImportIssue[] = [];
  const actions: ImportActions = { createFloors: [], updateFloors: [], createRooms: [], updateRooms: [], createBeds: [] };
  const floorByKey = new Map(existing.floors.map((floor) => [fold(floor.name), floor]));
  const floorByCode = new Map(existing.floors.filter((floor) => floor.code).map((floor) => [floor.code!.toUpperCase(), floor]));
  const roomsByFloor = new Map<string, Map<string, ExistingPremises['rooms'][number]>>();
  for (const room of existing.rooms) {
    const bucket = roomsByFloor.get(room.floorId) ?? new Map<string, ExistingPremises['rooms'][number]>();
    bucket.set(fold(room.name), room);
    roomsByFloor.set(room.floorId, bucket);
  }
  const bedsByRoom = new Map<string, ExistingPremises['beds']>();
  for (const bed of existing.beds) {
    const bucket = bedsByRoom.get(bed.roomId) ?? [];
    bucket.push(bed);
    bedsByRoom.set(bed.roomId, bucket);
  }

  let addedCapacity = 0;
  let addedBeds = 0;
  let skippedBeds = 0;
  const reusedFloors = new Set<string>();
  const reusedRooms = new Set<string>();
  const lodging = type.master === 'lodging';

  for (const floor of plan.floors) {
    const current = floorByKey.get(floor.key);
    if (floor.code) {
      const owner = floorByCode.get(floor.code);
      if (owner && fold(owner.name) !== floor.key) {
        issues.push({ path: rowLabel(floor.rows), message: `Floor code ${floor.code} already belongs to ${owner.name}.` });
      }
    }
    if (current) {
      reusedFloors.add(current.id);
      if (floor.code && current.code && current.code.toUpperCase() !== floor.code) {
        issues.push({ path: rowLabel(floor.rows), message: `${current.name} already uses code ${current.code}. The sheet says ${floor.code}.` });
      }
      if (floor.sortOrder != null && floor.sortOrder !== current.sortOrder) {
        issues.push({ path: rowLabel(floor.rows), message: `${current.name} is already level ${current.sortOrder}. The sheet says ${floor.sortOrder}.` });
      }
      const update: ImportActions['updateFloors'][number] = { id: current.id };
      let changed = false;
      if (floor.code && !current.code && !floorByCode.has(floor.code)) {
        update.code = floor.code;
        changed = true;
      }
      if (floor.notes && !current.notes) {
        update.notes = floor.notes;
        changed = true;
      }
      if (changed) actions.updateFloors.push(update);
    } else {
      actions.createFloors.push({
        key: floor.key,
        name: floor.name,
        code: floor.code,
        sortOrder: floor.sortOrder ?? 0,
        notes: floor.notes,
      });
    }

    for (const room of floor.rooms) {
      const currentRoom = current ? roomsByFloor.get(current.id)?.get(fold(room.name)) : undefined;
      if (currentRoom) {
        reusedRooms.add(currentRoom.id);
        if (currentRoom.roomType !== room.roomType) {
          issues.push({
            path: rowLabel(room.rows),
            message: `${room.name} on ${floor.name} is already ${labelOf(type, currentRoom.roomType)}. The sheet says ${labelOf(type, room.roomType)}.`,
          });
          continue;
        }
        if (room.capacitySpecified && currentRoom.capacity !== room.capacity) {
          issues.push({
            path: rowLabel(room.rows),
            message: `${room.name} on ${floor.name} already holds ${currentRoom.capacity}. The sheet says ${room.capacity}.`,
          });
          continue;
        }
        if (room.notes && !currentRoom.notes) actions.updateRooms.push({ id: currentRoom.id, notes: room.notes });
        if (lodging && room.beds) {
          const placed = placeBeds(floor, room, currentRoom.capacity, bedsByRoom.get(currentRoom.id) ?? []);
          addedBeds += placed.created;
          skippedBeds += placed.skipped;
        }
      } else {
        addedCapacity += room.capacity;
        actions.createRooms.push({
          floorKey: floor.key,
          name: room.name,
          roomType: room.roomType,
          capacity: room.capacity,
          notes: room.notes,
        });
        if (lodging && room.beds) {
          const placed = placeBeds(floor, room, room.capacity, []);
          addedBeds += placed.created;
          skippedBeds += placed.skipped;
        }
      }
    }
  }

  const usedCapacity = existing.rooms.reduce((sum, room) => sum + room.capacity, 0);
  if (licensed != null && addedCapacity > 0 && usedCapacity + addedCapacity > licensed) {
    const remaining = Math.max(0, licensed - usedCapacity);
    issues.push({
      path: 'File',
      message: `This exceeds the licensed ${type.capacityLabel.toLowerCase()} of ${licensed.toLocaleString()}. ${countUnit(remaining, type.capacityUnit)} remaining, and this file plans ${countUnit(addedCapacity, type.capacityUnit)} more.`,
    });
  }
  if (lodging && licensed != null && addedBeds > 0 && existing.beds.length + addedBeds > licensed) {
    const remaining = Math.max(0, licensed - existing.beds.length);
    issues.push({
      path: 'File',
      message: `This exceeds the licensed bed capacity of ${licensed.toLocaleString()}. ${countUnit(remaining, 'beds')} remaining, and this file adds ${countUnit(addedBeds, 'beds')}.`,
    });
  }

  const empty: ImportSummaryCounts = { floorsCreated: 0, floorsReused: 0, roomsCreated: 0, roomsReused: 0, bedsCreated: 0, bedsSkipped: 0 };
  if (issues.length) return { issues, actions: { createFloors: [], updateFloors: [], createRooms: [], updateRooms: [], createBeds: [] }, summary: empty };
  return {
    issues: [],
    actions,
    summary: {
      floorsCreated: actions.createFloors.length,
      floorsReused: reusedFloors.size,
      roomsCreated: actions.createRooms.length,
      roomsReused: reusedRooms.size,
      bedsCreated: actions.createBeds.length,
      bedsSkipped: skippedBeds,
    },
  };

  function placeBeds(floor: PlannedFloor, room: PlannedRoom, capacity: number, existingBeds: ExistingPremises['beds']) {
    const keys = new Set(existingBeds.map((bed) => fold(bed.label)));
    const wanted = desiredBeds(room, capacity);
    const creating = wanted.filter((bed) => !keys.has(fold(bed.label)));
    const skipped = wanted.length - creating.length;
    if (existingBeds.length + creating.length > capacity) {
      const open = Math.max(0, capacity - existingBeds.length);
      issues.push({
        path: rowLabel(room.rows),
        message: open === 0
          ? `${room.name} on ${floor.name} already has ${existingBeds.length} ${existingBeds.length === 1 ? 'bed' : 'beds'}, which fills its capacity of ${capacity}.`
          : `${room.name} on ${floor.name} can take ${open} more ${open === 1 ? 'bed' : 'beds'}, but the sheet adds ${creating.length}.`,
      });
      return { created: 0, skipped: 0 };
    }
    for (const bed of creating) actions.createBeds.push({ floorKey: floor.key, roomName: room.name, label: bed.label, status: bed.status });
    return { created: creating.length, skipped };
  }
}
