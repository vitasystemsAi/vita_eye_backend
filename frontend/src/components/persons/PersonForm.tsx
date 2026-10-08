'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button, Field, Input, Select } from '@/components/ui/primitives';
import { ApiError } from '@/lib/api';
import { referenceIdRule } from '@/lib/validation';

const schema = z.object({
  personName: z.string().trim().min(1, 'Name is required').max(160),
  referenceId: referenceIdRule,
  department: z.string().trim().max(120),
  status: z.enum(['ACTIVE', 'INACTIVE']),
});
export type PersonFormValues = z.infer<typeof schema>;

export function PersonForm({ initial, submitLabel, onSubmit, onCancel }: { initial?: Partial<PersonFormValues>; submitLabel: string; onSubmit: (v: PersonFormValues) => Promise<void>; onCancel?: () => void }) {
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<PersonFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { personName: '', referenceId: '', department: '', status: 'ACTIVE', ...initial },
  });

  async function submit(v: PersonFormValues) {
    try {
      await onSubmit(v);
    } catch (err) {
      if (err instanceof ApiError) {
        const fields = err.fieldErrors();
        for (const [k, m] of Object.entries(fields)) setError(k as keyof PersonFormValues, { message: m });
        if (err.status === 409) setError('referenceId', { message: 'This reference ID is already registered' });
        else if (!Object.keys(fields).length) setError('root', { message: err.message });
      } else setError('root', { message: 'Save failed' });
    }
  }

  return (
    <form onSubmit={handleSubmit(submit)} className="space-y-4" noValidate>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label="Full name" error={errors.personName?.message}>
          <Input autoComplete="off" {...register('personName')} />
        </Field>
        <Field label="Reference ID" error={errors.referenceId?.message} hint="Employee / visitor / badge number (unique)">
          <Input autoComplete="off" className="font-mono" {...register('referenceId')} />
        </Field>
        <Field label="Department" error={errors.department?.message}>
          <Input autoComplete="off" {...register('department')} />
        </Field>
        <Field label="Status" error={errors.status?.message}>
          <Select {...register('status')}>
            <option value="ACTIVE">Active — included in recognition</option>
            <option value="INACTIVE">Inactive — excluded from recognition</option>
          </Select>
        </Field>
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
