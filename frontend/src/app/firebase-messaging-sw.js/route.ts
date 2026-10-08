// Generates the FCM service worker with the deployment's public Firebase web config.
const SDK_VERSION = '12.19.0';

export const dynamic = 'force-dynamic';

export function GET() {
  const config = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? '',
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? '',
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? '',
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? '',
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? '',
  };
  const body = config.apiKey
    ? `importScripts('https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-messaging-compat.js');
firebase.initializeApp(${JSON.stringify(config)});
const messaging = firebase.messaging();
messaging.onBackgroundMessage((payload) => {
  const n = payload.notification || {};
  self.registration.showNotification(n.title || 'VITA EYE alert', {
    body: n.body || '',
    icon: '/icon-192.png',
    tag: (payload.data && payload.data.eventId) || undefined,
    data: payload.data || {},
  });
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const id = event.notification.data && event.notification.data.eventId;
  event.waitUntil(clients.openWindow(id ? '/events/' + id : '/alerts'));
});
`
    : `// Web push is not configured for this deployment.\n`;
  return new Response(body, {
    headers: { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-cache', 'Service-Worker-Allowed': '/' },
  });
}
