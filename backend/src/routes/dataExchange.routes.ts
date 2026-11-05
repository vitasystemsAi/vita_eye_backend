import { Router } from 'express';
import multer from 'multer';
import * as exchange from '../controllers/dataExchange.controller';
import { authenticate, requireFeature, requirePermission, restoreTenant } from '../middleware/auth';
import { sensitiveLimiter } from '../middleware/rateLimit';

const spreadsheet = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});

const facePackage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 80 * 1024 * 1024, files: 1 },
});

const photos = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 40 * 1024 * 1024, files: 1 },
});

const r = Router();

r.use(authenticate, requireFeature('faceRegistration'));

r.get('/people/template', requirePermission('data:import'), exchange.downloadPeopleTemplate);
r.get('/people/export', sensitiveLimiter, requirePermission('data:export'), exchange.exportPeople);
r.post('/people/import', sensitiveLimiter, requirePermission('data:import'), spreadsheet.single('file'), restoreTenant, exchange.importPeople);

r.post('/faces/export', sensitiveLimiter, requirePermission('faces:export'), exchange.exportFaces);
r.post('/faces/import', sensitiveLimiter, requirePermission('faces:import'), facePackage.single('file'), restoreTenant, exchange.importFaces);
r.post('/faces/photos', sensitiveLimiter, requirePermission('faces:import'), photos.single('file'), restoreTenant, exchange.importFacePhotos);

export default r;
