'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Check, Lock, Pencil, UserPlus, Users } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { RequirePermission } from '@/components/RequirePermission';
import { Badge, Button, Card, EmptyState, ErrorBanner, Field, Input, LoadingBlock, Modal, PageHeader, Pagination, PasswordInput, Select, Tabs } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDateTime, fmtRelative, ROLE_LABELS } from '@/lib/format';
import { useApi, useDebounced } from '@/lib/hooks';
import type { ManagedUser, RoleName } from '@/lib/types';
import { passwordRule } from '@/lib/validation';

const ROLE_OPTIONS: RoleName[] = ['SUPER_ADMIN', 'SECURITY_ADMIN', 'SECURITY_OPERATOR', 'AUDITOR', 'PREVIEW'];

const baseSchema = {
  name: z.string().trim().min(2, 'At least 2 characters').max(120),
  role: z.enum(['SUPER_ADMIN', 'SECURITY_ADMIN', 'SECURITY_OPERATOR', 'AUDITOR', 'PREVIEW']),
  siteScope: z.string().max(2000),
};
const createSchema = z.object({ ...baseSchema, email: z.string().trim().email('Enter a valid email'), password: passwordRule });
const editSchema = z.object({ ...baseSchema, status: z.enum(['ACTIVE', 'DISABLED']), password: z.union([z.literal(''), passwordRule]) });
type CreateValues = z.infer<typeof createSchema>;
type EditValues = z.infer<typeof editSchema>;

const parseSites = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

