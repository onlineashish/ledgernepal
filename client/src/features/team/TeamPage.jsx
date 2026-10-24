import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ROLES, ROLE_KEYS } from '@ledgernepal/shared/permissions';
import { apiFetch } from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { Alert, Button, Card, EmptyState, Field, PageHeader } from '../../components/ui.jsx';
import { ShareLinkCard } from '../../components/ShareLinkCard.jsx';
import { fieldErrors } from '../../lib/formErrors.js';

const MEMBERS_KEY = ['team', 'members'];
const INVITATIONS_KEY = ['team', 'invitations'];
const dateOnly = (iso) => String(iso).slice(0, 10);

export function TeamPage() {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState(null);
  const [share, setShare] = useState(null); // the one-time link being shown (invitation or password reset)

  const members = useQuery({ queryKey: MEMBERS_KEY, queryFn: ({ signal }) => apiFetch('/users', { signal }).then((r) => r.data) });
  const invitations = useQuery({ queryKey: INVITATIONS_KEY, queryFn: ({ signal }) => apiFetch('/users/invitations', { signal }).then((r) => r.data) });

  // Roles this person may hand out: strictly below their own. (The server enforces this too.)
  const myRank = ROLES[auth.activeBusiness.roleKey].rank;
  const assignable = ROLE_KEYS.filter((key) => key !== 'owner' && ROLES[key].rank < myRank);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['team'] });
  const mutate = useMutation({
    mutationFn: ({ path, method = 'POST', body }) => apiFetch(path, { method, body }),
    onMutate: () => setActionError(null),
    onSuccess: refresh,
    onError: (err) => setActionError(err),
  });

  const resetLink = useMutation({
    mutationFn: (m) => apiFetch(`/users/${m.membershipId}/password-reset-link`, { method: 'POST' }).then((r) => r.data),
    onMutate: () => setActionError(null),
    onSuccess: (data) =>
      setShare({
        title: 'Share this password reset link',
        intro: (
          <>
            For <strong>{data.fullName}</strong> ({data.email}). Send it to them yourself, for example on WhatsApp; they then choose their own password.
            It works once and expires in {data.expiresInHours} hours. <strong>This link is shown only once.</strong> Using it logs them out everywhere.
          </>
        ),
        url: data.resetUrl,
        shareText: 'Use this link to choose a new LedgerNepal password:',
      }),
    onError: (err) => setActionError(err),
  });

  return (
    <>
      <PageHeader title="Team" description={`People who can work in ${auth.activeBusiness.name}.`} />
      {actionError && <Alert className="mb-4">{actionError.message}</Alert>}

      {auth.can('users.invite') && assignable.length > 0 && (
        <InviteCard
          assignable={assignable}
          onCreated={(created) => {
            setShare({
              title: 'Share this link',
              intro: (
                <>
                  Invitation for <strong>{created.email}</strong> as {created.roleName}. <strong>This link is shown only once.</strong> If you lose it,
                  revoke the invitation and create a new one.
                </>
              ),
              url: created.inviteUrl,
              shareText: `You are invited to join on LedgerNepal as ${created.roleName}:`,
            });
            refresh();
          }}
        />
      )}
      {share && <ShareLinkCard {...share} onDismiss={() => setShare(null)} />}

      <Card title="Members" className="mt-6">
        {members.isPending && <p className="text-sm text-slate-600">Loading…</p>}
        {members.isError && <Alert>{members.error.message}</Alert>}
        {members.data && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-2 pr-4">Name</th>
                  <th className="py-2 pr-4">Role</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {members.data.map((m) => (
                  <MemberRow
                    key={m.membershipId}
                    member={m}
                    assignable={assignable}
                    busy={mutate.isPending || resetLink.isPending}
                    mutate={mutate.mutate}
                    onResetLink={resetLink.mutate}
                    isSelf={m.userId === auth.user.id}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {auth.can('users.view') && (
        <Card title="Pending invitations" className="mt-6">
          {invitations.isPending && <p className="text-sm text-slate-600">Loading…</p>}
          {invitations.data?.length === 0 && (
            <EmptyState title="No pending invitations" description="Invite someone above and share the link with them." />
          )}
          {invitations.data?.length > 0 && (
            <ul className="divide-y divide-slate-100">
              {invitations.data.map((inv) => (
                <li key={inv.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                  <div>
                    <p className="font-medium text-slate-900">{inv.email}</p>
                    <p className="text-slate-500">
                      {inv.roleName} · invited by {inv.invitedBy} · {inv.expired ? 'expired' : `expires ${dateOnly(inv.expiresAt)}`}
                    </p>
                  </div>
                  {auth.can('users.invite') && (
                    <Button variant="secondary" disabled={mutate.isPending} onClick={() => mutate.mutate({ path: `/users/invitations/${inv.id}`, method: 'DELETE' })}>
                      Revoke
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </>
  );
}

function MemberRow({ member, assignable, busy, mutate, onResetLink, isSelf }) {
  const [confirming, setConfirming] = useState(false);
  const active = member.status === 'active';
  const canChangeRole = member.manageable && active;

  return (
    <tr className={active ? '' : 'text-slate-400'}>
      <td className="py-3 pr-4">
        <p className="font-medium">{member.fullName}{isSelf && <span className="ml-2 text-xs font-normal text-slate-500">(you)</span>}</p>
        <p className="text-slate-500">{member.email}</p>
      </td>
      <td className="py-3 pr-4">
        {canChangeRole ? (
          <select
            aria-label={`Role for ${member.fullName}`}
            value={member.roleKey}
            disabled={busy}
            onChange={(e) => mutate({ path: `/users/${member.membershipId}`, method: 'PATCH', body: { roleKey: e.target.value } })}
            className="rounded-lg border border-slate-300 px-2 py-1"
          >
            {/* In rank order. The member's current role is always listed, even if this person could not assign it. */}
            {ROLE_KEYS.filter((key) => key === member.roleKey || assignable.includes(key)).map((key) => (
              <option key={key} value={key} disabled={!assignable.includes(key)}>{ROLES[key].name}</option>
            ))}
          </select>
        ) : (
          member.roleName
        )}
      </td>
      <td className="py-3 pr-4">{active ? 'Active' : 'Deactivated'}</td>
      <td className="py-3 text-right">
        {member.manageable && active && !confirming && (
          <Button variant="secondary" className="mr-2" disabled={busy} aria-label={`Create password reset link for ${member.fullName}`} onClick={() => onResetLink(member)}>
            Reset link
          </Button>
        )}
        {member.manageable && !confirming && (
          <Button variant="secondary" disabled={busy} onClick={() => (active ? setConfirming(true) : mutate({ path: `/users/${member.membershipId}/reactivate` }))}>
            {active ? 'Deactivate' : 'Reactivate'}
          </Button>
        )}
        {confirming && (
          <span className="inline-flex gap-2">
            <Button disabled={busy} onClick={() => { setConfirming(false); mutate({ path: `/users/${member.membershipId}/deactivate` }); }}>
              Confirm deactivate
            </Button>
            <Button variant="secondary" onClick={() => setConfirming(false)}>Cancel</Button>
          </span>
        )}
      </td>
    </tr>
  );
}

function InviteCard({ assignable, onCreated }) {
  const [email, setEmail] = useState('');
  const [roleKey, setRoleKey] = useState(assignable[assignable.length - 1]);
  const [error, setError] = useState(null);
  const errors = fieldErrors(error);
  const invite = useMutation({
    mutationFn: () => apiFetch('/users/invitations', { method: 'POST', body: { email, roleKey } }).then((r) => r.data),
    onSuccess: (created) => { setEmail(''); setError(null); onCreated(created); },
    onError: setError,
  });

  return (
    <Card title="Invite someone">
      <form
        onSubmit={(e) => { e.preventDefault(); invite.mutate(); }}
        className="grid gap-4 sm:grid-cols-[1fr_12rem_auto] sm:items-end"
        noValidate
      >
        <Field label="Their email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} />
        <div>
          <label htmlFor="invite-role" className="mb-1 block text-sm font-medium text-slate-700">Role</label>
          <select id="invite-role" value={roleKey} onChange={(e) => setRoleKey(e.target.value)} className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
            {assignable.map((key) => <option key={key} value={key}>{ROLES[key].name}</option>)}
          </select>
        </div>
        <Button type="submit" disabled={invite.isPending}>{invite.isPending ? 'Creating…' : 'Create invite link'}</Button>
      </form>
      {error && !errors.email && <Alert className="mt-3">{error.message}</Alert>}
      <p className="mt-3 text-xs text-slate-500">No email is sent. You get a link to share yourself, for example on WhatsApp. Anyone with the link can use it, so send it only to the person invited.</p>
    </Card>
  );
}
