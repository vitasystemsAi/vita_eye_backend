'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Lock, Mail, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button, Field, Input } from '@/components/ui/primitives';
import { api, ApiError } from '@/lib/api';

const schema = z.object({
  email: z.string().trim().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});
type FormValues = z.infer<typeof schema>;

export default function PlatformLoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  async function onSubmit(values: FormValues) {
    setError(null);
    try {
      await api.post('/platform/auth/login', values, { noRefresh: true });
      router.replace('/platform/clients');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'ACCOUNT_LOCKED') setError(err.message);
      else if (err instanceof ApiError && err.code === 'RATE_LIMITED') setError('Too many attempts. Please wait a few minutes and try again.');
      else if (err instanceof ApiError && err.status === 401) setError('Invalid email or password.');
      else setError(err instanceof Error ? err.message : 'Sign-in failed');
    }
  }

  return (
    <>
      <p className="inline-flex items-center gap-1.5 rounded-full bg-violet-500/15 px-2.5 py-0.5 text-[10px] font-semibold tracking-[0.14em] text-violet-300 uppercase ring-1 ring-violet-500/30">
        <ShieldCheck className="h-3 w-3" /> Platform admin
      </p>
      <h1 className="mt-3 text-lg font-semibold text-ink-100">VITA Systems platform console</h1>
      <p className="mt-1 text-sm text-ink-300">Register organizations, manage plans and client access.</p>
      <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4" noValidate>
        <Field label="Email" error={errors.email?.message} htmlFor="email">
          <div className="relative">
            <Mail className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-ink-400" />
            <Input id="email" type="email" autoComplete="username" className="pl-9" placeholder="info@vitasystems.ai" {...register('email')} />
          </div>
        </Field>
        <Field label="Password" error={errors.password?.message} htmlFor="password">
          <div className="relative">
            <Lock className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-ink-400" />
            <Input id="password" type="password" autoComplete="current-password" className="pl-9" {...register('password')} />
          </div>
        </Field>
        {error && (
          <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" loading={isSubmitting} icon={<ShieldCheck className="h-4 w-4" />}>
          Sign in to platform
        </Button>
        <div className="text-center">
          <Link href="/login" className="text-sm text-brand-400 hover:text-brand-300">
            Organization user? Sign in here
          </Link>
        </div>
      </form>
    </>
  );
}
