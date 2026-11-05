'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button, Field, Input, Select } from '@/components/ui/primitives';
import { ApiError } from '@/lib/api';
import { referenceIdRule } from '@/lib/validation';

const personSchema = z.object({
  personName: z.string().trim().min(1, 'Name is required').max(160),
  referenceId: referenceIdRule,
  department: z.string().trim().max(120),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'INACTIVE']),
});

const tenantSchema = z.object({
  personName: z.string().trim().min(1, 'Name is required').max(160),
  referenceId: z
    .string()
    .trim()
    .min(1, 'Mobile number is required')
    .max(20)
    .regex(/^\d{10}$/, 'Enter a 10-digit mobile number'),
  department: z.string().trim().min(1, 'Room number is required').max(40),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'INACTIVE']),
});

export type PersonFormValues = z.infer<typeof personSchema>;

export function PersonForm({ variant = 'person', initial, submitLabel, onSubmit, onCancel }: { variant?: 'person' | 'tenant'; initial?: Partial<PersonFormValues>; submitLabel: string; onSubmit: (v: PersonFormValues) => Promise<void>; onCancel?: () => void }) {
  const tenant = variant === 'tenant';
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<PersonFormValues>({
    resolver: zodResolver(tenant ? tenantSchema : personSchema),
    defaultValues: { personName: '', referenceId: '', department: '', status: 'ACTIVE', ...initial },
  });
  const mobileField = tenant ? register('referenceId') : null;

  async function submit(v: PersonFormValues) {
    const payload: PersonFormValues = tenant
      ? { ...v, referenceId: v.referenceId.replace(/\D/g, '').slice(0, 10), department: v.department.trim() }
      : v;
    try {
      await onSubmit(payload);
    } catch (err) {
      if (err instanceof ApiError) {
        const fields = err.fieldErrors();
        for (const [k, m] of Object.entries(fields)) setError(k as keyof PersonFormValues, { message: m });
        if (err.status === 409 && !/capacity/i.test(err.message)) setError('referenceId', { message: tenant ? 'This mobile number is already registered' : 'This reference ID is already registered' });
        else if (!Object.keys(fields).length) setError('root', { message: err.message });
      } else setError('root', { message: 'Save failed' });
    }
  }

  return (
    <form onSubmit={handleSubmit(submit)} className="space-y-4" noValidate>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label={tenant ? 'Name' : 'Full name'} error={errors.personName?.message}>
          <Input autoComplete="name" {...register('personName')} />
        </Field>
        {tenant && mobileField ? (
          <>
            <Field label="Mobile number" error={errors.referenceId?.message} hint="10 digits only.">
              <Input
                autoComplete="tel"
                inputMode="numeric"
                maxLength={10}
                pattern="[0-9]{10}"
                className="max-w-[11rem] font-mono tracking-wider"
                {...mobileField}
                onChange={(event) => {
                  event.target.value = event.target.value.replace(/\D/g, '').slice(0, 10);
                  void mobileField.onChange(event);
                }}
              />
            </Field>
            <Field label="Room number" error={errors.department?.message}>
              <Input autoComplete="off" {...register('department')} />
            </Field>
          </>
        ) : (
          <>
            <Field label="Reference ID" error={errors.referenceId?.message} hint="Employee / visitor / badge number (unique)">
              <Input autoComplete="off" className="font-mono" {...register('referenceId')} />
            </Field>
            <Field label="Department" error={errors.department?.message}>
              <Input autoComplete="off" {...register('department')} />
            </Field>
            <Field label="Status" error={errors.status?.message}>
              <Select {...register('status')}>
                <option value="ACTIVE">Active — included in recognition</option>
                <option value="SUSPENDED">Suspended — paused, can be made active again</option>
                <option value="INACTIVE">Inactive — held out of recognition, retrievable</option>
              </Select>
            </Field>
          </>
        )}
      </div>
      {errors.root && <p className="text-sm text-red-300">{errors.root.message}</p>}
      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" loading={isSubmitting}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
