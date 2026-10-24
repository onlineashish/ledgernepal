import { PERMISSION_KEYS } from '@ledgernepal/shared/permissions';
import { AppError, forbidden } from '../lib/errors.js';

const KNOWN = new Set(PERMISSION_KEYS);

/**
 * Allows the request only if the user has ALL the listed permissions in their ACTIVE
 * business (taken from the session, never from the request). Runs after businessContext.
 * Unknown permission names throw at startup, so a typo can never silently lock or open a route.
 */
export function requirePermission(...permissions) {
  if (permissions.length === 0) throw new Error('requirePermission needs at least one permission');
  for (const key of permissions) {
    if (!KNOWN.has(key)) throw new Error(`Unknown permission "${key}"`);
  }

  const guard = (req, _res, next) => {
    if (!req.business) {
      return next(new AppError(409, 'NO_ACTIVE_BUSINESS', 'Choose a business to continue'));
    }
    if (!permissions.every((key) => req.business.permissions.has(key))) {
      return next(forbidden());
    }
    return next();
  };
  guard.guard = 'permission';
  guard.permissions = permissions; // read by the route-coverage test
  return guard;
}
