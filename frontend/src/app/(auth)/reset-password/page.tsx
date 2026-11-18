'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { KeyRound } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button, Field, PasswordInput } from '@/components/ui/primitives';
import { api, errorMessage } from '@/lib/api';
import { passwordRule } from '@/lib/validation';

const schema = z
  .object({ password: passwordRule, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { message: 'Passwords do not match', path: ['confirm'] });
type FormValues = z.infer<typeof schema>;

function ResetForm() {
  const token = useSearchParams().get('token') ?? '';
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  if (!token) {
    return (
      <p className="text-sm text-ink-300">
        This reset link is incomplete. <Link href="/forgot-password" className="text-brand-400">Request a new one.</Link>
      </p>
    );
  }

  async function onSubmit(values: FormValues) {
    setError(null);
    try {
      const { data } = await api.post<{ message: string }>('/auth/reset-password', { token, password: values.password }, { noRefresh: true });
      setDone(data.message);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <>
      <h1 className="text-lg font-semibold text-ink-100">Choose a new password</h1>
      <p className="mt-1 text-sm text-ink-300">All existing sessions will be signed out.</p>
      {done ? (
        <div className="mt-6 space-y-4">
          <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{done}</p>
          <Link href="/login" className="text-sm text-brand-400 hover:text-brand-300">
            Continue to sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4" noValidate>
          <Field label="New password" error={errors.password?.message} hint="At least 12 characters with upper-case, lower-case and a digit." htmlFor="password">
            <PasswordInput id="password" autoComplete="new-password" {...register('password')} />
          </Field>
          <Field label="Confirm password" error={errors.confirm?.message} htmlFor="confirm">
            <PasswordInput id="confirm" autoComplete="new-password" {...register('confirm')} />
          </Field>
          {error && <p className="text-sm text-red-300">{error}</p>}
          <Button type="submit" className="w-full" loading={isSubmitting} icon={<KeyRound className="h-4 w-4" />}>
            Update password
          </Button>
        </form>
      )}
    </>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetForm />
    </Suspense>
  );
}