function UserForm({ user, onDone, onCancel }: { user?: ManagedUser; onDone: () => void; onCancel: () => void }) {
  const { user: me } = useAuth();
  const notify = useToast();
  const allowedRoles = me?.role === 'SUPER_ADMIN' ? ROLE_OPTIONS : ROLE_OPTIONS.filter((r) => r !== 'SUPER_ADMIN');
  const isEdit = Boolean(user);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<CreateValues & EditValues>({
    resolver: zodResolver((isEdit ? editSchema : createSchema) as never),
    defaultValues: {
      name: user?.name ?? '',
      email: user?.email ?? '',
      role: (user?.role ?? 'SECURITY_OPERATOR') as RoleName,
      status: user?.status ?? 'ACTIVE',
      siteScope: user?.siteScope?.join(', ') ?? '',
      password: '',
    },
  });

  async function submit(v: CreateValues & EditValues) {
    try {
      if (user) {
        await api.patch(`/users/${user.id}`, {
          name: v.name,
          role: v.role,
          status: v.status,
          siteScope: parseSites(v.siteScope).length ? parseSites(v.siteScope) : null,
          ...(v.password ? { password: v.password } : {}),
        });
        notify('success', 'User updated', v.password || v.status === 'DISABLED' ? 'Existing sessions for this user were revoked.' : undefined);
      } else {
        await api.post('/users', { name: v.name, email: v.email, password: v.password, role: v.role, siteScope: parseSites(v.siteScope).length ? parseSites(v.siteScope) : null });
        notify('success', 'User created', `${v.email} can now sign in.`);
      }
      onDone();
    } catch (err) {
      if (err instanceof ApiError) {
        const f = err.fieldErrors();
        for (const [k, m] of Object.entries(f)) setError(k as keyof EditValues, { message: m });
        if (err.status === 409) setError('email', { message: 'A user with this email already exists' });
        else if (!Object.keys(f).length) setError('root', { message: err.message });
      }
    }
  }

  const self = user?.id === me?.id;
  return (
    <form onSubmit={handleSubmit(submit)} className="space-y-4" noValidate>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label="Full name" error={errors.name?.message}>
          <Input {...register('name')} />
        </Field>
        <Field label="Email" error={errors.email?.message}>
          <Input type="email" {...register('email')} disabled={isEdit} autoComplete="off" />
        </Field>
        <Field label="Role" error={errors.role?.message} hint={self ? 'You cannot change your own role' : undefined}>
          <Select {...register('role')} disabled={self || (user?.role === 'SUPER_ADMIN' && me?.role !== 'SUPER_ADMIN')}>
            {(user?.role && !allowedRoles.includes(user.role) ? [user.role, ...allowedRoles] : allowedRoles).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </Select>
        </Field>
        {isEdit && (
          <Field label="Status" error={errors.status?.message}>
            <Select {...register('status')} disabled={self}>
              <option value="ACTIVE">Active</option>
              <option value="DISABLED">Disabled</option>
            </Select>
          </Field>
        )}
        <Field label="Site scope" error={errors.siteScope?.message} hint="Comma-separated sites. Leave empty for all sites.">
          <Input {...register('siteScope')} placeholder="HQ, Warehouse" />
        </Field>
        <Field label={isEdit ? 'Reset password (optional)' : 'Initial password'} error={errors.password?.message} hint="12+ characters with upper-case, lower-case and a digit">
          <PasswordInput {...register('password')} autoComplete="new-password" />
        </Field>
      </div>
      {errors.root && <p className="text-sm text-red-300">{errors.root.message}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={isSubmitting}>
          {isEdit ? 'Save changes' : 'Create user'}
        </Button>
      </div>
    </form>
  );
}

function UsersTab() {
  const { can } = useAuth();
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const q = useDebounced(search);
  const { data, meta, loading, error, reload } = useApi<ManagedUser[]>('/users', { search: q, role, status, page, pageSize: 25 });
  const [editing, setEditing] = useState<ManagedUser | 'new' | null>(null);

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 border-b border-ink-700/70 p-4">
        <Input placeholder="Search name or email" className="max-w-xs" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        <Select className="w-48" value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }} aria-label="Role">
          <option value="">All roles</option>
          {ROLE_OPTIONS.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </Select>
        <Select className="w-36" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status">
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="DISABLED">Disabled</option>
        </Select>
        <div className="flex-1" />
        {can('users:manage') && (
          <Button icon={<UserPlus className="h-4 w-4" />} onClick={() => setEditing('new')}>
            Add user
          </Button>
        )}
      </div>
      <div className="px-4 pt-4 empty:hidden">{error && <ErrorBanner error={error} onRetry={reload} />}</div>
      {loading && !data ? (
        <LoadingBlock />
      ) : !data?.length ? (
        <EmptyState icon={<Users className="h-6 w-6" />} title="No users found" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-ink-700/70">
              <tr>
                <th className="table-head">User</th>
                <th className="table-head">Role</th>
                <th className="table-head">Status</th>
                <th className="table-head">Sites</th>
                <th className="table-head">Last sign-in</th>
                <th className="table-head">Created</th>
                <th className="table-head sr-only">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-800">
              {data.map((u) => (
                <tr key={u.id} className="hover:bg-ink-800/40">
                  <td className="table-cell">
                    <p className="font-medium">{u.name}</p>
                    <p className="text-xs text-ink-400">{u.email}</p>
                  </td>
                  <td className="table-cell">
                    <Badge tone={u.role === 'SUPER_ADMIN' ? 'violet' : u.role === 'SECURITY_ADMIN' ? 'blue' : 'neutral'}>{u.role ? ROLE_LABELS[u.role] : '—'}</Badge>
                  </td>
                  <td className="table-cell">
                    <Badge tone={u.status === 'ACTIVE' ? 'green' : 'neutral'}>{u.status === 'ACTIVE' ? 'Active' : 'Disabled'}</Badge>
                    {u.lockedUntil && (
                      <Badge tone="amber" className="ml-1">
                        <Lock className="h-3 w-3" /> Locked
                      </Badge>
                    )}
                  </td>
                  <td className="table-cell text-xs text-ink-300">{u.siteScope?.join(', ') || 'All sites'}</td>
                  <td className="table-cell text-ink-300" title={fmtDateTime(u.lastLoginAt)}>
                    {u.lastLoginAt ? fmtRelative(u.lastLoginAt) : 'Never'}
                  </td>
                  <td className="table-cell text-ink-300">{fmtDateTime(u.createdAt)}</td>
                  <td className="table-cell text-right">
                    {can('users:manage') && (
                      <Button size="sm" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEditing(u)}>
                        Edit
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination meta={meta} onPage={setPage} />
      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'Add user' : 'Edit user'} size="lg">
        {editing !== null && (
          <UserForm
            user={editing === 'new' ? undefined : editing}
            onCancel={() => setEditing(null)}
            onDone={() => {
              setEditing(null);
              void reload();
            }}
          />
        )}
      </Modal>
    </>
  );
}

function RolesTab() {
  const { data, loading, error, reload } = useApi<{ roles: Array<{ id: number; name: RoleName; permissions: string[] }>; permissions: Array<{ name: string; description: string }> }>('/roles');
  if (loading && !data) return <LoadingBlock />;
  if (!data) return <div className="p-4"><ErrorBanner error={error} onRetry={reload} /></div>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead className="border-b border-ink-700/70">
          <tr>
            <th className="table-head">Permission</th>
            {data.roles.map((r) => (
              <th key={r.id} className="table-head text-center">
                {ROLE_LABELS[r.name] ?? r.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-800">
          {data.permissions.map((p) => (
            <tr key={p.name}>
              <td className="table-cell">
                <p className="font-mono text-xs text-ink-100">{p.name}</p>
                <p className="text-xs text-ink-400">{p.description}</p>
              </td>
              {data.roles.map((r) => (
                <td key={r.id} className="table-cell text-center">
                  {r.permissions.includes(p.name) ? <Check className="mx-auto h-4 w-4 text-emerald-400" aria-label="Granted" /> : <span className="text-ink-600">—</span>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-5 py-4 text-xs text-ink-400">Permissions are enforced by the API on every request; the interface only hides actions a role cannot perform.</p>
    </div>
  );
}

function UsersView() {
  const [tab, setTab] = useState<'users' | 'roles'>('users');
  return (
    <>
      <PageHeader title="Users & Roles" icon={<Users className="h-5 w-5" />} description="Console accounts, role assignments and site scopes." />
      <Card>
        <div className="px-4 pt-2">
          <Tabs value={tab} onChange={setTab} tabs={[{ value: 'users', label: 'Users' }, { value: 'roles', label: 'Role permissions' }]} />
        </div>
        {tab === 'users' ? <UsersTab /> : <RolesTab />}
      </Card>
    </>
  );
}

export default function UsersPage() {
  return (
    <RequirePermission permission="users:view">
      <UsersView />
    </RequirePermission>
  );
}
