import { z } from 'zod';
import { paginationSchema } from '../utils/http';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm');

export const scheduleSchema = z.object({
  enabled: z.boolean(),
  days: z.array(z.number().int().min(0).max(6)).max(7),
  start: hhmm,
  end: hhmm,
  timezone: z
    .string()
    .max(64)
    .refine((tz) => {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, 'Unknown time zone'),
});

const base = {
  cameraName: z.string().trim().min(2).max(120),
  location: z.string().trim().min(2).max(160),
  site: z.string().trim().max(120).optional().nullable(),
  streamUrl: z.string().trim().max(512).optional().nullable(),
  username: z.string().max(128).optional().nullable(),
  password: z.string().max(256).optional().nullable(),
  schedule: scheduleSchema.optional().nullable(),
  samplingFps: z.number().min(0.2).max(15).optional(),
};

const cameraTypes = ['BROWSER', 'RTSP', 'ONVIF', 'HTTP_MJPEG', 'USB', 'LAN', 'LAN_PORT'] as const;

export const createCameraSchema = z
  .object({ ...base, cameraType: z.enum(cameraTypes) })
  .refine((c) => c.cameraType === 'BROWSER' || c.cameraType === 'USB' || !!c.streamUrl, {
    message: 'streamUrl is required for network cameras',
    path: ['streamUrl'],
  });

export const updateCameraSchema = z
  .object({
    ...base,
    cameraName: base.cameraName.optional(),
    location: base.location.optional(),
    isActive: z.boolean().optional(),
    clearCredentials: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No changes supplied' });

export const testDraftSchema = z.object({
  cameraId: z.string().uuid().optional(),
  cameraType: z.enum(['RTSP', 'ONVIF', 'HTTP_MJPEG', 'LAN', 'LAN_PORT']),
  streamUrl: z.string().trim().min(1).max(512),
  username: z.string().max(128).optional().nullable(),
  password: z.string().max(256).optional().nullable(),
  clearCredentials: z.boolean().optional(),
});

export const previewProbeSchema = testDraftSchema.extend({
  path: z
    .string()
    .trim()
    .max(200)
    .refine((value) => value.startsWith('/') && !value.startsWith('//') && !value.includes('@') && !value.includes('\\') && !value.includes('://'), 'Path must start with /')
    .optional(),
  secure: z.boolean().optional(),
});

export const previewSessionSchema = z.object({
  sessionId: z.string().regex(/^[A-Za-z0-9_-]{16,80}$/),
});

export const listCamerasSchema = paginationSchema.extend({
  pageSize: z.coerce.number().int().min(1).max(200).default(100),
  site: z.string().trim().max(120).optional(),
  location: z.string().trim().max(160).optional(),
  status: z.enum(['ONLINE', 'OFFLINE', 'ERROR', 'DISABLED']).optional(),
  type: z.enum(cameraTypes).optional(),
  search: z.string().trim().max(100).optional(),
});

const ipv4 = z.string().trim().regex(/^(?:\d{1,3}\.){3}\d{1,3}$/, 'Enter a camera IP address');

/** CP Plus auto-detect: the login from the camera website, and the addresses the search returned. */
export const cpPlusSchema = z.object({
  location: z.string().trim().min(2).max(160),
  site: z.string().trim().max(120).optional().nullable(),
  samplingFps: z.number().min(0.2).max(15).optional(),
  username: z.string().trim().min(1).max(128),
  password: z.string().min(1).max(256),
  ips: z.array(ipv4).min(1).max(24),
});
