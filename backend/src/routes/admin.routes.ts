import { Router } from 'express';
import * as users from '../controllers/users.controller';
import * as auditCtl from '../controllers/audit.controller';
import { authenticate, requirePermission } from '../middleware/auth';
import { sensitiveLimiter } from '../middleware/rateLimit';

const r = Router();

r.get('/users', authenticate, requirePermission('users:view'), users.list);
r.post('/users', sensitiveLimiter, authenticate, requirePermission('users:manage'), users.create);
r.patch('/users/:id', sensitiveLimiter, authenticate, requirePermission('users:manage'), users.update);
r.get('/roles', authenticate, requirePermission('users:view'), users.roles);
r.get('/audit-logs', authenticate, requirePermission('audit:view'), auditCtl.list);

export default r;
