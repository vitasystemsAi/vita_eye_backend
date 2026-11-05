import { describe, expect, it } from 'vitest';
import { ROLES } from '../config/rbac';
import { enabledFeatures, filterPermissions, type FeatureKey } from '../config/features';
import type { Permission } from '../config/rbac';
import { buildPeopleWorkbook, planPeopleSheet, readPeopleWorkbook, resolvePeopleImport, type PeopleLabels } from './peopleWorkbook';

const office: PeopleLabels = { hostel: false, reference: 'Reference ID', department: 'Department' };
const hostel: PeopleLabels = { hostel: true, reference: 'Mobile number', department: 'Room number' };

describe('people directory import', () => {
  it('reads a csv and updates an existing person without clearing a blank department', () => {
    const csv = 'Name,Reference ID,Department,Status\nJane,EMP-1,Front office,Active\nJane,EMP-1,Front office,Active\nArun,EMP-2,,Suspended\n';
    const planned = planPeopleSheet(csv.split('\n').map((line) => line.split(',')), office);
    expect(planned.issues).toEqual([]);
    expect(planned.people[1]?.problems.join(' ')).toContain('row 2');
    const resolved = resolvePeopleImport(
      planned.people.filter((person) => person.referenceId === 'EMP-2' || person.problems.length === 0).slice(0, 2),
      [{ id: 'p1', referenceId: 'emp-1', personName: 'Janet', department: 'Security', status: 'ACTIVE' }],
      'upsert',
      null,
      office,
    );
    const jane = resolved.rows.find((row) => row.referenceId === 'EMP-1');
    const arun = resolved.rows.find((row) => row.referenceId === 'EMP-2');
    expect(jane?.action).toBe('update');
    expect(jane?.detail).toContain('name');
    expect(jane?.departmentSpecified).toBe(true);
    expect(arun?.action).toBe('create');
    expect(arun?.status).toBe('SUSPENDED');
    expect(arun?.departmentSpecified).toBe(false);
  });

  it('requires a mobile number and room for a hostel and blocks the capacity', () => {
    const planned = planPeopleSheet(
      [
        ['Name', 'Mobile number', 'Room number'],
        ['Asha', '987654321', '12'],
        ['Ravi', '9876543210', ''],
        ['Meera', '9876543211', '4'],
      ],
      hostel,
    );
    expect(planned.people[0]?.problems.join(' ')).toContain('10-digit');
    expect(planned.people[1]?.problems.join(' ')).toContain('Room number');
    const resolved = resolvePeopleImport(
      [{ row: 2, personName: 'Meera', referenceId: '9876543211', department: '4', departmentSpecified: true, status: null, problems: [] }],
      [],
      'add',
      { limit: 1, used: 1 },
      hostel,
    );
    expect(resolved.rows[0]?.action).toBe('create');
    expect(resolved.issues[0]?.path).toBe('Capacity');
  });

  it('round-trips a template and does not import the example sheet', async () => {
    const file = await buildPeopleWorkbook({ organizationName: 'North Gate', labels: office, rows: [], template: true });
    const read = await readPeopleWorkbook(file.body, file.fileName, office);
    expect(read.people).toEqual([]);
    expect(read.issues[0]?.message).toContain('Example sheet');
  });
});

describe('data exchange permissions', () => {
  const moved = ['data:export', 'data:import', 'faces:export', 'faces:import'] as const;

  it('gives both organization admins directory and facial transfer', () => {
    for (const role of ['SUPER_ADMIN', 'SECURITY_ADMIN'] as const) {
      for (const permission of moved) expect(ROLES[role].permissions).toContain(permission);
    }
  });

  it('lets an auditor export the directory and keeps facial transfer with the admins', () => {
    expect(ROLES.AUDITOR.permissions).toContain('data:export');
    expect(ROLES.AUDITOR.permissions.includes('data:import')).toBe(false);
    expect(ROLES.AUDITOR.permissions.includes('faces:export')).toBe(false);
    expect(ROLES.SECURITY_OPERATOR.permissions.some((permission) => moved.includes(permission as (typeof moved)[number]))).toBe(false);
    expect(ROLES.PREVIEW.permissions.some((permission) => moved.includes(permission as (typeof moved)[number]))).toBe(false);
  });

  it('removes the transfer permissions when face registration is off', () => {
    const granted = new Set<Permission>([...moved, 'dashboard:view']);
    const blocked = filterPermissions(granted, enabledFeatures(['dashboard'] satisfies FeatureKey[]));
    expect(blocked.has('data:export')).toBe(false);
    expect(blocked.has('faces:import')).toBe(false);
    expect(blocked.has('dashboard:view')).toBe(true);
    const open = filterPermissions(granted, enabledFeatures(['dashboard', 'faceRegistration']));
    expect(open.has('faces:export')).toBe(true);
  });
});
