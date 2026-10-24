import { useState } from 'react';
import { Link, useLocation } from 'react-router';
import { Alert, Button, Field } from '../components/ui.jsx';
import { fieldErrors, generalMessage } from '../lib/formErrors.js';
import { AuthLayout } from './AuthLayout.jsx';
import { useAuth } from './AuthContext.jsx';

export function LoginPage() {
  const auth = useAuth();
  const location = useLocation();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const errors = fieldErrors(error);
  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));

  async function onSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await auth.login(form.email, form.password); // PublicOnly then sends them on to where they were headed
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="Log in" subtitle="Welcome back. Enter your details to continue.">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {generalMessage(error) && <Alert>{generalMessage(error)}</Alert>}
        <Field label="Email" type="email" autoComplete="email" required value={form.email} onChange={set('email')} error={errors.email} />
        <Field label="Password" type="password" autoComplete="current-password" required value={form.password} onChange={set('password')} error={errors.password} />
        <p className="-mt-2 text-right text-sm">
          <Link to="/forgot-password" className="text-brand-600 hover:underline">Forgot your password?</Link>
        </p>
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? 'Logging in…' : 'Log in'}
        </Button>
      </form>
      <p className="mt-5 text-center text-sm text-slate-600">
        New here?{' '}
        <Link to="/register" state={location.state} className="font-medium text-brand-600 hover:underline">
          Create your business account
        </Link>
      </p>
    </AuthLayout>
  );
}
