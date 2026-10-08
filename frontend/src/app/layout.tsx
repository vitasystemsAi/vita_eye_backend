import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { MonitorIndicator } from '@/components/monitoring/MonitorIndicator';
import { ToastProvider } from '@/components/ui/toast';
import { MonitorProvider } from '@/lib/monitor';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'VITA EYE', template: '%s · VITA EYE' },
  description: 'VITA EYE — Intelligent Vision. Smarter Security.',
  robots: { index: false, follow: false },
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/icon-192.png', type: 'image/png', sizes: '192x192' },
      { url: '/icon-512.png', type: 'image/png', sizes: '512x512' },
    ],
    apple: '/apple-touch-icon.png',
  },
};

export const viewport: Viewport = { themeColor: '#05080f' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ToastProvider>
          <MonitorProvider>
            {children}
            <MonitorIndicator />
          </MonitorProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
