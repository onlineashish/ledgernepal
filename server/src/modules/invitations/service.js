import { conflict, forbidden, notFound, validationFailed } from '../../lib/errors.js';
import { writeAudit } from '../../lib/audit.js';
import { hashPassword, passwordProblem } from '../../lib/password.js';
import { hashToken } from '../../lib/tokens.js';
import { withTransaction } from '../../db/pool.js';
import { loadBusinessContext } from '../../middleware/businessContext.js';
import * as authRepo from '../auth/repo.js';
import { describeSession, publicUser, startSession } from '../auth/service.js';
import * as repo from '../users/repo.js';

const PG_UNIQUE_VIOLATION = '23505';

// One answer for unknown, expired, revoked, used, and suspended-business links: nothing to probe.
const invalidLink = () => notFound('This invitation link is not valid or has expired');

/** Adds the person to the business, or reactivates them if they were removed earlier. */
async function joinBusiness(tx, invitation, userId) {
  const existing = await repo.findMemberByUser(tx, invitation.business_id, userId, { forUpdate: true });
  if (!existing) {
    await authRepo.insertMembership(tx, { businessId: invitation.business_id, userId, roleKey: invitation.role_key });
    return;
  }
  if (existing.status === 'active') throw conflict('You already belong to this business');
  // Coming back: the invited role replaces the old one and old overrides do not return.
  await repo.setMemberActive(tx, invitation.business_id, existing.membership_id, true, userId);
  await repo.setMemberRole(tx, invitation.business_id, existing.membership_id, invitation.role_key);
  await repo.replaceOverrides(tx, invitation.business_id, existing.membership_id, [], userId);
}

const auditAccepted = (tx, req, invitation, userId, via) =>
  writeAudit(tx, {
    req,
    businessId: invitation.business_id,
    actorUserId: userId,
    action: 'user.invitation_accept',
    entityType: 'invitation',
    entityId: invitation.id,
    metadata: { roleKey: invitation.role_key, via },
  });

/** What the invitee sees before choosing to log in or sign up. Public; the token is the secret. */
export async function preview({ pool }, token) {
  const invitation = await repo.findUsableInvitationByHash(pool, hashToken(token));
  if (!invitation) throw invalidLink();
  return {
    businessName: invitation.business_name,
    roleName: invitation.role_name,
    email: invitation.email,
    invitedBy: invitation.invited_by_name,
    accountExists: await repo.userExistsByEmail(pool, invitation.email),
  };
}

/** A logged-in user accepts. Their account email must be the one the invitation was sent to. */
export async function accept({ pool, req }, token) {
  const user = req.auth.user;
  const invitation = await withTransaction(pool, async (tx) => {
    const found = await repo.findUsableInvitationByHash(tx, hashToken(token), { forUpdate: true });
    if (!found) throw invalidLink();
    if (found.email !== user.email.toLowerCase()) {
      throw forbidden('This invitation was sent to a different email address. Log in with that account.');
    }
    await joinBusiness(tx, found, user.id);
    await repo.markInvitationAccepted(tx, found.id);
    await auditAccepted(tx, req, found, user.id, 'existing_account');
    return found;
  });

  const business = await loadBusinessContext(pool, user.id, invitation.business_id);
  await authRepo.setSessionBusiness(pool, req.auth.sessionId, business.id);
  return describeSession(pool, { sessionId: req.auth.sessionId, csrfToken: req.auth.csrfToken, user, business });
}

/** A new person creates their account from the link. The email is fixed by the invitation. */
export async function acceptNew({ pool, config, req }, { token, fullName, password }) {
  const tokenHash = hashToken(token);
  const peek = await repo.findUsableInvitationByHash(pool, tokenHash);
  if (!peek) throw invalidLink();

  const problem = passwordProblem(password, { email: peek.email, fullName });
  if (problem) throw validationFailed([{ field: 'password', message: problem }]);
  const passwordHash = await hashPassword(password);

  let created;
  try {
    created = await withTransaction(pool, async (tx) => {
      const invitation = await repo.findUsableInvitationByHash(tx, tokenHash, { forUpdate: true });
      if (!invitation) throw invalidLink(); // used by someone else a moment ago
      const row = await authRepo.insertUser(tx, { email: invitation.email, passwordHash, fullName });
      await authRepo.insertMembership(tx, { businessId: invitation.business_id, userId: row.id, roleKey: invitation.role_key });
      await repo.markInvitationAccepted(tx, invitation.id);
      const session = await startSession(tx, { config, req, userId: row.id, activeBusinessId: invitation.business_id });
      await writeAudit(tx, { req, businessId: invitation.business_id, actorUserId: row.id, action: 'auth.register', entityType: 'user', entityId: row.id, metadata: { via: 'invitation' } });
      await auditAccepted(tx, req, invitation, row.id, 'new_account');
      return { row, invitation, session };
    });
  } catch (err) {
    if (err.code === PG_UNIQUE_VIOLATION && err.constraint === 'users_email_key') {
      throw conflict('An account with this email already exists. Log in, then open the invitation link again.');
    }
    throw err;
  }

  const user = publicUser(created.row);
  const business = await loadBusinessContext(pool, user.id, created.invitation.business_id);
  const payload = await describeSession(pool, { ...created.session, user, business });
  return { token: created.session.token, payload };
}
