import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api/client.js';
import { Alert, Button, Field } from '../components/ui.jsx';
import { fieldErrors, generalMessage } from '../lib/formErrors.js';
import { AuthLayout } from './AuthLayout.jsx';
import { useAuth } from './AuthContext.jsx';

/**
 * Opened from an invitation link: /accept-invite?token=…  The token is the credential, so it
 * is only ever sent in request bodies. (The server omits query strings from its logs and the
 * app sends no Referer, so the URL does not leak it elsewhere.)
 */
export function AcceptInvitePage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const token = new URLSearchParams(location.search).get('token');

  const preview = useQuery({
    queryKey: ['invitation-preview', token],
    queryFn: ({ signal }) => apiFetch('/invitations/preview', { method: 'POST', body: { token }, signal }).then((r) => r.data),
    enabled: Boolean(token),
    retry: false,
    staleTime: Infinity,
  });

  if (!token) {
    return (
      <AuthLayout title="Invitation link incomplete">
        <p className="text-sm text-slate-600">This link is missing its code. Ask the person who invited you to send it again.</p>
      </AuthLayout>
    );
  }
  if (preview.isPending) return <AuthLayout title="Checking your invitation…"><p className="text-sm text-slate-600">One moment.</p></AuthLayout>;
  if (preview.isError) {
    const unreachable = preview.error.code === 'NETWORK_ERROR';
    return (
      <AuthLayout title={unreachable ? 'Cannot reach the server' : 'This invitation is not valid'}>
        <p className="text-sm text-slate-600">
          {unreachable
            ? preview.error.message
            : 'The link may have expired, been cancelled, or already been used. Ask the person who invited you to send a new one.'}
        </p>
        <Button to="/login" variant="secondary" className="mt-4">Go to log in</Button>
      </AuthLayout>
    );
  }

  const invitation = preview.data;
  const subtitle = `${invitation.invitedBy} invited you to join ${invitation.businessName} as ${invitation.roleName}.`;

  if (auth.status === 'authenticated') {
    return (
      <AuthLayout title={`Join ${invitation.businessName}`} subtitle={subtitle}>
        <LoggedInAccept token={token} invitation={invitation} onDone={() => navigate('/', { replace: true })} />
      </AuthLayout>
    );
  }

  if (invitation.accountExists) {
    return (
      <AuthLayout title={`Join ${invitation.businessName}`} subtitle={subtitle}>
        <p className="text-sm text-slate-700">
          There is already an account for <strong>{invitation.email}</strong>. Log in with it to accept.
        </p>
        <Button to="/login" state={{ from: location }} className="mt-4 w-full">Log in to accept</Button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={`Join ${invitation.businessName}`} subtitle={subtitle}>
      <NewAccountForm token={token} invitation={invitation} />
    </AuthLayout>
  );
}

function LoggedInAccept({ token, invitation, onDone }) {
  const auth = useAuth();
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (auth.user.email.toLowerCase() !== invitation.email.toLowerCase()) {
    return (
      <>
        <Alert tone="info">
          This invitation is for <strong>{invitation.email}</strong>, but you are logged in as <strong>{auth.user.email}</strong>.
        </Alert>
        <Button variant="secondary" className="mt-4 w-full" onClick={() => auth.logout()}>
          Log out and switch account
        </Button>
        <Link to="/" className="mt-3 block text-center text-sm text-brand-600 hover:underline">Back to the app</Link>
      </>
    );
  }

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      await auth.acceptInvitation(token);
      onDone();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <>
      {error && <Alert className="mb-4">{error.message}</Alert>}
      <Button className="w-full" onClick={accept} disabled={busy}>
        {busy ? 'Joining…' : `Accept and join ${invitation.businessName}`}
      </Button>
    </>
  );
}

function NewAccountForm({ token, invitation }) {
  const auth = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ fullName: '', password: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const errors = fieldErrors(error);
  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));

  async function onSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await auth.acceptInvitationAsNewUser({ token, ...form });
      navigate('/', { replace: true });
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <p className="text-sm text-slate-700">
        Create your account to join. You will log in with <strong>{invitation.email}</strong>.
      </p>
      {generalMessage(error) && <Alert>{generalMessage(error)}</Alert>}
      <Field label="Your name" autoComplete="name" required value={form.fullName} onChange={set('fullName')} error={errors.fullName} />
      <Field
        label="Choose a password"
        type="password"
        autoComplete="new-password"
        required
        value={form.password}
        onChange={set('password')}
        error={errors.password}
        hint="At least 10 characters."
      />
      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? 'Creating account…' : 'Create account and join'}
      </Button>
    </form>
  );
}
