import { PERMISSION_KEYS } from '@ledgernepal/shared/permissions';

/**
 * Effective permissions = role defaults + per-member grants - per-member denies.
 * The Owner always has everything: overrides cannot lock an owner out of their own business.
 * Pure function so the rules can be unit-tested without a database.
 */
export function effectivePermissions({ isOwner, rolePermissions, grants = [], denies = [] }) {
  if (isOwner) return new Set(PERMISSION_KEYS);
  const result = new Set(rolePermissions);
  for (const key of grants) result.add(key);
  for (const key of denies) result.delete(key);
  return result;
}
