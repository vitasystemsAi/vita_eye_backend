export const ORGANIZATION_TYPE_CODES = ['OFFICE', 'HOSTEL', 'HOME', 'SCHOOL', 'HOSPITAL', 'OTHER'] as const;
export type OrganizationTypeCode = (typeof ORGANIZATION_TYPE_CODES)[number];

/** Which master-data catalog the organization admin maintains. */
export type MasterKind = 'workforce' | 'lodging' | 'layout' | 'none';

export const BED_STATUSES = ['AVAILABLE', 'OCCUPIED', 'RESERVED', 'MAINTENANCE'] as const;
export type BedStatus = (typeof BED_STATUSES)[number];

export interface RoomTypeDefinition {
  code: string;
  label: string;
  defaultCapacity: number;
}

export interface OrganizationTypeDefinition {
  code: OrganizationTypeCode;
  label: string;
  description: string;
  /** Noun used in capacity copy: beds, employees, residents, students, people. */
  capacityUnit: string;
  capacityLabel: string;
  capacities: readonly number[];
  master: MasterKind;
  roomCapacityLabel: string | null;
  roomTypes: readonly RoomTypeDefinition[];
}

const HOSTEL_ROOMS: readonly RoomTypeDefinition[] = [
  { code: 'SINGLE', label: 'Single', defaultCapacity: 1 },
  { code: 'DOUBLE', label: 'Double', defaultCapacity: 2 },
  { code: 'TRIPLE', label: 'Triple', defaultCapacity: 3 },
  { code: 'DORM', label: 'Dormitory', defaultCapacity: 8 },
  { code: 'SUITE', label: 'Suite', defaultCapacity: 2 },
];

const HOSPITAL_ROOMS: readonly RoomTypeDefinition[] = [
  { code: 'WARD', label: 'Ward', defaultCapacity: 6 },
  { code: 'SEMI_PRIVATE', label: 'Semi-private', defaultCapacity: 2 },
  { code: 'PRIVATE', label: 'Private', defaultCapacity: 1 },
  { code: 'ICU', label: 'ICU', defaultCapacity: 1 },
  { code: 'ISOLATION', label: 'Isolation', defaultCapacity: 1 },
];

const HOME_ROOMS: readonly RoomTypeDefinition[] = [
  { code: 'BEDROOM', label: 'Bedroom', defaultCapacity: 2 },
  { code: 'LIVING', label: 'Living room', defaultCapacity: 4 },
  { code: 'KITCHEN', label: 'Kitchen', defaultCapacity: 2 },
  { code: 'OTHER', label: 'Other', defaultCapacity: 1 },
];

const SCHOOL_ROOMS: readonly RoomTypeDefinition[] = [
  { code: 'CLASSROOM', label: 'Classroom', defaultCapacity: 40 },
  { code: 'LABORATORY', label: 'Laboratory', defaultCapacity: 30 },
  { code: 'HALL', label: 'Hall', defaultCapacity: 100 },
  { code: 'STAFF', label: 'Staff room', defaultCapacity: 15 },
  { code: 'OTHER', label: 'Other', defaultCapacity: 20 },
];

