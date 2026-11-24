import { Router } from 'express';
import authRoutes from './auth.routes';
import adminRoutes from './admin.routes';
import healthRoutes from './health.routes';
import personsRoutes from './persons.routes';
import camerasRoutes from './cameras.routes';
import notificationsRoutes from './notifications.routes';
import platformRoutes from './platform.routes';
import { eventsRouter, evidenceRouter } from './events.routes';
import premisesRoutes from './premises.routes';
import dataExchangeRoutes from './dataExchange.routes';
import * as dashboard from '../controllers/dashboard.controller';
import * as settings from '../controllers/settings.controller';
import * as internal from '../controllers/internal.controller';
import { authenticate, requirePermission } from '../middleware/auth';
import { requireInternalToken } from '../middleware/internal';

const api = Router();

api.use('/auth', authRoutes);
api.use('/platform', platformRoutes);
api.use('/health', healthRoutes);
api.use('/persons', personsRoutes);
api.use('/cameras', camerasRoutes);
api.use('/events', eventsRouter);
api.use('/evidence', evidenceRouter);
api.use('/notifications', notificationsRoutes);
api.use('/premises', premisesRoutes);
api.use('/data', dataExchangeRoutes);

const dash = Router();
dash.use(authenticate, requirePermission('dashboard:view'));
dash.get('/summary', dashboard.summary);
dash.get('/trends', dashboard.trends);
dash.get('/activity', dashboard.activity);
api.use('/dashboard', dash);

const settingsRouter = Router();
settingsRouter.use(authenticate);
settingsRouter.get('/', requirePermission('settings:view'), settings.get);
settingsRouter.patch('/', requirePermission('settings:manage'), settings.patch);
api.use('/settings', settingsRouter);

const internalRouter = Router();
internalRouter.use(requireInternalToken);
internalRouter.get('/gallery/:organizationId', internal.gallery);
internalRouter.post('/detections', internal.detections);
internalRouter.post('/cameras/:id/status', internal.cameraStatus);
internalRouter.post('/cameras/:id/preview', internal.cameraPreview);
api.use('/internal', internalRouter);

api.use('/', adminRoutes);

export default api;
