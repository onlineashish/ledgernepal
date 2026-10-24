import { useState } from 'react';
import { Link } from 'react-router';
import { apiFetch } from '../api/client.js';
import { Alert, Button, Field } from '../components/ui.jsx';
import { fieldErrors, generalMessage } from '../lib/formErrors.js';
import { AuthLayout } from './AuthLayout.jsx';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const errors = fieldErrors(error);

  async function onSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/auth/password/forgot', { method: 'POST', body: { email } });
      setSentTo(email); // the server answers the same whether or not the account exists, and so do we
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (sentTo) {
    return (
      <AuthLayout title="Check your email">
        <p className="text-sm text-slate-700">
          If there is an account for <strong>{sentTo}</strong>, we have sent a link to choose a new password. It works once and expires in 30 minutes.
        </p>
        <p className="mt-3 text-sm text-slate-600">It can take a few minutes, and may land in your spam folder.</p>
        <Button to="/login" variant="secondary" className="mt-5 w-full">Back to log in</Button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Forgot your password?" subtitle="Enter your email and we will send you a link to choose a new one.">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {generalMessage(error) && <Alert>{generalMessage(error)}</Alert>}
        <Field label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} />
        <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Sending…' : 'Send reset link'}</Button>
      </form>
      <p className="mt-5 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
        Do not have a working email? Ask your business owner or administrator for a reset link. They can create one from the Team page and send it to you.
      </p>
      <p className="mt-4 text-center text-sm">
        <Link to="/login" className="font-medium text-brand-600 hover:underline">Back to log in</Link>
      </p>
    </AuthLayout>
  );
}
