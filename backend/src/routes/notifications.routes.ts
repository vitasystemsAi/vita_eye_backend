import { Router } from 'express';
import * as c from '../controllers/notifications.controller';
import { authenticate, requirePermission } from '../middleware/auth';
import { sensitiveLimiter } from '../middleware/rateLimit';

const r = Router();
r.use(authenticate);

r.get('/', c.list);
r.post('/read-all', c.readAll);
r.get('/settings', requirePermission('notifications:view'), c.getSettings);
r.patch('/settings', requirePermission('notifications:manage'), c.patchSettings);
r.get('/logs', requirePermission('notifications:view'), c.logs);
r.post('/test', sensitiveLimiter, requirePermission('notifications:manage'), c.test);
r.post('/devices', c.registerDevice);
r.post('/:id/read', c.read);

export default r;
