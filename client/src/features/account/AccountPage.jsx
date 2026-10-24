import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { Alert, Button, Card, Field, PageHeader } from '../../components/ui.jsx';
import { describeDevice, timeAgo } from '../../lib/device.js';
import { fieldErrors, generalMessage } from '../../lib/formErrors.js';

const SESSIONS_KEY = ['account', 'sessions'];

export function AccountPage() {
  const auth = useAuth();
  return (
    <>
      <PageHeader title="Account & security" description={`${auth.user.fullName} · ${auth.user.email}`} />
      <div className="grid gap-6 lg:grid-cols-2">
        <ChangePasswordCard />
        <SessionsCard />
      </div>
    </>
  );
}

function ChangePasswordCard() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '' });
  const [done, setDone] = useState(false);
  const set = (key) => (e) => { setDone(false); setForm((f) => ({ ...f, [key]: e.target.value })); };

  const change = useMutation({
    mutationFn: () => apiFetch('/auth/password/change', { method: 'POST', body: form }),
    onSuccess: () => {
      setForm({ currentPassword: '', newPassword: '' });
      setDone(true);
      queryClient.invalidateQueries({ queryKey: SESSIONS_KEY }); // other devices were just logged out
    },
  });
  const errors = fieldErrors(change.error);
  // A wrong current password is a problem with that field, not a page-level failure.
  if (change.error?.code === 'INVALID_PASSWORD') errors.currentPassword = change.error.message;

  return (
    <Card title="Change password">
      <form onSubmit={(e) => { e.preventDefault(); change.mutate(); }} className="space-y-4" noValidate>
        {done && <Alert tone="success">Password changed. Your other devices were logged out.</Alert>}
        {change.error && change.error.code !== 'INVALID_PASSWORD' && generalMessage(change.error) && <Alert>{generalMessage(change.error)}</Alert>}
        <Field label="Current password" type="password" autoComplete="current-password" required value={form.currentPassword} onChange={set('currentPassword')} error={errors.currentPassword} />
        <Field label="New password" type="password" autoComplete="new-password" required value={form.newPassword} onChange={set('newPassword')} error={errors.newPassword} hint="At least 10 characters." />
        <Button type="submit" disabled={change.isPending}>{change.isPending ? 'Saving…' : 'Change password'}</Button>
      </form>
    </Card>
  );
}

function SessionsCard() {
  const queryClient = useQueryClient();
  const sessions = useQuery({ queryKey: SESSIONS_KEY, queryFn: ({ signal }) => apiFetch('/auth/sessions', { signal }).then((r) => r.data) });
  const refresh = () => queryClient.invalidateQueries({ queryKey: SESSIONS_KEY });
  const endOne = useMutation({ mutationFn: (id) => apiFetch(`/auth/sessions/${id}`, { method: 'DELETE' }), onSuccess: refresh });
  const endOthers = useMutation({ mutationFn: () => apiFetch('/auth/sessions/revoke-others', { method: 'POST' }), onSuccess: refresh });
  const hasOthers = sessions.data?.some((s) => !s.current);
  const error = endOne.error ?? endOthers.error;

  return (
    <Card title="Where you are logged in">
      {sessions.isPending && <p className="text-sm text-slate-600">Loading…</p>}
      {sessions.isError && <Alert>{sessions.error.message}</Alert>}
      {error && <Alert className="mb-3">{error.message}</Alert>}
      {sessions.data && (
        <ul className="divide-y divide-slate-100">
          {sessions.data.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
              <div>
                <p className="font-medium text-slate-900">
                  {describeDevice(s.userAgent)}
                  {s.current && <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-800">This device</span>}
                </p>
                <p className="text-slate-500">Active {timeAgo(s.lastSeenAt)}{s.ip ? ` · ${s.ip}` : ''}</p>
              </div>
              {!s.current && (
                <Button variant="secondary" disabled={endOne.isPending} aria-label={`Log out ${describeDevice(s.userAgent)}`} onClick={() => endOne.mutate(s.id)}>
                  Log out
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {hasOthers && (
        <Button className="mt-4" variant="secondary" disabled={endOthers.isPending} onClick={() => endOthers.mutate()}>
          Log out all other devices
        </Button>
      )}
    </Card>
  );
}
