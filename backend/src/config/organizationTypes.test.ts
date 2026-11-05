import { describe, expect, it } from 'vitest';
import {
  ORGANIZATION_TYPE_CODES,
  ORGANIZATION_TYPES,
  exceedsCapacity,
  isAllowedCapacity,
  organizationTypeOf,
  roomTypeOf,
} from './organizationTypes';

describe('organization types', () => {
  it('gives every type a label, a unit and at least one capacity', () => {
    const codes = new Set<string>();
    for (const code of ORGANIZATION_TYPE_CODES) {
      const type = ORGANIZATION_TYPES[code];
      expect(type.code).toBe(code);
      expect(type.label.length).toBeGreaterThan(1);
      expect(type.capacityUnit.length).toBeGreaterThan(1);
      expect(type.capacities.length).toBeGreaterThan(0);
      expect(type.capacities.every((n) => Number.isInteger(n) && n > 0)).toBe(true);
      expect(new Set(type.capacities).size).toBe(type.capacities.length);
      codes.add(code);
      const roomCodes = type.roomTypes.map((room) => room.code);
      expect(new Set(roomCodes).size).toBe(roomCodes.length);
    }
    expect(codes.size).toBe(ORGANIZATION_TYPE_CODES.length);
  });

  it('accepts only the listed capacity for that type', () => {
    expect(isAllowedCapacity('HOSTEL', 100)).toBe(true);
    expect(isAllowedCapacity('HOSTEL', 32)).toBe(false);
    expect(isAllowedCapacity('HOME', 6)).toBe(true);
    expect(isAllowedCapacity('OFFICE', 6)).toBe(false);
  });

  it('falls back when a stored type is missing', () => {
    expect(organizationTypeOf(null).code).toBe('OTHER');
    expect(organizationTypeOf('HOSTEL').master).toBe('tenants');
    expect(organizationTypeOf('HOSTEL').roomTypes).toEqual([]);
  });

  it('resolves a room type inside its organization type', () => {
    expect(roomTypeOf('HOSPITAL', 'WARD')?.defaultCapacity).toBe(6);
    expect(roomTypeOf('HOSTEL', 'DORM')).toBeUndefined();
    expect(roomTypeOf('OFFICE', 'SINGLE')).toBeUndefined();
  });

  it('treats a missing capacity as unlimited and blocks anything past a set limit', () => {
    expect(exceedsCapacity(null, 500, 1)).toBe(false);
    expect(exceedsCapacity(100, 100, 0)).toBe(false);
    expect(exceedsCapacity(100, 99, 1)).toBe(false);
    expect(exceedsCapacity(100, 100, 1)).toBe(true);
  });
});
