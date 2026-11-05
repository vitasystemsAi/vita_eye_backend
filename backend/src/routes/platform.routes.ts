import { Router } from 'express';
import * as c from '../controllers/platform.controller';
import { authenticatePlatform } from '../middleware/platformAuth';
import { authLimiter, sensitiveLimiter } from '../middleware/rateLimit';

const r = Router();

r.post('/auth/login', authLimiter, c.login);
r.post('/auth/logout', (req, res, next) => authenticatePlatform(req, res, () => next()), c.logout);
r.get('/auth/me', authenticatePlatform, c.me);
r.post('/auth/forgot-password', authLimiter, c.forgotPassword);
r.post('/auth/reset-password', authLimiter, c.resetPassword);

r.use(authenticatePlatform);
r.get('/features', c.features);
r.get('/plans', c.plans);
r.get('/organization-types', c.organizationTypes);
r.get('/dashboard', c.dashboard);
r.get('/organizations', c.listClients);
r.post('/organizations', sensitiveLimiter, c.register);
r.get('/organizations/:id', c.getClient);
r.get('/organizations/:id/detections', c.detections);
r.patch('/organizations/:id', c.update);
r.post('/organizations/:id/provision/retry', sensitiveLimiter, c.retry);
r.post('/organizations/:id/account', sensitiveLimiter, c.account);
r.post('/organizations/:id/holds/:holdId/release', sensitiveLimiter, c.releaseHold);
r.post('/organizations/:id/credentials/reset', sensitiveLimiter, c.resetPasswordForClient);
r.post('/organizations/:id/impersonate', sensitiveLimiter, c.impersonate);
r.get('/audit-logs', c.auditLog);

export default r;
