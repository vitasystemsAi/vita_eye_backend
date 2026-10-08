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

function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard';
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
    try {
      await api.post('/auth/login', values, { noRefresh: true });
      router.replace(safeNext(params.get('next')));
    } catch (err) {
      if (err instanceof ApiError && (err.code === 'ACCOUNT_LOCKED' || err.code === 'ORGANIZATION_ON_HOLD' || err.code === 'ACCOUNT_DISABLED')) setError(err.message);
      else if (err instanceof ApiError && err.code === 'RATE_LIMITED') setError('Too many attempts. Please wait a few minutes and try again.');
      else if (err instanceof ApiError && err.status === 401) setError('Invalid email or password.');
      else setError(err instanceof Error ? err.message : 'Sign-in failed');
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
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <Link href="/forgot-password" className="text-brand-400 hover:text-brand-300">
            Forgot your password?
          </Link>
          <Link href="/platform/login" className="text-ink-400 hover:text-ink-200">
            VITA Systems platform admin
          </Link>
        </div>
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
