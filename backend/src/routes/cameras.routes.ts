import { Router } from 'express';
import * as c from '../controllers/cameras.controller';
import { authenticate, requirePermission } from '../middleware/auth';
import { sensitiveLimiter } from '../middleware/rateLimit';

const r = Router();
r.use(authenticate);

r.get('/', requirePermission('cameras:view'), c.list);
r.post('/', requirePermission('cameras:manage'), c.create);
r.post('/test-connection', sensitiveLimiter, requirePermission('cameras:manage'), c.testDraft);
r.post('/preview/probe', sensitiveLimiter, requirePermission('cameras:manage'), c.previewProbe);
r.post('/preview/start', sensitiveLimiter, requirePermission('cameras:manage'), c.previewStart);
r.get('/preview/:sessionId', requirePermission('cameras:manage'), c.previewRead);
r.post('/preview/:sessionId/stop', requirePermission('cameras:manage'), c.previewEnd);
r.post('/discover-lan-port', requirePermission('cameras:manage'), c.discover);
r.post('/cp-plus', requirePermission('cameras:manage'), c.enrollCpPlus);
r.get('/:id', requirePermission('cameras:view'), c.get);
r.patch('/:id', requirePermission('cameras:manage'), c.update);
r.delete('/:id', requirePermission('cameras:manage'), c.remove);
r.post('/:id/test-connection', sensitiveLimiter, requirePermission('cameras:manage'), c.test);
r.post('/:id/start-monitoring', requirePermission('cameras:monitor'), c.start);
r.post('/:id/stop-monitoring', requirePermission('cameras:monitor'), c.stop);

export default r;
