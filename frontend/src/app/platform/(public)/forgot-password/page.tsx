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

export default function PlatformForgotPasswordPage() {
  const [sent, setSent] = useState<string | null>(null);
  const [devLink, setDevLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormValues>({ resolver: zodResolver(schema) });

  async function onSubmit(values: FormValues) {
    setError(null);
    try {
      const { data } = await api.post<{ message: string; devLink?: string }>('/platform/auth/forgot-password', values, { noRefresh: true });
      setSent(data.message);
      setDevLink(data.devLink ?? null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <>
      <h1 className="text-lg font-semibold text-ink-100">Reset platform password</h1>
      <p className="mt-1 text-sm text-ink-300">We email a single-use link that expires in 30 minutes. The current password is never shown.</p>
      {sent ? (
        <div className="mt-6 space-y-4">
          <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{sent}</p>
          {devLink && <p className="break-all rounded-lg border border-ink-700 px-3 py-2 text-xs text-ink-200">Development link: {devLink}</p>}
          <Link href="/login" className="inline-flex items-center gap-2 text-sm text-brand-400 hover:text-brand-300">
            <ArrowLeft className="h-4 w-4" /> Back to sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4" noValidate>
          <Field label="Platform email" error={errors.email?.message} htmlFor="email">
            <Input id="email" type="email" autoComplete="email" placeholder="info@vitasystems.ai" {...register('email')} />
          </Field>
          {error && <p className="text-sm text-red-300">{error}</p>}
          <Button type="submit" className="w-full" loading={isSubmitting} icon={<Send className="h-4 w-4" />}>Send reset link</Button>
          <div className="text-center">
            <Link href="/login" className="text-sm text-brand-400 hover:text-brand-300">Back to sign in</Link>
          </div>
        </form>
      )}
    </>
  );
}
