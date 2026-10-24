import { afterAll, describe, expect, it } from 'vitest';
import { PERMISSION_KEYS } from '@ledgernepal/shared/permissions';
import { requirePermission } from '../../src/middleware/requirePermission.js';
import { createTestApp } from '../helpers/testApp.js';

const { app, close } = createTestApp();
afterAll(close);

// The ONLY routes allowed to exist without a login. Adding a route here is a security decision.
const PUBLIC_ROUTES = [
  'GET /api/health',
  'GET /api/health/ready',
  'POST /api/auth/register',
  'POST /api/auth/login',
  // Invitation links are used by people without an account; the unguessable token is the credential.
  'POST /api/invitations/preview',
  'POST /api/invitations/accept-new',
];

// Routes that need a login (and CSRF) but are about the user's own account, not business data.
const ACCOUNT_ROUTES = [
  'GET /api/auth/me',
  'POST /api/auth/logout',
  'POST /api/auth/active-business',
  'POST /api/invitations/accept',
];

// Owner-exclusive actions (not grantable permissions).
const OWNER_ROUTES = ['POST /api/businesses/current/transfer-ownership'];

function collectRoutes() {
  const routes = [];
  for (const [mountPath, router] of app.locals.mountedRouters) {
    for (const layer of router.stack) {
      if (!layer.route) continue;
      const methods = [...new Set(layer.route.stack.map((l) => l.method).filter(Boolean))];
      const path = layer.route.path === '/' ? '' : layer.route.path;
      for (const method of methods) {
        const handlers = layer.route.stack.filter((l) => l.method === method).map((l) => l.handle);
        routes.push({
          key: `${method.toUpperCase()} ${mountPath}${path}`,
          guards: handlers.filter((h) => h.guard).map((h) => h.guard),
          permissions: handlers.filter((h) => h.guard === 'permission').flatMap((h) => h.permissions),
        });
      }
    }
  }
  return routes;
}

const routes = collectRoutes();
const byKey = Object.fromEntries(routes.map((r) => [r.key, r]));

describe('route guard coverage', () => {
  it('finds the routes (sanity check that the test is really looking)', () => {
    expect(routes.length).toBeGreaterThanOrEqual(12);
    expect(byKey['GET /api/contacts']).toBeDefined();
    expect(byKey['POST /api/contacts/:id/archive']).toBeDefined();
  });

  it('every router in the app was mounted through the registry (none can hide from this test)', () => {
    const routersInExpress = app.router.stack.filter((layer) => layer.name === 'router');
    expect(routersInExpress.length).toBe(app.locals.mountedRouters.length);
  });

  it('the public allow-list and account list contain no stale entries', () => {
    for (const key of [...PUBLIC_ROUTES, ...ACCOUNT_ROUTES, ...OWNER_ROUTES]) {
      expect(byKey[key], `${key} is allow-listed but does not exist`).toBeDefined();
    }
  });

  it('only the allow-listed routes are reachable without authentication', () => {
    const unguarded = routes.filter((r) => !r.guards.includes('authenticate')).map((r) => r.key);
    expect(unguarded.sort()).toEqual([...PUBLIC_ROUTES].sort());
  });

  it('every non-public route authenticates first, loads the business, and checks CSRF', () => {
    // (This also covers the invitation "accept" route: logged in, CSRF-checked.)
    for (const route of routes.filter((r) => !PUBLIC_ROUTES.includes(r.key))) {
      const order = route.guards;
      expect(order.slice(0, 3), route.key).toEqual(['authenticate', 'business', 'csrf']);
    }
  });

  it('every business-data route requires at least one permission, after the business is loaded', () => {
    const businessRoutes = routes.filter(
      (r) => ![...PUBLIC_ROUTES, ...ACCOUNT_ROUTES, ...OWNER_ROUTES].includes(r.key),
    );
    expect(businessRoutes.length).toBeGreaterThan(0);
    for (const route of businessRoutes) {
      expect(route.guards, route.key).toEqual(['authenticate', 'business', 'csrf', 'permission']);
      expect(route.permissions.length, route.key).toBeGreaterThan(0);
    }
  });

  it('owner-exclusive routes check the owner after the business is loaded', () => {
    for (const key of OWNER_ROUTES) {
      expect(byKey[key].guards, key).toEqual(['authenticate', 'business', 'csrf', 'owner']);
    }
  });

  it('every permission a route asks for exists in the permission matrix', () => {
    for (const route of routes) {
      for (const permission of route.permissions) {
        expect(PERMISSION_KEYS, `${route.key} uses unknown permission ${permission}`).toContain(permission);
      }
    }
  });

  it('account routes do not quietly demand a permission (they must work for every member)', () => {
    for (const key of ACCOUNT_ROUTES) expect(byKey[key].permissions).toEqual([]);
  });
});

describe('requirePermission', () => {
  const run = (guard, req) =>
    new Promise((resolve) => guard(req, {}, (err) => resolve(err ?? null)));
  const withPermissions = (...keys) => ({ business: { permissions: new Set(keys) } });

  it('refuses to be created with an unknown permission or none at all', () => {
    expect(() => requirePermission('contcts.view')).toThrow(/Unknown permission/);
    expect(() => requirePermission()).toThrow();
  });

  it('allows when the active business grants the permission', async () => {
    expect(await run(requirePermission('contacts.view'), withPermissions('contacts.view'))).toBeNull();
  });

  it('requires ALL listed permissions', async () => {
    const guard = requirePermission('contacts.view', 'ledger.view');
    expect((await run(guard, withPermissions('contacts.view')))?.status).toBe(403);
    expect(await run(guard, withPermissions('contacts.view', 'ledger.view'))).toBeNull();
  });

  it('answers 409 NO_ACTIVE_BUSINESS (not 403, not a crash) when no business is selected', async () => {
    const err = await run(requirePermission('contacts.view'), { business: null });
    expect(err.status).toBe(409);
    expect(err.code).toBe('NO_ACTIVE_BUSINESS');
    expect((await run(requirePermission('contacts.view'), {}))?.status).toBe(409);
  });
});
