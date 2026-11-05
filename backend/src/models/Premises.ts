import { CreationOptional, DataTypes, InferAttributes, InferCreationAttributes, Model, NonAttribute } from 'sequelize';
import { sequelize } from '../config/database';
import type { BedStatus } from '../config/organizationTypes';

export class Floor extends Model<InferAttributes<Floor>, InferCreationAttributes<Floor>> {
  declare id: CreationOptional<string>;
  declare organizationId: string;
  declare name: string;
  declare code: CreationOptional<string | null>;
  declare sortOrder: CreationOptional<number>;
  declare notes: CreationOptional<string | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
  declare rooms?: NonAttribute<Room[]>;
}

Floor.init(
  {
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    organizationId: { type: DataTypes.UUID, allowNull: false },
    name: { type: DataTypes.STRING(80), allowNull: false },
    code: { type: DataTypes.STRING(16), allowNull: true },
    sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    notes: { type: DataTypes.STRING(255), allowNull: true },
    createdAt: DataTypes.DATE(3),
    updatedAt: DataTypes.DATE(3),
  },
  { sequelize, tableName: 'floors' },
);

export class Room extends Model<InferAttributes<Room>, InferCreationAttributes<Room>> {
  declare id: CreationOptional<string>;
  declare organizationId: string;
  declare floorId: string;
  declare name: string;
  declare roomType: string;
  declare capacity: number;
  declare notes: CreationOptional<string | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
  declare floor?: NonAttribute<Floor>;
  declare beds?: NonAttribute<Bed[]>;
}

Room.init(
  {
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    organizationId: { type: DataTypes.UUID, allowNull: false },
    floorId: { type: DataTypes.UUID, allowNull: false },
    name: { type: DataTypes.STRING(80), allowNull: false },
    roomType: { type: DataTypes.STRING(32), allowNull: false },
    capacity: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    notes: { type: DataTypes.STRING(255), allowNull: true },
    createdAt: DataTypes.DATE(3),
    updatedAt: DataTypes.DATE(3),
  },
  { sequelize, tableName: 'rooms' },
);

export class Bed extends Model<InferAttributes<Bed>, InferCreationAttributes<Bed>> {
  declare id: CreationOptional<string>;
  declare organizationId: string;
  declare roomId: string;
  declare label: string;
  declare status: CreationOptional<BedStatus>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
  declare room?: NonAttribute<Room>;
}

Bed.init(
  {
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    organizationId: { type: DataTypes.UUID, allowNull: false },
    roomId: { type: DataTypes.UUID, allowNull: false },
    label: { type: DataTypes.STRING(40), allowNull: false },
    status: {
      type: DataTypes.ENUM('AVAILABLE', 'OCCUPIED', 'RESERVED', 'MAINTENANCE'),
      allowNull: false,
      defaultValue: 'AVAILABLE',
    },
    createdAt: DataTypes.DATE(3),
    updatedAt: DataTypes.DATE(3),
  },
  { sequelize, tableName: 'beds' },
);

export class EmployeeType extends Model<InferAttributes<EmployeeType>, InferCreationAttributes<EmployeeType>> {
  declare id: CreationOptional<string>;
  declare organizationId: string;
  declare name: string;
  declare code: string;
  declare description: CreationOptional<string | null>;
  declare sortOrder: CreationOptional<number>;
  declare active: CreationOptional<boolean>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

EmployeeType.init(
  {
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    organizationId: { type: DataTypes.UUID, allowNull: false },
    name: { type: DataTypes.STRING(80), allowNull: false },
    code: { type: DataTypes.STRING(16), allowNull: false },
    description: { type: DataTypes.STRING(255), allowNull: true },
    sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    createdAt: DataTypes.DATE(3),
    updatedAt: DataTypes.DATE(3),
  },
  { sequelize, tableName: 'employee_types' },
);

export class Department extends Model<InferAttributes<Department>, InferCreationAttributes<Department>> {
  declare id: CreationOptional<string>;
  declare organizationId: string;
  declare name: string;
  declare code: string;
  declare description: CreationOptional<string | null>;
  declare seatLimit: CreationOptional<number | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

Department.init(
  {
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    organizationId: { type: DataTypes.UUID, allowNull: false },
    name: { type: DataTypes.STRING(80), allowNull: false },
    code: { type: DataTypes.STRING(16), allowNull: false },
    description: { type: DataTypes.STRING(255), allowNull: true },
    seatLimit: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    createdAt: DataTypes.DATE(3),
    updatedAt: DataTypes.DATE(3),
  },
  { sequelize, tableName: 'departments' },
);
