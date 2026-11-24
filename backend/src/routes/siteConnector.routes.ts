import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth';
import * as connector from '../controllers/siteConnector.controller';

const r = Router();

r.post('/key', authenticate, requirePermission('cameras:manage'), connector.issue);
r.get('/cameras', connector.assignments);
r.post('/cameras/:id/frame', connector.frame);

export default r;
