import { Router } from 'express';
import * as c from '../controllers/platform.controller';
import { authenticatePlatform } from '../middleware/platformAuth';
import { authLimiter, sensitiveLimiter } from '../middleware/rateLimit';

const r = Router();

r.post('/auth/login', authLimiter, c.login);
r.post('/auth/logout', (req, res, next) => authenticatePlatform(req, res, () => next()), c.logout);
r.get('/auth/me', authenticatePlatform, c.me);

r.use(authenticatePlatform);
r.get('/features', c.features);
r.get('/organizations', c.listClients);
r.post('/organizations', sensitiveLimiter, c.register);
r.get('/organizations/:id', c.getClient);
r.patch('/organizations/:id', c.update);
r.post('/organizations/:id/hold', c.hold);
r.post('/organizations/:id/credentials/reveal', sensitiveLimiter, c.revealPassword);
r.post('/organizations/:id/credentials/reset', sensitiveLimiter, c.resetPassword);
r.post('/organizations/:id/impersonate', sensitiveLimiter, c.impersonate);
r.get('/audit-logs', c.auditLog);

export default r;
