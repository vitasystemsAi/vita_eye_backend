import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { ORGANIZATION_TYPES } from '../config/organizationTypes';
import {
  buildPremisesTemplate,
  describeImportSummary,
  expandBedLabels,
  planPremisesImport,
  readPremisesWorkbook,
  resolvePremisesImport,
} from './premisesWorkbook';

const HOSPITAL = ORGANIZATION_TYPES.HOSPITAL;
const SCHOOL = ORGANIZATION_TYPES.SCHOOL;

const HOSPITAL_HEADER = ['Floor name', 'Floor code', 'Level', 'Floor notes', 'Room name', 'Room type', 'Maximum beds', 'Room notes', 'Bed labels', 'Bed status'];

function planHospital(rows: string[][]) {
  return planPremisesImport([HOSPITAL_HEADER, ...rows], HOSPITAL);
}

describe('premises workbook template', () => {
  it('builds a hospital workbook with dropdowns, a blank Premises sheet and an example', async () => {
    const file = await buildPremisesTemplate({ organizationName: 'SKY IN - KBHP', type: HOSPITAL, capacity: 500 });
    expect(file.fileName).toBe('vita-eye-sky-in-kbhp-floors-rooms-beds.xlsx');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file.body as unknown as ExcelJS.Buffer);
    const premises = workbook.getWorksheet('Premises');
    expect(premises?.getRow(1).values).toEqual(expect.arrayContaining(['Floor name', 'Bed labels', 'Maximum beds']));
    expect(premises?.rowCount).toBe(1);
    const validations = (premises as ExcelJS.Worksheet & { dataValidations: { model: Record<string, { type: string; formulae?: string[] }> } }).dataValidations.model;
    expect(validations.F2?.type).toBe('list');
    expect(validations.F2?.formulae?.[0]).toContain('Lists');
    expect(validations.J2?.type).toBe('list');
    expect(validations.C2?.type).toBe('whole');
    const example = workbook.getWorksheet('Example');
    expect(example?.getRow(3).getCell(5).text).toBe('Ward A');
    const read = await readPremisesWorkbook(file.body, file.fileName);
    expect(read.exampleOnly).toBe(true);
    const instructions = workbook.getWorksheet('Instructions');
    expect(instructions?.getColumn(2).values.join(' ')).toContain('500 beds');
  });

  it('omits bed columns for a school', async () => {
    const file = await buildPremisesTemplate({ organizationName: 'North Campus', type: SCHOOL, capacity: 600 });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file.body as unknown as ExcelJS.Buffer);
    const headers = workbook.getWorksheet('Premises')?.getRow(1).values;
    expect(headers).toEqual(expect.arrayContaining(['Student seats', 'Room type']));
    expect(headers).not.toEqual(expect.arrayContaining(['Bed labels']));
  });
});

describe('premises workbook planning', () => {
  it('plans floors, default beds and explicit labels', () => {
    const result = planHospital([
      ['Ground', 'G', '0', 'Main entrance', '101', 'Private', '', '', '', ''],
      ['Ground', 'G', '0', '', '102', 'Semi-private', '2', 'Near the stairs', 'A, B', 'Occupied'],
      ['First', 'F', '1', '', '201', 'Ward', '4', '', '1-4', ''],
      ['Basement', 'B', '-1', '', '', '', '', '', '', ''],
    ]);
    expect(result.issues).toEqual([]);
    const floors = result.plan?.floors ?? [];
    expect(floors.map((floor) => floor.name)).toEqual(['Ground', 'First', 'Basement']);
    expect(floors[0].code).toBe('G');
    expect(floors[0].sortOrder).toBe(0);
    expect(floors[2].sortOrder).toBe(-1);
    expect(floors[2].rooms).toEqual([]);
    const single = floors[0].rooms[0];
    expect(single.roomType).toBe('PRIVATE');
    expect(single.capacity).toBe(1);
    expect(single.capacitySpecified).toBe(false);
    expect(single.beds).toEqual({ mode: 'auto', status: 'AVAILABLE' });
    expect(floors[0].rooms[1].beds).toEqual({ mode: 'list', items: [{ label: 'A', status: 'OCCUPIED' }, { label: 'B', status: 'OCCUPIED' }] });
    expect(floors[1].rooms[0].beds).toMatchObject({ mode: 'list', items: [{ label: '1' }, { label: '2' }, { label: '3' }, { label: '4' }] });
  });

  it('rejects a room type, a backwards range and two capacities for one room', () => {
    const result = planHospital([
      ['Ground', 'G', '0', '', '101', 'Penthouse', '1', '', '', ''],
      ['Ground', 'G', '0', '', '102', 'Semi-private', '2', '', '4-1', ''],
      ['First', '', '1', '', '201', 'Private', '1', '', '', ''],
      ['First', '', '1', '', '201', 'Private', '3', '', '', ''],
    ]);
    expect(result.plan).toBeNull();
    expect(result.issues.map((issue) => issue.message).join(' ')).toContain('Penthouse');
    expect(result.issues.map((issue) => issue.message).join(' ')).toContain('goes backwards');
    expect(result.issues.map((issue) => issue.message).join(' ')).toContain('already set to 1');
  });

  it('keeps ICU-1 as one label and expands A-C', () => {
    expect(expandBedLabels('ICU-1, ICU-2')).toEqual({ ok: true, auto: false, labels: ['ICU-1', 'ICU-2'] });
    expect(expandBedLabels('A-C')).toEqual({ ok: true, auto: false, labels: ['A', 'B', 'C'] });
    expect(expandBedLabels('')).toEqual({ ok: true, auto: true });
  });

  it('reads a semicolon CSV', async () => {
    const csv = ['Floor name;Floor code;Level;Floor notes;Room name;Room type;Maximum beds;Room notes;Bed labels;Bed status', 'Ground;G;0;;101;Private;1;;;'].join('\n');
    const read = await readPremisesWorkbook(Buffer.from(csv), 'rooms.csv');
    const result = planPremisesImport(read.matrix, HOSPITAL);
    expect(result.issues).toEqual([]);
    expect(result.plan?.floors[0].rooms[0].name).toBe('101');
  });

  it('plans a school without beds', () => {
    const result = planPremisesImport(
      [
        ['Floor name', 'Floor code', 'Level', 'Floor notes', 'Room name', 'Room type', 'Student seats', 'Room notes'],
        ['Block A', 'A', '0', '', 'Room 101', 'Classroom', '', ''],
      ],
      SCHOOL,
    );
    expect(result.issues).toEqual([]);
    expect(result.plan?.floors[0].rooms[0]).toMatchObject({ roomType: 'CLASSROOM', capacity: 40, capacitySpecified: false, beds: null });
  });
});

