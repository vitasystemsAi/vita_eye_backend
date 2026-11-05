import { Router } from 'express';
import * as premises from '../controllers/premises.controller';
import { authenticate, requirePermission } from '../middleware/auth';

const r = Router();

r.use(authenticate, requirePermission('premises:view'));

r.get('/', premises.overview);

const manage = requirePermission('premises:manage');
r.post('/floors', manage, premises.createFloor);
r.patch('/floors/:id', manage, premises.updateFloor);
r.delete('/floors/:id', manage, premises.deleteFloor);

r.post('/rooms', manage, premises.createRoom);
r.patch('/rooms/:id', manage, premises.updateRoom);
r.delete('/rooms/:id', manage, premises.deleteRoom);

r.post('/beds', manage, premises.createBed);
r.patch('/beds/:id', manage, premises.updateBed);
r.delete('/beds/:id', manage, premises.deleteBed);

r.post('/employee-types/defaults', manage, premises.seedEmployeeTypes);
r.post('/employee-types', manage, premises.createEmployeeType);
r.patch('/employee-types/:id', manage, premises.updateEmployeeType);
r.delete('/employee-types/:id', manage, premises.deleteEmployeeType);

r.post('/departments', manage, premises.createDepartment);
r.patch('/departments/:id', manage, premises.updateDepartment);
r.delete('/departments/:id', manage, premises.deleteDepartment);

export default r;
