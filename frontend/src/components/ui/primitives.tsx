'use client';

import { ChevronLeft, ChevronRight, Loader2, X } from 'lucide-react';
import {
  cloneElement,
  forwardRef,
  isValidElement,
  useEffect,
  useId,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import type { PageMeta } from '@/lib/types';
import { cn } from './cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'warning';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-500 shadow-sm shadow-brand-900/40',
  secondary: 'border border-ink-600 bg-ink-800 text-ink-100 hover:bg-ink-700',
  ghost: 'text-ink-200 hover:bg-ink-800 hover:text-ink-100',
  danger: 'bg-red-600/90 text-white hover:bg-red-500',
  warning: 'bg-amber-500/90 text-ink-950 hover:bg-amber-400',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md';
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, icon, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap transition focus-visible:ring-2 focus-visible:ring-brand-400/60 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'h-8 px-3 text-xs' : 'h-10 px-4 text-sm',
        VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  );
});

export function Card({ className, children, title, actions, description }: { className?: string; children: ReactNode; title?: ReactNode; actions?: ReactNode; description?: ReactNode }) {
  return (
    <section className={cn('card', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-ink-700/70 px-5 py-4">
          <div>
            {title && <h2 className="text-sm font-semibold text-ink-100">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-ink-300">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

type Tone = 'neutral' | 'blue' | 'green' | 'amber' | 'red' | 'violet';
const TONES: Record<Tone, string> = {
  neutral: 'bg-ink-700/60 text-ink-200 ring-ink-500/40',
  blue: 'bg-brand-500/15 text-brand-300 ring-brand-500/30',
  green: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
  amber: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
  red: 'bg-red-500/15 text-red-300 ring-red-500/30',
  violet: 'bg-violet-500/15 text-violet-300 ring-violet-500/30',
};

export function Badge({ tone = 'neutral', children, className, dot }: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset', TONES[tone], className)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export function Field({ label, error, hint, children, htmlFor }: { label: string; error?: string; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  const autoId = useId();
  const messageId = `${autoId}-msg`;
  const message = error ? (
    <p id={messageId} className="mt-1 text-xs text-red-400">
      {error}
    </p>
  ) : hint ? (
    <p id={messageId} className="mt-1 text-xs text-ink-400">
      {hint}
    </p>
  ) : null;

  let control = children;
  let controlId = htmlFor;
  if (!controlId && isValidElement<{ id?: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }>(children)) {
    controlId = children.props.id ?? autoId;
    control = cloneElement(children, {
      id: controlId,
      'aria-describedby': message ? messageId : children.props['aria-describedby'],
      'aria-invalid': error ? true : children.props['aria-invalid'],
    });
  }

  if (controlId) {
    return (
      <div>
        <label className="label" htmlFor={controlId}>
          {label}
        </label>
        {control}
        {message}
      </div>
    );
  }
  return (
    <div>
      <label className="block">
        <span className="label">{label}</span>
        {children}
      </label>
      {message}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cn('input', className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return (
    <select ref={ref} className={cn('input appearance-none bg-[length:16px] bg-[right_0.6rem_center] bg-no-repeat pr-8', className)} style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%238b98b6' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }} {...rest}>
      {children}
    </select>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cn('input min-h-[88px] resize-y', className)} {...rest} />;
});

export function Switch({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: ReactNode; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <div>
        <label htmlFor={id} className="text-sm font-medium text-ink-100">
          {label}
        </label>
        {description && <p className="text-xs text-ink-300">{description}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn('relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:opacity-50', checked ? 'bg-brand-600' : 'bg-ink-600')}
      >
        <span className={cn('inline-block h-5 w-5 transform rounded-full bg-white shadow transition', checked ? 'translate-x-5' : 'translate-x-0.5')} />
      </button>
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('h-5 w-5 animate-spin text-brand-400', className)} />;
}

export function LoadingBlock({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-sm text-ink-300">
      <Spinner /> {label}
    </div>
  );
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {icon && <div className="mb-3 rounded-full bg-ink-800 p-3 text-ink-300">{icon}</div>}
      <p className="text-sm font-medium text-ink-100">{title}</p>
      {description && <p className="mt-1 max-w-md text-sm text-ink-300">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorBanner({ error, onRetry }: { error: { message: string } | null; onRetry?: () => void }) {
  if (!error) return null;
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
      <span>{error.message}</span>
      {onRetry && (
        <Button size="sm" variant="secondary" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer, size = 'md' }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  const widths = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' };
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm sm:items-center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" className={cn('card my-8 w-full bg-ink-900', widths[size])}>
        <div className="flex items-center justify-between border-b border-ink-700/70 px-5 py-4">
          <h2 className="text-base font-semibold text-ink-100">{title}</h2>
          <button onClick={onClose} className="rounded p-1 text-ink-300 hover:bg-ink-800 hover:text-ink-100" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-ink-700/70 px-5 py-4">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  tone = 'danger',
  loading,
  onConfirm,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  tone?: 'danger' | 'primary' | 'warning';
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  children?: ReactNode;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button variant={tone} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm text-ink-200">{message}</div>
      {children}
    </Modal>
  );
}

export function Pagination({ meta, onPage }: { meta?: PageMeta; onPage: (p: number) => void }) {
  if (!meta || meta.total === 0) return null;
  const from = (meta.page - 1) * meta.pageSize + 1;
  const to = Math.min(meta.total, meta.page * meta.pageSize);
  return (
    <div className="flex items-center justify-between border-t border-ink-700/70 px-4 py-3 text-xs text-ink-300">
      <span>
        {from}–{to} of {meta.total.toLocaleString()}
      </span>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="secondary" disabled={meta.page <= 1} onClick={() => onPage(meta.page - 1)} icon={<ChevronLeft className="h-4 w-4" />}>
          Prev
        </Button>
        <span>
          Page {meta.page} / {meta.totalPages}
        </span>
        <Button size="sm" variant="secondary" disabled={meta.page >= meta.totalPages} onClick={() => onPage(meta.page + 1)}>
          Next <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: Array<{ value: T; label: ReactNode; hidden?: boolean }> }) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-ink-700/70" role="tablist">
      {tabs
        .filter((t) => !t.hidden)
        .map((t) => (
          <button
            key={t.value}
            role="tab"
            aria-selected={value === t.value}
            onClick={() => onChange(t.value)}
            className={cn(
              '-mb-px border-b-2 px-4 py-2.5 text-sm font-medium whitespace-nowrap transition',
              value === t.value ? 'border-brand-500 text-ink-100' : 'border-transparent text-ink-300 hover:text-ink-100',
            )}
          >
            {t.label}
          </button>
        ))}
    </div>
  );
}

export function PageHeader({ title, description, actions, icon }: { title: string; description?: ReactNode; actions?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="flex items-start gap-3">
        {icon && <div className="mt-0.5 rounded-lg bg-brand-500/10 p-2 text-brand-400 ring-1 ring-brand-500/20">{icon}</div>}
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink-100">{title}</h1>
          {description && <p className="mt-1 text-sm text-ink-300">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({ label, value, icon, tone = 'blue', sub, href }: { label: string; value: ReactNode; icon: ReactNode; tone?: 'blue' | 'green' | 'amber' | 'red' | 'neutral'; sub?: ReactNode; href?: string }) {
  const ring = { blue: 'text-brand-400 bg-brand-500/10', green: 'text-emerald-400 bg-emerald-500/10', amber: 'text-amber-400 bg-amber-500/10', red: 'text-red-400 bg-red-500/10', neutral: 'text-ink-200 bg-ink-700/50' }[tone];
  const body = (
    <div className="card flex h-full items-start gap-4 p-5 transition hover:border-ink-600">
      <div className={cn('rounded-lg p-2.5', ring)}>{icon}</div>
      <div className="min-w-0">
        <p className="text-xs font-medium tracking-wide text-ink-300 uppercase">{label}</p>
        <p className="mt-1 text-2xl font-semibold text-ink-100 tabular-nums">{value}</p>
        {sub && <p className="mt-0.5 text-xs text-ink-400">{sub}</p>}
      </div>
    </div>
  );
  return href ? (
    <a href={href} className="block">
      {body}
    </a>
  ) : (
    body
  );
}

export function KeyValue({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt className="text-xs tracking-wide text-ink-400 uppercase">{k}</dt>
          <dd className="mt-0.5 text-sm break-words text-ink-100">{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}
