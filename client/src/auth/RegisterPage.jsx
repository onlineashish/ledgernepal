import { useState } from 'react';
import { Link } from 'react-router';
import { Alert, Button, Field } from '../components/ui.jsx';
import { fieldErrors, generalMessage } from '../lib/formErrors.js';
import { AuthLayout } from './AuthLayout.jsx';
import { useAuth } from './AuthContext.jsx';

export function RegisterPage() {
  const auth = useAuth();
  const [form, setForm] = useState({ fullName: '', businessName: '', email: '', password: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const errors = fieldErrors(error);
  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));

  async function onSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await auth.register(form);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="Create your business account" subtitle="You will be the owner and can invite your team afterwards.">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {generalMessage(error) && <Alert>{generalMessage(error)}</Alert>}
        <Field label="Your name" autoComplete="name" required value={form.fullName} onChange={set('fullName')} error={errors.fullName} />
        <Field label="Business name" autoComplete="organization" required value={form.businessName} onChange={set('businessName')} error={errors.businessName} />
        <Field label="Email" type="email" autoComplete="email" required value={form.email} onChange={set('email')} error={errors.email} />
        <Field
          label="Password"
          type="password"
          autoComplete="new-password"
          required
          value={form.password}
          onChange={set('password')}
          error={errors.password}
          hint="At least 10 characters. A few random words are easy to remember and hard to guess."
        />
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? 'Creating account…' : 'Create account'}
        </Button>
      </form>
      <p className="mt-5 text-center text-sm text-slate-600">
        Already have an account?{' '}
        <Link to="/login" className="font-medium text-brand-600 hover:underline">
          Log in
        </Link>
      </p>
    </AuthLayout>
  );
}
