import { z } from 'zod';
import { ROLE_NAMES } from './rbac';

export const recognitionSchema = z
  .object({
    knownThreshold: z.number().min(0).max(1),
    unknownThreshold: z.number().min(0).max(1),
    matchMargin: z.number().min(0).max(0.5),
    minFaceSize: z.number().int().min(20).max(1000),
    minQuality: z.number().min(0).max(1),
    minDetectionScore: z.number().min(0.3).max(1),
    temporalMinFrames: z.number().int().min(1).max(30),
    temporalWindowSec: z.number().int().min(1).max(120),
    temporalAgreement: z.number().min(0.5).max(1),
  })
  .refine((r) => r.unknownThreshold <= r.knownThreshold, {
    message: 'unknownThreshold must be less than or equal to knownThreshold',
    path: ['unknownThreshold'],
  });

export const settingsSchema = z.object({
  recognition: recognitionSchema,
  events: z.object({
    knownCooldownSec: z.number().int().min(0).max(86400),
    unknownCooldownSec: z.number().int().min(0).max(86400),
    captureEvidence: z.boolean(),
    recordKnownEvents: z.boolean(),
  }),
  notifications: z.object({
    unknownAlerts: z.boolean(),
    uncertainAlerts: z.boolean(),
    channels: z.object({ inApp: z.boolean(), email: z.boolean(), push: z.boolean() }),
    recipientRoles: z.array(z.enum(ROLE_NAMES)).min(1),
    alertCooldownSec: z.number().int().min(0).max(86400),
  }),
  retention: z.object({
    evidenceDays: z.number().int().min(1).max(3650),
    eventDays: z.number().int().min(1).max(3650),
    notificationDays: z.number().int().min(1).max(3650),
    auditDays: z.number().int().min(30).max(3650),
    deletedPersonPurgeDays: z.number().int().min(0).max(365),
  }),
});

export type AppSettings = z.infer<typeof settingsSchema>;

/**
 * Starting values for OpenCV SFace embeddings (cosine similarity). OpenCV documents 0.363 as the
 * LFW same-identity threshold; these defaults are deliberately stricter and MUST be calibrated
 * per deployment (see docs/AI_CALIBRATION.md).
 */
export const DEFAULT_SETTINGS: AppSettings = {
  recognition: {
    knownThreshold: 0.42,
    unknownThreshold: 0.28,
    matchMargin: 0.05,
    minFaceSize: 64,
    minQuality: 0.5,
    minDetectionScore: 0.85,
    temporalMinFrames: 3,
    temporalWindowSec: 10,
    temporalAgreement: 0.7,
  },
  events: {
    knownCooldownSec: 300,
    unknownCooldownSec: 120,
    captureEvidence: true,
    recordKnownEvents: false,
  },
  notifications: {
    unknownAlerts: true,
    uncertainAlerts: false,
    channels: { inApp: true, email: true, push: true },
    recipientRoles: ['SUPER_ADMIN', 'SECURITY_ADMIN', 'SECURITY_OPERATOR'],
    alertCooldownSec: 60,
  },
  retention: {
    evidenceDays: 30,
    eventDays: 365,
    notificationDays: 90,
    auditDays: 730,
    deletedPersonPurgeDays: 30,
  },
};
