import { AppError, badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { writeAudit } from '../../lib/audit.js';
import { verifyPassword } from '../../lib/password.js';
import { withTransaction } from '../../db/pool.js';
import * as authRepo from '../auth/repo.js';
import * as usersRepo from '../users/repo.js';

/**
 * Hands the business to another active member. The old owner becomes a Business Administrator;
 * both people's per-member overrides are cleared. The caller must be the Owner (checked by the
 * route guard AND again under a row lock) and must re-enter their password.
 */
export async function transferOwnership({ pool, config, req }, { membershipId, password }) {
  const userId = req.auth.user.id;
  const businessId = req.business.id;

  // A wrong password counts toward the account lockout, like at login, so this cannot be used to guess it.
  const hash = await authRepo.getPasswordHash(pool, userId);
  if (!(await verifyPassword(hash, password))) {
    const result = await authRepo.recordFailedLogin(pool, userId, config.auth);
    await writeAudit(pool, { req, businessId, actorUserId: userId, action: 'business.transfer_ownership_denied', metadata: { reason: 'wrong_password', failedCount: result.failed_login_count } });
    throw new AppError(403, 'INVALID_PASSWORD', 'Incorrect password');
  }
  await authRepo.clearFailedLogins(pool, userId);

  return withTransaction(pool, async (tx) => {
    // Lock both rows in a fixed order so two simultaneous transfers cannot deadlock.
    const ids = [req.business.membershipId, membershipId].sort();
    const locked = {};
    for (const id of ids) locked[id] = await usersRepo.findMember(tx, businessId, id, { forUpdate: true });

    const current = locked[req.business.membershipId];
    const next = locked[membershipId];
    if (!current?.is_owner || current.status !== 'active') throw forbidden('Only the business owner can do this');
    if (!next) throw notFound('Member not found');
    if (next.membership_id === current.membership_id) throw badRequest('You already own this business');
    if (next.status !== 'active') throw conflict('Reactivate this member before making them the owner');

    // Demote first: the database allows only one active owner at a time.
    await usersRepo.setMemberRole(tx, businessId, current.membership_id, 'business_admin');
    await usersRepo.replaceOverrides(tx, businessId, current.membership_id, [], userId);
    await usersRepo.setMemberRole(tx, businessId, next.membership_id, 'owner');
    await usersRepo.replaceOverrides(tx, businessId, next.membership_id, [], userId);

    await writeAudit(tx, {
      req,
      businessId,
      actorUserId: userId,
      action: 'business.transfer_ownership',
      entityType: 'business',
      entityId: businessId,
      before: { ownerMembershipId: current.membership_id, ownerUserId: current.user_id },
      after: { ownerMembershipId: next.membership_id, ownerUserId: next.user_id },
    });
    return { newOwner: { membershipId: next.membership_id, fullName: next.full_name, email: next.email } };
  });
}