describe('premises workbook resolve', () => {
  it('creates numbered beds and reuses an existing floor', () => {
    const planned = planHospital([['Ground', 'G', '0', 'Lobby', '101', 'Private', '', '', '', '']]);
    const resolved = resolvePremisesImport(
      planned.plan!,
      { floors: [{ id: 'f1', name: 'Ground', code: null, sortOrder: 0, notes: null }], rooms: [], beds: [] },
      HOSPITAL,
      500,
    );
    expect(resolved.issues).toEqual([]);
    expect(resolved.actions.createFloors).toEqual([]);
    expect(resolved.actions.updateFloors).toEqual([{ id: 'f1', code: 'G', notes: 'Lobby' }]);
    expect(resolved.actions.createRooms).toEqual([expect.objectContaining({ name: '101', capacity: 1, roomType: 'PRIVATE' })]);
    expect(resolved.actions.createBeds).toEqual([{ floorKey: 'ground', roomName: '101', label: '1', status: 'AVAILABLE' }]);
    expect(resolved.summary).toMatchObject({ floorsReused: 1, roomsCreated: 1, bedsCreated: 1 });
  });

  it('skips a bed that already exists and refuses to pass the licence', () => {
    const planned = planHospital([['Ground', '', '', '', '101', 'Semi-private', '2', '', '1-2', '']]);
    const skipped = resolvePremisesImport(
      planned.plan!,
      {
        floors: [{ id: 'f1', name: 'Ground', code: 'G', sortOrder: 0, notes: null }],
        rooms: [{ id: 'r1', floorId: 'f1', name: '101', roomType: 'SEMI_PRIVATE', capacity: 2, notes: null }],
        beds: [{ roomId: 'r1', label: '1' }],
      },
      HOSPITAL,
      500,
    );
    expect(skipped.issues).toEqual([]);
    expect(skipped.actions.createBeds.map((bed) => bed.label)).toEqual(['2']);
    expect(skipped.summary.bedsSkipped).toBe(1);

    const over = resolvePremisesImport(planned.plan!, { floors: [], rooms: [], beds: [] }, HOSPITAL, 1);
    expect(over.issues.map((issue) => issue.message).join(' ')).toContain('licensed');
    expect(over.actions.createRooms).toEqual([]);
  });

  it('reports a room that is already full', () => {
    const planned = planHospital([['Ground', '', '', '', '101', 'Private', '', '', '', '']]);
    const resolved = resolvePremisesImport(
      planned.plan!,
      {
        floors: [{ id: 'f1', name: 'Ground', code: null, sortOrder: 0, notes: null }],
        rooms: [{ id: 'r1', floorId: 'f1', name: '101', roomType: 'PRIVATE', capacity: 1, notes: null }],
        beds: [{ roomId: 'r1', label: 'A' }],
      },
      HOSPITAL,
      500,
    );
    expect(resolved.issues[0]?.message).toContain('fills its capacity');
    expect(resolved.actions.createBeds).toEqual([]);
  });
});

describe('import summary', () => {
  it('describes what was added', () => {
    expect(describeImportSummary({ floorsCreated: 2, floorsReused: 0, roomsCreated: 3, roomsReused: 0, bedsCreated: 6, bedsSkipped: 0 })).toBe('Added 2 floors, 3 rooms and 6 beds.');
    expect(describeImportSummary({ floorsCreated: 0, floorsReused: 1, roomsCreated: 0, roomsReused: 1, bedsCreated: 0, bedsSkipped: 2 })).toBe(
      'Nothing new to add. Those floors, rooms and beds are already on file. 2 beds were already in their rooms.',
    );
  });
});
