'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Lock, LogIn, Mail } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button, Field, Input } from '@/components/ui/primitives';
import { api, ApiError } from '@/lib/api';

const schema = z.object({
  email: z.string().trim().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});
type FormValues = z.infer<typeof schema>;

function safeNext(next: string | null, fallback: string): string {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/login') ? next : fallback;
}

function signInError(err: unknown): string {
  if (err instanceof ApiError && (err.code === 'ACCOUNT_LOCKED' || err.code === 'ORGANIZATION_ON_HOLD' || err.code === 'ACCOUNT_DISABLED')) return err.message;
  if (err instanceof ApiError && err.code === 'RATE_LIMITED') return 'Too many attempts. Please wait a few minutes and try again.';
  if (err instanceof ApiError && err.status === 401) return 'Invalid email or password.';
  return err instanceof Error ? err.message : 'Sign-in failed';
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  async function onSubmit(values: FormValues) {
    setError(null);
    const next = params.get('next');
    try {
      await api.post('/auth/login', values, { noRefresh: true });
      router.replace(safeNext(next?.startsWith('/platform') ? null : next, '/dashboard'));
      return;
    } catch (err) {
      if (!(err instanceof ApiError) || err.status !== 401) {
        setError(signInError(err));
        return;
      }
    }
    try {
      await api.post('/platform/auth/login', values, { noRefresh: true });
      router.replace(safeNext(next?.startsWith('/platform') ? next : null, '/platform/dashboard'));
    } catch (err) {
      setError(signInError(err));
    }
  }

  return (
    <>
      <h1 className="text-lg font-semibold text-ink-100">Sign in to the security console</h1>
      <p className="mt-1 text-sm text-ink-300">Use the credentials issued by your administrator.</p>
      <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4" noValidate>
        <Field label="Email" error={errors.email?.message} htmlFor="email">
          <div className="relative">
            <Mail className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-ink-400" />
            <Input id="email" type="email" autoComplete="username" className="pl-9" placeholder="you@organization.com" {...register('email')} />
          </div>
        </Field>
        <Field label="Password" error={errors.password?.message} htmlFor="password">
          <div className="relative">
            <Lock className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-ink-400" />
            <Input id="password" type="password" autoComplete="current-password" className="pl-9" {...register('password')} />
          </div>
        </Field>
        {error && <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200" role="alert">{error}</p>}
        <Button type="submit" className="w-full" loading={isSubmitting} icon={<LogIn className="h-4 w-4" />}>
          Sign in
        </Button>
        <Link href="/forgot-password" className="inline-block text-sm text-brand-400 hover:text-brand-300">
          Forgot your password?
        </Link>
      </form>
    </>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
