import { useState } from 'react';
import { Navigate } from 'react-router';
import { Alert, Button } from '../components/ui.jsx';
import { AuthLayout } from './AuthLayout.jsx';
import { useAuth } from './AuthContext.jsx';

/** Shown after login when the person belongs to several businesses. */
export function ChooseBusinessPage() {
  const auth = useAuth();
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);

  // Leave as soon as a business is active — decided from state, not by navigating after the request,
  // because the new session reaches the screen a moment after the request finishes.
  if (auth.activeBusiness || auth.memberships.length === 0) return <Navigate to="/" replace />;

  async function choose(businessId) {
    setBusyId(businessId);
    setError(null);
    try {
      await auth.chooseBusiness(businessId);
    } catch (err) {
      setError(err);
      setBusyId(null);
    }
  }

  return (
    <AuthLayout title="Choose a business" subtitle={`Logged in as ${auth.user.fullName}. Which business do you want to work on?`}>
      {error && <Alert className="mb-4">{error.message}</Alert>}
      <ul className="space-y-2">
        {auth.memberships.map((m) => (
          <li key={m.businessId}>
            <button
              type="button"
              disabled={busyId !== null}
              onClick={() => choose(m.businessId)}
              className="flex w-full items-center justify-between rounded-lg border border-slate-300 px-4 py-3 text-left hover:border-brand-600 hover:bg-brand-50 disabled:opacity-60"
            >
              <span className="font-medium text-slate-900">{m.businessName}</span>
              <span className="text-sm text-slate-500">{m.roleName}</span>
            </button>
          </li>
        ))}
      </ul>
      <Button variant="secondary" className="mt-5 w-full" onClick={() => auth.logout()}>
        Log out
      </Button>
    </AuthLayout>
  );
}