export const ORGANIZATION_TYPES: Record<OrganizationTypeCode, OrganizationTypeDefinition> = {
  OFFICE: {
    code: 'OFFICE',
    label: 'Office',
    description: 'A workplace. Capacity is the licensed headcount. The organization admin maintains employee types and departments.',
    capacityUnit: 'employees',
    capacityLabel: 'Employee capacity',
    capacities: [10, 25, 50, 100, 250, 500, 1000, 2500],
    master: 'workforce',
    roomCapacityLabel: null,
    roomTypes: [],
  },
  HOSTEL: {
    code: 'HOSTEL',
    label: 'Hostel',
    description: 'A residential hostel. Capacity is the number of beds. The organization admin adds floors, rooms and beds up to that limit.',
    capacityUnit: 'beds',
    capacityLabel: 'Bed capacity',
    capacities: [20, 50, 100, 200, 350, 500, 1000, 2000],
    master: 'lodging',
    roomCapacityLabel: 'Maximum beds',
    roomTypes: HOSTEL_ROOMS,
  },
  HOME: {
    code: 'HOME',
    label: 'Home',
    description: 'A private home. Capacity is the number of residents. The organization admin lays out floors and rooms.',
    capacityUnit: 'residents',
    capacityLabel: 'Resident capacity',
    capacities: [2, 4, 6, 8, 12, 20],
    master: 'layout',
    roomCapacityLabel: 'Occupants',
    roomTypes: HOME_ROOMS,
  },
  SCHOOL: {
    code: 'SCHOOL',
    label: 'School',
    description: 'A school or campus. Capacity is student seats. The organization admin adds floors or blocks and classrooms.',
    capacityUnit: 'students',
    capacityLabel: 'Student capacity',
    capacities: [50, 150, 300, 600, 1200, 2500, 5000],
    master: 'layout',
    roomCapacityLabel: 'Student seats',
    roomTypes: SCHOOL_ROOMS,
  },
  HOSPITAL: {
    code: 'HOSPITAL',
    label: 'Hospital',
    description: 'A hospital or clinic. Capacity is the number of beds. The organization admin adds floors, rooms and beds.',
    capacityUnit: 'beds',
    capacityLabel: 'Bed capacity',
    capacities: [20, 50, 100, 200, 400, 800, 1500],
    master: 'lodging',
    roomCapacityLabel: 'Maximum beds',
    roomTypes: HOSPITAL_ROOMS,
  },
  OTHER: {
    code: 'OTHER',
    label: 'Other',
    description: 'A general site. Capacity is people on site. No floor or workforce catalog is required.',
    capacityUnit: 'people',
    capacityLabel: 'People capacity',
    capacities: [10, 25, 50, 100, 250, 500, 1000],
    master: 'none',
    roomCapacityLabel: null,
    roomTypes: [],
  },
};

export const STANDARD_EMPLOYEE_TYPES = [
  { name: 'Full-time', code: 'FT', description: 'Permanent employee', sortOrder: 10 },
  { name: 'Part-time', code: 'PT', description: 'Part-time employee', sortOrder: 20 },
  { name: 'Contractor', code: 'CTR', description: 'Fixed-term or contract staff', sortOrder: 30 },
  { name: 'Intern', code: 'INT', description: 'Intern or trainee', sortOrder: 40 },
  { name: 'Consultant', code: 'CON', description: 'External consultant', sortOrder: 50 },
  { name: 'Security', code: 'SEC', description: 'Security staff', sortOrder: 60 },
  { name: 'Visitor', code: 'VIS', description: 'Temporary visitor', sortOrder: 70 },
  { name: 'Vendor', code: 'VEN', description: 'Vendor or service partner', sortOrder: 80 },
] as const;

export function isOrganizationType(value: string): value is OrganizationTypeCode {
  return (ORGANIZATION_TYPE_CODES as readonly string[]).includes(value);
}

export function organizationTypeOf(value: string | null | undefined): OrganizationTypeDefinition {
  if (value && isOrganizationType(value)) return ORGANIZATION_TYPES[value];
  return ORGANIZATION_TYPES.OTHER;
}

export function isAllowedCapacity(type: OrganizationTypeCode, capacity: number): boolean {
  return ORGANIZATION_TYPES[type].capacities.includes(capacity);
}

export function roomTypeOf(type: OrganizationTypeCode, code: string): RoomTypeDefinition | undefined {
  return ORGANIZATION_TYPES[type].roomTypes.find((room) => room.code === code);
}

/** True when `used + adding` is above a licensed capacity. A null capacity is unlimited. */
export function exceedsCapacity(capacity: number | null, used: number, adding = 0): boolean {
  return capacity != null && used + adding > capacity;
}

export function organizationTypeCatalog() {
  return ORGANIZATION_TYPE_CODES.map((code) => {
    const type = ORGANIZATION_TYPES[code];
    return {
      code: type.code,
      label: type.label,
      description: type.description,
      capacityUnit: type.capacityUnit,
      capacityLabel: type.capacityLabel,
      capacities: [...type.capacities],
      master: type.master,
    };
  });
}
