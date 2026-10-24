import { vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ROLES, ROLE_PERMISSIONS } from '@ledgernepal/shared/permissions';
import { App } from '../src/app/App.jsx';
import { AuthProvider } from '../src/auth/AuthContext.jsx';

// --------------------------------------------------------------------------- fake server

export const ok = (data, status = 200) => ({ status, body: { data } });
export const fail = (status, code, message, details) => ({ status, body: { error: { code, message, details, requestId: 'test' } } });

/**
 * Replaces fetch with a fake API. `routes` maps "METHOD /path" (without /api) to a response or a
 * function returning one. Unmocked calls answer 404 AND are recorded, so a test can prove that a
 * request was never made. Returns { calls, calledWith(key) }.
 */
export function mockApi(routes) {
  const calls = [];
  const fn = vi.fn(async (url, init = {}) => {
    const method = (init.method ?? 'GET').toUpperCase();
    const path = String(url).replace(/^\/api/, '');
    const key = `${method} ${path}`;
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ key, body, headers: init.headers });

    const handler = routes[key];
    const result = handler === undefined ? fail(404, 'NOT_FOUND', `unmocked ${key}`) : typeof handler === 'function' ? await handler({ body, calls }) : handler;
    return { ok: result.status < 400, status: result.status, json: async () => result.body };
  });
  vi.stubGlobal('fetch', fn);
  return { calls, calledWith: (key) => calls.filter((c) => c.key === key) };
}

// --------------------------------------------------------------------------- fixtures

export function sessionPayload({
  roleKey = 'owner',
  businessId = 'b1',
  businessName = 'Test Traders',
  user = { id: 'u1', email: 'sita@example.com', fullName: 'Sita Sharma', isPlatformAdmin: false },
  otherBusinesses = [],
  withActiveBusiness = true,
  permissions,
} = {}) {
  const role = { roleKey, roleName: ROLES[roleKey].name };
  const mine = { businessId, businessName, ...role };
  const memberships = [mine, ...otherBusinesses];
  return {
    user,
    csrfToken: 'csrf-token-1',
    memberships,
    activeBusiness: withActiveBusiness
      ? { id: businessId, name: businessName, ...role, permissions: permissions ?? [...ROLE_PERMISSIONS[roleKey]].sort() }
      : null,
    needsBusinessSelection: !withActiveBusiness && memberships.length > 1,
  };
}

export const member = (overrides = {}) => ({
  membershipId: 'm1',
  userId: 'u2',
  fullName: 'Hari Prasad',
  email: 'hari@example.com',
  roleKey: 'staff',
  roleName: 'Staff',
  status: 'active',
  isOwner: false,
  joinedAt: '2026-10-01T00:00:00Z',
  deactivatedAt: null,
  overrides: [],
  manageable: true,
  ...overrides,
});

export const invitation = (overrides = {}) => ({
  id: 'i1',
  email: 'new@example.com',
  roleKey: 'staff',
  roleName: 'Staff',
  invitedBy: 'Sita Sharma',
  createdAt: '2026-10-24T00:00:00Z',
  expiresAt: '2026-10-31T00:00:00Z',
  expired: false,
  ...overrides,
});

/** Routes every authenticated page needs. Spread first, then override. */
export const baseRoutes = (payload = sessionPayload()) => ({
  'GET /auth/me': ok(payload),
  'GET /health/ready': ok({ status: 'ok', database: 'ok' }),
});

// --------------------------------------------------------------------------- rendering

export function renderApp({ route = '/' } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={[route]}>
          <App />
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
  return { ...view, queryClient };
}
