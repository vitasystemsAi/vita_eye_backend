'use client';

import { api } from './api';

export const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? '',
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? '',
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? '',
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? '',
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? '',
};
const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY ?? '';

export function pushClientConfigured(): boolean {
  return Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.messagingSenderId && firebaseConfig.appId && vapidKey);
}

/** Why push cannot be enabled on this device, or null if it can. */
export function pushUnsupportedReason(): string | null {
  if (!pushClientConfigured()) return 'Web push is not configured for this deployment (NEXT_PUBLIC_FIREBASE_* variables).';
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('Notification' in window)) return 'This browser does not support web push.';
  if (!window.isSecureContext) return 'Web push requires HTTPS.';
  return null;
}

/** Requests permission, obtains an FCM registration token and registers it with the backend. */
export async function enablePush(): Promise<void> {
  const reason = pushUnsupportedReason();
  if (reason) throw new Error(reason);
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notification permission was not granted.');
  const [{ initializeApp, getApps }, { getMessaging, getToken, isSupported }] = await Promise.all([import('firebase/app'), import('firebase/messaging')]);
  if (!(await isSupported())) throw new Error('Firebase messaging is not supported in this browser.');
  const app = getApps()[0] ?? initializeApp(firebaseConfig);
  const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
  const token = await getToken(getMessaging(app), { vapidKey, serviceWorkerRegistration: registration });
  if (!token) throw new Error('Could not obtain a push token.');
  await api.post('/notifications/devices', { token });
}
