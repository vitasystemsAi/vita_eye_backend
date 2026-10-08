import fs from 'node:fs';
import path from 'node:path';
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { UserDevice } from '../models';

let app: App | null = null;
let initError: string | null = null;

function init(): App | null {
  if (app || initError) return app;
  if (!env.FCM_ENABLED) {
    initError = 'FCM disabled (FCM_ENABLED=false)';
    return null;
  }
  try {
    const p = path.isAbsolute(env.FIREBASE_SERVICE_ACCOUNT_PATH)
      ? env.FIREBASE_SERVICE_ACCOUNT_PATH
      : path.resolve(env.rootDir, env.FIREBASE_SERVICE_ACCOUNT_PATH);
    const account = JSON.parse(fs.readFileSync(p, 'utf8'));
    app = getApps()[0] ?? initializeApp({ credential: cert(account) });
  } catch (err) {
    initError = `FCM initialisation failed: ${(err as Error).message}`;
    logger.error(initError);
  }
  return app;
}

export function pushConfigured(): boolean {
  return Boolean(init());
}

export function pushUnavailableReason(): string | null {
  init();
  return app ? null : initError;
}

const PERMANENT_TOKEN_ERRORS = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

/**
 * Sends a push message to every registered device of a user. Returns number of successful
 * deliveries; throws when nothing could be delivered due to transient errors (so the job retries).
 */
export async function sendPushToUser(userId: string, title: string, body: string, data: Record<string, string>): Promise<number> {
  const a = init();
  if (!a) throw new Error(initError ?? 'FCM not configured');
  const devices = await UserDevice.findAll({ where: { userId } });
  if (!devices.length) return 0;

  const res = await getMessaging(a).sendEachForMulticast({
    tokens: devices.map((d) => d.fcmToken),
    notification: { title, body },
    data,
    webpush: { fcmOptions: { link: data.link }, notification: { requireInteraction: true } },
  });

  const stale: string[] = [];
  let transientError: string | null = null;
  res.responses.forEach((r, i) => {
    if (r.success) return;
    const code = r.error?.code ?? '';
    if (PERMANENT_TOKEN_ERRORS.has(code)) stale.push(devices[i].id);
    else transientError = r.error?.message ?? code;
  });
  if (stale.length) await UserDevice.destroy({ where: { id: stale } });
  if (res.successCount === 0 && transientError) throw new Error(transientError);
  return res.successCount;
}
