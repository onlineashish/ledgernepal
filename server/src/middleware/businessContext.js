import { effectivePermissions } from '../lib/permissions.js';
import * as repo from '../modules/auth/repo.js';

/**
 * Loads the user's membership in a business and works out what they may do there.
 * Returns null unless ALL of these hold right now: the user has a membership in that
 * business, the membership is active, and the business is active. One query, always fresh,
 * so deactivation or suspension takes effect on the next request.
 */
export async function loadBusinessContext(db, userId, businessId) {
  const { rows } = await db.query(
    `SELECT bu.id AS membership_id, bu.is_owner, b.id AS business_id, b.name AS business_name, bs.date_display,
            r.key AS role_key, r.name AS role_name, r.rank AS role_rank,
            COALESCE((SELECT array_agg(p.key) FROM role_permissions rp
                        JOIN permissions p ON p.id = rp.permission_id
                       WHERE rp.role_id = bu.role_id), '{}') AS role_permissions,
            COALESCE((SELECT array_agg(p.key) FROM business_user_permission_overrides o
                        JOIN permissions p ON p.id = o.permission_id
                       WHERE o.business_user_id = bu.id AND o.effect = 'grant'), '{}') AS grants,
            COALESCE((SELECT array_agg(p.key) FROM business_user_permission_overrides o
                        JOIN permissions p ON p.id = o.permission_id
                       WHERE o.business_user_id = bu.id AND o.effect = 'deny'), '{}') AS denies
       FROM business_users bu
       JOIN businesses b ON b.id = bu.business_id
       LEFT JOIN business_settings bs ON bs.business_id = b.id
       JOIN roles r ON r.id = bu.role_id
      WHERE bu.user_id = $1 AND bu.business_id = $2
        AND bu.status = 'active' AND b.status = 'active'`,
    [userId, businessId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.business_id,
    name: row.business_name,
    dateDisplay: row.date_display ?? 'BS', // how this business prefers dates shown: BS or AD
    membershipId: row.membership_id,
    roleKey: row.role_key,
    roleName: row.role_name,
    roleRank: row.role_rank,
    isOwner: row.is_owner,
    permissions: effectivePermissions({
      isOwner: row.is_owner,
      rolePermissions: row.role_permissions,
      grants: row.grants,
      denies: row.denies,
    }),
  };
}

/**
 * Sets req.business from the SESSION's active business (never from the URL, body or query).
 * If that business is no longer usable for this user, the stale selection is cleared.
 * Must run after authenticate.
 */
export function businessContext({ pool }) {
  const guard = async (req, _res, next) => {
    req.business = null;
    const businessId = req.auth.activeBusinessId;
    if (businessId) {
      req.business = await loadBusinessContext(pool, req.auth.user.id, businessId);
      if (!req.business) {
        await repo.setSessionBusiness(pool, req.auth.sessionId, null);
        req.auth.activeBusinessId = null;
      }
    }
    next();
  };
  guard.guard = 'business'; // marker read by the route-coverage test
  return guard;
}
