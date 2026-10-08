import { Router } from 'express';
import * as c from '../controllers/health.controller';
import { authenticate, requirePermission } from '../middleware/auth';

const r = Router();

r.get('/', c.liveness);
r.get('/details', authenticate, requirePermission('settings:view'), c.details);

export default r;
