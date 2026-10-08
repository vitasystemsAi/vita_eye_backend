'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, Send } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button, Field, Input } from '@/components/ui/primitives';
import { api, errorMessage } from '@/lib/api';

const schema = z.object({ email: z.string().trim().email('Enter a valid email address') });
type FormValues = z.infer<typeof schema>;

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  async function onSubmit(values: FormValues) {
    setError(null);
    try {
      const { data } = await api.post<{ message: string }>('/auth/forgot-password', values, { noRefresh: true });
      setSent(data.message);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <>
      <h1 className="text-lg font-semibold text-ink-100">Reset your password</h1>
      <p className="mt-1 text-sm text-ink-300">We will email a single-use reset link that expires in 30 minutes.</p>
      {sent ? (
        <div className="mt-6 space-y-4">
          <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{sent}</p>
          <Link href="/login" className="inline-flex items-center gap-2 text-sm text-brand-400 hover:text-brand-300">
            <ArrowLeft className="h-4 w-4" /> Back to sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4" noValidate>
          <Field label="Account email" error={errors.email?.message} htmlFor="email">
            <Input id="email" type="email" autoComplete="email" {...register('email')} />
          </Field>
          {error && <p className="text-sm text-red-300">{error}</p>}
          <Button type="submit" className="w-full" loading={isSubmitting} icon={<Send className="h-4 w-4" />}>
            Send reset link
          </Button>
          <div className="text-center">
            <Link href="/login" className="text-sm text-brand-400 hover:text-brand-300">
              Back to sign in
            </Link>
          </div>
        </form>
      )}
    </>
  );
}
