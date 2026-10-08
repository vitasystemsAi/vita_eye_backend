import { Router } from 'express';
import * as c from '../controllers/events.controller';
import { authenticate, requirePermission } from '../middleware/auth';
import { sensitiveLimiter } from '../middleware/rateLimit';

export const eventsRouter = Router();
eventsRouter.use(authenticate);
eventsRouter.get('/', requirePermission('events:view'), c.list);
eventsRouter.get('/export', sensitiveLimiter, requirePermission('events:view', 'events:export'), c.exportEvents);
eventsRouter.get('/:id', requirePermission('events:view'), c.get);
eventsRouter.post('/:id/acknowledge', requirePermission('events:review'), c.acknowledge);
eventsRouter.post('/:id/investigate', requirePermission('events:review'), c.investigate);
eventsRouter.post('/:id/notes', requirePermission('events:review'), c.addNote);
eventsRouter.post('/:id/resolve', requirePermission('events:review'), c.resolve);
eventsRouter.post('/:id/reopen', requirePermission('events:review'), c.reopen);

export const evidenceRouter = Router();
evidenceRouter.use(authenticate);
evidenceRouter.get('/download', requirePermission('evidence:view'), c.evidenceDownload);
evidenceRouter.get('/urls', sensitiveLimiter, requirePermission('evidence:view'), c.evidenceUrls);
evidenceRouter.get('/:id/url', sensitiveLimiter, requirePermission('evidence:view'), c.evidenceUrl);
