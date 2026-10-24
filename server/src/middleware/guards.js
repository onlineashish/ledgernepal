import { authenticate, requireCsrf } from './authenticate.js';
import { businessContext } from './businessContext.js';
import { requireOwner } from './requireOwner.js';
import { requirePermission } from './requirePermission.js';

/**
 * The only two ways to protect a route:
 *   guards.session            logged in (any user), CSRF-checked — for account-level endpoints
 *   guards.tenant('x.y', ...) logged in + active business + the named permission(s) — for business data
 *   guards.owner              logged in + active business + must be the Owner — for owner-exclusive actions
 * Spread into the route:  router.get('/', ...guards.tenant('contacts.view'), handler)
 * A test fails if any route is mounted without one of these (or an explicit public allow-list entry).
 */
export function createGuards({ config, pool }) {
  const session = [authenticate({ config, pool }), businessContext({ pool }), requireCsrf];
  return {
    session,
    tenant: (...permissions) => [...session, requirePermission(...permissions)],
    owner: [...session, requireOwner],
  };
}
