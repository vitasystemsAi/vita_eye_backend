import { Router } from 'express';
import * as c from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth';
import { authLimiter } from '../middleware/rateLimit';

const r = Router();

r.get('/csrf', c.csrf);
r.post('/login', authLimiter, c.login);
r.post('/refresh', authLimiter, c.refresh);
r.post('/logout', (req, res, next) => authenticate(req, res, () => next()), c.logout);
r.get('/me', authenticate, c.me);
r.post('/forgot-password', authLimiter, c.forgotPassword);
r.post('/reset-password', authLimiter, c.resetPassword);

export default r;
