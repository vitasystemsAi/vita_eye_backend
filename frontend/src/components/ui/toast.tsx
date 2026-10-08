'use client';

import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { cn } from './cn';

type Tone = 'success' | 'error' | 'info' | 'warning';
interface Toast {
  id: number;
  tone: Tone;
  title: string;
  message?: string;
}

const ToastContext = createContext<{ notify: (tone: Tone, title: string, message?: string) => void } | null>(null);

const ICONS = { success: CheckCircle2, error: XCircle, info: Info, warning: AlertTriangle };
const TONES: Record<Tone, string> = {
  success: 'border-emerald-500/40 text-emerald-300',
  error: 'border-red-500/40 text-red-300',
  info: 'border-brand-500/40 text-brand-300',
  warning: 'border-amber-500/40 text-amber-300',
};

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const notify = useCallback(
    (tone: Tone, title: string, message?: string) => {
      const id = nextId++;
      setToasts((t) => [...t.slice(-4), { id, tone, title, message }]);
      setTimeout(() => dismiss(id), tone === 'error' ? 8000 : 5000);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ notify }}>
      {children}
      <div className="pointer-events-none fixed right-4 bottom-4 z-[100] flex w-96 max-w-[calc(100vw-2rem)] flex-col gap-2" aria-live="polite">
        {toasts.map((t) => {
          const Icon = ICONS[t.tone];
          return (
            <div key={t.id} role="status" className={cn('pointer-events-auto flex gap-3 rounded-lg border bg-ink-850/95 p-3 shadow-xl backdrop-blur', TONES[t.tone])}>
              <Icon className="mt-0.5 h-5 w-5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink-100">{t.title}</p>
                {t.message && <p className="mt-0.5 text-sm break-words text-ink-300">{t.message}</p>}
              </div>
              <button onClick={() => dismiss(t.id)} className="text-ink-400 hover:text-ink-100" aria-label="Dismiss">
                <X className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx.notify;
}
