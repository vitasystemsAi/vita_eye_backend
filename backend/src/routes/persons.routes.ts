import { Router } from 'express';
import multer from 'multer';
import * as c from '../controllers/persons.controller';
import { authenticate, requirePermission, restoreTenant } from '../middleware/auth';
import { sensitiveLimiter } from '../middleware/rateLimit';

// Enrollment images are processed in memory and never written to disk (data minimisation).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 5 },
});

const r = Router();
r.use(authenticate);

r.get('/', requirePermission('persons:view'), c.list);
r.post('/pose-guide', requirePermission('persons:enroll'), upload.single('image'), c.poseGuide);
r.post('/', requirePermission('persons:manage'), c.create);
r.get('/:id', requirePermission('persons:view'), c.get);
r.patch('/:id', requirePermission('persons:manage'), c.update);
r.post('/:id/enroll', sensitiveLimiter, requirePermission('persons:enroll'), upload.array('images', 5), restoreTenant, c.enroll);
r.post('/:id/cancel', requirePermission('persons:manage'), c.cancel);
r.post('/:id/status', requirePermission('persons:manage'), c.changeStatus);
r.post('/:id/deactivate', requirePermission('persons:manage'), c.deactivate);
r.post('/:id/activate', requirePermission('persons:manage'), c.activate);
r.delete('/:id', sensitiveLimiter, requirePermission('persons:delete'), c.remove);

export default r;
