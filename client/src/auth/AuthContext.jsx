import { createContext, useCallback, useContext, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, apiFetch, setCsrfToken, setUnauthenticatedHandler } from '../api/client.js';

const ME_KEY = ['me'];
const AuthContext = createContext(null);

async function fetchMe({ signal }) {
  try {
    const res = await apiFetch('/auth/me', { signal });
    setCsrfToken(res.data.csrfToken);
    return res.data;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null; // simply not logged in
    throw err;
  }
}

/**
 * Holds who is logged in and which business is active. The server decides everything;
 * this only mirrors it so the UI can show the right screens and hide buttons that would be refused.
 */
export function AuthProvider({ children }) {
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ME_KEY, queryFn: fetchMe, staleTime: Infinity, retry: false });
  const session = me.data ?? null;

  // Drop everything cached for a user/business. Business data must never survive a switch of
  // user or business, or one tenant's records could briefly show under another's name.
  // The "me" query itself stays: the provider is subscribed to it and must keep seeing updates.
  const resetCaches = useCallback(
    () => queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== ME_KEY[0] }),
    [queryClient],
  );

  const applySession = useCallback(
    (payload, { clearCaches = true } = {}) => {
      if (clearCaches) resetCaches();
      setCsrfToken(payload?.csrfToken ?? null);
      queryClient.setQueryData(ME_KEY, payload ?? null);
    },
    [queryClient, resetCaches],
  );

  useEffect(() => {
    setUnauthenticatedHandler(() => applySession(null));
    return () => setUnauthenticatedHandler(null);
  }, [applySession]);

  const value = useMemo(() => {
    const permissions = new Set(session?.activeBusiness?.permissions ?? []);
    return {
      status: me.isPending ? 'loading' : session ? 'authenticated' : 'anonymous',
      loadError: me.isError ? me.error : null,
      user: session?.user ?? null,
      memberships: session?.memberships ?? [],
      activeBusiness: session?.activeBusiness ?? null,
      needsBusinessSelection: session?.needsBusinessSelection ?? false,
      can: (permission) => permissions.has(permission),
      canAny: (list) => list.some((p) => permissions.has(p)),

      async login(email, password) {
        applySession((await apiFetch('/auth/login', { method: 'POST', body: { email, password } })).data);
      },
      async register(fields) {
        applySession((await apiFetch('/auth/register', { method: 'POST', body: fields })).data);
      },
      async logout() {
        try {
          await apiFetch('/auth/logout', { method: 'POST' });
        } catch {
          // The server may be unreachable; the person still wants out of this screen.
        }
        applySession(null); // always forget the session locally
      },
      async chooseBusiness(businessId) {
        applySession((await apiFetch('/auth/active-business', { method: 'POST', body: { businessId } })).data);
      },
      async acceptInvitation(token) {
        applySession((await apiFetch('/invitations/accept', { method: 'POST', body: { token } })).data);
      },
      async acceptInvitationAsNewUser(fields) {
        applySession((await apiFetch('/invitations/accept-new', { method: 'POST', body: fields })).data);
      },
    };
  }, [applySession, me.isPending, me.isError, me.error, session]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}
