import { Navigate, Outlet, useLocation } from 'react-router';
import { Button, EmptyState, PageHeader } from '../components/ui.jsx';
import { useAuth } from './AuthContext.jsx';

export function FullPageMessage({ children }) {
  return <div className="flex h-full items-center justify-center p-6 text-sm text-slate-600">{children}</div>;
}

/**
 * Layout route for pages that need a login. By default it also needs a chosen business.
 * This is a convenience for the person using the app; the server re-checks everything.
 */
export function RequireAuth({ requireBusiness = true }) {
  const auth = useAuth();
  const location = useLocation();

  if (auth.status === 'loading') return <FullPageMessage>Loading…</FullPageMessage>;
  if (auth.loadError) {
    return <FullPageMessage>Could not reach the server: {auth.loadError.message}</FullPageMessage>;
  }
  if (auth.status === 'anonymous') return <Navigate to="/login" replace state={{ from: location }} />;

  if (requireBusiness && !auth.activeBusiness) {
    if (auth.memberships.length > 0) return <Navigate to="/choose-business" replace />;
    return <NoBusiness />;
  }
  return <Outlet />;
}

/** Login and sign-up pages: someone who is already in goes straight to the app. */
export function PublicOnly() {
  const auth = useAuth();
  const location = useLocation();
  if (auth.status === 'loading') return <FullPageMessage>Loading…</FullPageMessage>;
  if (auth.status === 'authenticated') {
    const from = location.state?.from; // where they were headed before being sent to log in
    return <Navigate to={from ? `${from.pathname}${from.search ?? ''}` : '/'} replace />;
  }
  return <Outlet />;
}

/** Shows the page only if the active business grants the permission (any one of them if a list is given). */
export function RequirePermission({ permission, children }) {
  const auth = useAuth();
  const allowed = Array.isArray(permission) ? auth.canAny(permission) : auth.can(permission);
  if (!allowed) {
    return (
      <>
        <PageHeader title="No access" />
        <EmptyState
          title="You do not have access to this page"
          description="Ask the business owner or an administrator if you need it."
          action={<Button to="/" variant="secondary">Back to dashboard</Button>}
        />
      </>
    );
  }
  return children;
}

function NoBusiness() {
  const auth = useAuth();
  return (
    <FullPageMessage>
      <div className="max-w-md text-center">
        <p className="text-base font-medium text-slate-900">You are not part of any active business</p>
        <p className="mt-1">
          Your access may have been removed, or the business is suspended. Ask the owner for a new invitation link.
        </p>
        <Button className="mt-4" variant="secondary" onClick={() => auth.logout()}>
          Log out
        </Button>
      </div>
    </FullPageMessage>
  );
}
