import { useState } from 'react';
import { Link, useLocation } from 'react-router';
import { apiFetch } from '../api/client.js';
import { Alert, Button, Field } from '../components/ui.jsx';
import { fieldErrors, generalMessage } from '../lib/formErrors.js';
import { AuthLayout } from './AuthLayout.jsx';

/** Opened from a reset link: /reset-password?token=…  (from an email, or handed over by an owner). */
export function ResetPasswordPage() {
  const token = new URLSearchParams(useLocation().search).get('token');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const errors = fieldErrors(error);

  if (!token) {
    return (
      <AuthLayout title="Reset link incomplete">
        <p className="text-sm text-slate-600">This link is missing its code. Open the link from your email again, or request a new one.</p>
        <Button to="/forgot-password" className="mt-4 w-full">Request a new link</Button>
      </AuthLayout>
    );
  }

  if (done) {
    return (
      <AuthLayout title="Password changed">
        <p className="text-sm text-slate-700">Your password has been changed and you were logged out everywhere. Log in with the new password.</p>
        <Button to="/login" className="mt-5 w-full">Go to log in</Button>
      </AuthLayout>
    );
  }

  async function onSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/auth/password/reset', { method: 'POST', body: { token, password } });
      setDone(true);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  const expired = error?.code === 'INVALID_RESET_TOKEN';
  return (
    <AuthLayout title="Choose a new password">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {generalMessage(error) && <Alert>{generalMessage(error)}</Alert>}
        <Field
          label="New password"
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
          hint="At least 10 characters. A few random words are easy to remember and hard to guess."
        />
        <Button type="submit" className="w-full" disabled={busy || expired}>{busy ? 'Saving…' : 'Change password'}</Button>
      </form>
      {expired && (
        <p className="mt-4 text-center text-sm">
          <Link to="/forgot-password" className="font-medium text-brand-600 hover:underline">Request a new link</Link>
        </p>
      )}
    </AuthLayout>
  );
}
