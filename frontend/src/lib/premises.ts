import type { BedStatus, MasterKind, OrganizationTypeCode } from './types';

export type { BedStatus, MasterKind, OrganizationTypeCode };

export interface OrganizationTypeInfo {
  code: OrganizationTypeCode;
  label: string;
  description: string;
  capacityUnit: string;
  capacityLabel: string;
  capacities: number[];
  master: MasterKind;
}

export interface RoomTypeInfo {
  code: string;
  label: string;
  defaultCapacity: number;
}

export interface PremisesProfile extends OrganizationTypeInfo {
  capacity: number | null;
  roomCapacityLabel: string | null;
  roomTypes: RoomTypeInfo[];
}

export interface PremisesFloor {
  id: string;
  name: string;
  code: string | null;
  sortOrder: number;
  notes: string | null;
  roomCount: number;
}

export interface PremisesRoom {
  id: string;
  floorId: string;
  floorName: string;
  name: string;
  roomType: string;
  capacity: number;
  notes: string | null;
  bedCount: number;
}

export interface PremisesBed {
  id: string;
  roomId: string;
  roomName: string;
  floorName: string;
  label: string;
  status: BedStatus;
}

export interface EmployeeTypeRow {
  id: string;
  name: string;
  code: string;
  description: string | null;
  sortOrder: number;
  active: boolean;
}

export interface DepartmentRow {
  id: string;
  name: string;
  code: string;
  description: string | null;
  seatLimit: number | null;
}

export interface PremisesOverview {
  profile: PremisesProfile;
  usage: { used: number; remaining: number | null; unit: string; planned: number | null };
  floors: PremisesFloor[];
  rooms: PremisesRoom[];
  beds: PremisesBed[];
  employeeTypes: EmployeeTypeRow[];
  departments: DepartmentRow[];
  bedStatuses: BedStatus[];
}

export const BED_STATUS_LABELS: Record<BedStatus, string> = {
  AVAILABLE: 'Available',
  OCCUPIED: 'Occupied',
  RESERVED: 'Reserved',
  MAINTENANCE: 'Maintenance',
};
