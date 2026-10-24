import { ROLE_PERMISSIONS } from '@ledgernepal/shared/permissions';
import { conflict, forbidden, notFound } from '../../lib/errors.js';
import { writeAudit } from '../../lib/audit.js';
import { assignableRoleProblem, manageTargetProblem, overrideProblem } from '../../lib/memberRules.js';
import { generateToken, hashToken } from '../../lib/tokens.js';
import { withTransaction } from '../../db/pool.js';
import { ASSISTED_RESET_MINUTES, issueResetToken, resetUrl } from '../auth/passwordService.js';
import * as repo from './repo.js';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PG_UNIQUE_VIOLATION = '23505';

const actorOf = (req) => ({
  membershipId: req.business.membershipId,
  roleRank: req.business.roleRank,
  isOwner: req.business.isOwner,
  permissions: req.business.permissions,
});
const targetOf = (row) => ({ membershipId: row.membership_id, roleRank: row.role_rank, isOwner: row.is_owner });

const audit = (tx, req, action, entityId, extra = {}) =>
  writeAudit(tx, {
    req,
    businessId: req.business.id,
    actorUserId: req.auth.user.id,
    action,
    entityType: action.startsWith('user.invitation') ? 'invitation' : 'membership',
    entityId,
    ...extra,
  });

const toMember = (row, actor) => ({
  membershipId: row.membership_id,
  userId: row.user_id,
  fullName: row.full_name,
  email: row.email,
  roleKey: row.role_key,
  roleName: row.role_name,
  status: row.status,
  isOwner: row.is_owner,
  joinedAt: row.joined_at,
  deactivatedAt: row.deactivated_at,
  overrides: row.overrides,
  // Lets the UI hide buttons the server would refuse anyway (the server still decides).
  manageable: actor.permissions.has('users.manage') && manageTargetProblem(actor, targetOf(row)) === null,
});

const toInvitation = (row) => ({
  id: row.id,
  email: row.email,
  roleKey: row.role_key,
  roleName: row.role_name,
  invitedBy: row.invited_by_name,
  createdAt: row.created_at,
  expiresAt: row.expires_at,
  expired: row.is_expired,
});

const overrideSets = (list) => ({
  grants: new Set(list.filter((o) => o.effect === 'grant').map((o) => o.permission)),
  denies: new Set(list.filter((o) => o.effect === 'deny').map((o) => o.permission)),
});
const sameOverrides = (a, b) =>
  JSON.stringify([...a].sort((x, y) => x.permission.localeCompare(y.permission))) ===
  JSON.stringify([...b].sort((x, y) => x.permission.localeCompare(y.permission)));

// ------------------------------------------------------------------ members

export async function listMembers({ pool, req }) {
  const actor = actorOf(req);
  return (await repo.listMembers(pool, req.business.id)).map((row) => toMember(row, actor));
}

export async function getMember({ pool, req }, membershipId) {
  const row = await repo.findMember(pool, req.business.id, membershipId);
  if (!row) throw notFound('Member not found');
  return toMember(row, actorOf(req));
}

/**
 * Changes a member's role and/or their permission overrides. Changing the role clears the
 * member's old overrides unless a new list is supplied in the same request, so a demotion
 * can never silently keep special powers.
 */
export function updateMember({ pool, req }, membershipId, { roleKey, overrides }) {
  const actor = actorOf(req);
  return withTransaction(pool, async (tx) => {
    const target = await repo.findMember(tx, req.business.id, membershipId, { forUpdate: true });
    if (!target) throw notFound('Member not found');
    const blocked = manageTargetProblem(actor, targetOf(target));
    if (blocked) throw forbidden(blocked);

    let newRoleKey = target.role_key;
    if (roleKey !== undefined) {
      const role = await repo.findRole(tx, roleKey);
      const problem = assignableRoleProblem(actor, role);
      if (problem) throw forbidden(problem);
      newRoleKey = role.key;
    }
    const roleChanged = newRoleKey !== target.role_key;

    const overridesBefore = target.overrides;
    const overridesAfter = overrides ?? (roleChanged ? [] : overridesBefore);

    const tooMuch = overrideProblem(actor, {
      roleDefaults: new Set(ROLE_PERMISSIONS[newRoleKey]),
      before: overrideSets(overridesBefore),
      after: overrideSets(overridesAfter),
    });
    if (tooMuch) throw forbidden(tooMuch);

    if (roleChanged) {
      await repo.setMemberRole(tx, req.business.id, membershipId, newRoleKey);
      await audit(tx, req, 'user.role_change', membershipId, { before: { roleKey: target.role_key }, after: { roleKey: newRoleKey } });
    }
    if (!sameOverrides(overridesBefore, overridesAfter)) {
      await repo.replaceOverrides(tx, req.business.id, membershipId, overridesAfter, req.auth.user.id);
      await audit(tx, req, 'user.permissions_change', membershipId, { before: { overrides: overridesBefore }, after: { overrides: overridesAfter } });
    }
    return toMember(await repo.findMember(tx, req.business.id, membershipId), actor);
  });
}

export function setMemberActive({ pool, req }, membershipId, active) {
  const actor = actorOf(req);
  return withTransaction(pool, async (tx) => {
    const target = await repo.findMember(tx, req.business.id, membershipId, { forUpdate: true });
    if (!target) throw notFound('Member not found');
    const blocked = manageTargetProblem(actor, targetOf(target));
    if (blocked) throw forbidden(blocked);
    if ((target.status === 'active') === active) {
      throw conflict(active ? 'This member is already active' : 'This member is already deactivated');
    }
    await repo.setMemberActive(tx, req.business.id, membershipId, active, req.auth.user.id);
    await audit(tx, req, active ? 'user.reactivate' : 'user.deactivate', membershipId, {
      metadata: { userId: target.user_id, email: target.email },
    });
    return toMember(await repo.findMember(tx, req.business.id, membershipId), actor);
  });
}

/**
 * Owner-assisted password reset for someone with no usable email. The result is a one-time link the
 * owner/admin passes to that person (e.g. on WhatsApp); the PERSON then chooses their own password.
 *
 * Safety rules:
 *  - normal rank rules (never yourself, the owner, or an equal/higher rank);
 *  - only for people whose ONLY business is this one. If they also belong to another business, whoever
 *    holds the link could set the password and reach that other business, so only they may reset it;
 *  - never for platform administrators or suspended accounts;
 *  - everything is audited, and using the link ends all of that person's sessions.
 * Honest limit: whoever holds the link could open it before the person does and set the password
 * themselves. Within their own business that is nothing an owner could not already do, but it is why
 * the link is single-use, short-lived, shown once, and audited.
 */
export function createPasswordResetLink({ pool, config, req }, membershipId) {
  const actor = actorOf(req);
  return withTransaction(pool, async (tx) => {
    const target = await repo.findMember(tx, req.business.id, membershipId, { forUpdate: true });
    if (!target) throw notFound('Member not found');
    const blocked = manageTargetProblem(actor, targetOf(target));
    if (blocked) throw forbidden(blocked);
    if (target.status !== 'active') throw conflict('Reactivate this member before creating a reset link');

    const info = await repo.getUserSecurityInfo(tx, target.user_id, req.business.id);
    if (info.is_platform_admin || info.status !== 'active') {
      throw conflict('A reset link cannot be created for this account');
    }
    if (info.other_memberships > 0) {
      throw conflict('This person also belongs to other businesses, so only they can reset their own password. Ask them to use "Forgot password" on the login page.');
    }

    const token = await issueResetToken(tx, target.user_id, ASSISTED_RESET_MINUTES);
    await audit(tx, req, 'user.password_reset_link', membershipId, { metadata: { userId: target.user_id, email: target.email } });
    return {
      fullName: target.full_name,
      email: target.email,
      resetUrl: resetUrl(config, token),
      expiresInHours: ASSISTED_RESET_MINUTES / 60,
    };
  });
}

// ------------------------------------------------------------------ invitations (managed by members)

export async function listInvitations({ pool, req }) {
  return (await repo.listOpenInvitations(pool, req.business.id)).map(toInvitation);
}

/**
 * Creates an invitation and returns the one-time link. Only a hash of the token is stored, so the
 * link cannot be shown again: if it is lost, revoke the invitation and create a new one.
 */
export async function invite({ pool, config, req }, { email, roleKey }) {
  const actor = actorOf(req);
  const role = await repo.findRole(pool, roleKey);
  const problem = assignableRoleProblem(actor, role);
  if (problem) throw forbidden(problem);

  const token = generateToken();
  const invitation = await withTransaction(pool, async (tx) => {
    if (await repo.isActiveMemberByEmail(tx, req.business.id, email)) {
      throw conflict('This person is already a member of your business');
    }
    await repo.revokeExpiredInvitations(tx, req.business.id, email);
    let created;
    try {
      created = await repo.insertInvitation(tx, {
        businessId: req.business.id,
        email,
        roleKey,
        tokenHash: hashToken(token),
        invitedBy: req.auth.user.id,
        expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
      });
    } catch (err) {
      if (err.code === PG_UNIQUE_VIOLATION && err.constraint === 'invitations_one_open_idx') {
        throw conflict('This email already has a pending invitation. Revoke it first to send a new link.');
      }
      throw err;
    }
    await audit(tx, req, 'user.invite', created.id, { metadata: { email, roleKey } });
    return repo.findOpenInvitation(tx, req.business.id, created.id);
  });

  return { ...toInvitation(invitation), inviteUrl: `${config.appOrigin}/accept-invite?token=${token}` };
}

export function revokeInvitation({ pool, req }, id) {
  const actor = actorOf(req);
  return withTransaction(pool, async (tx) => {
    const invitation = await repo.findOpenInvitation(tx, req.business.id, id, { forUpdate: true });
    if (!invitation) throw notFound('Invitation not found');
    // Same rank rule as inviting: you cannot cancel an invitation for a role at or above your own.
    if (!actor.isOwner && invitation.role_rank >= actor.roleRank) {
      throw forbidden('You can only revoke invitations for roles ranked below your own');
    }
    await repo.revokeInvitation(tx, req.business.id, id);
    await audit(tx, req, 'user.invitation_revoke', id, { metadata: { email: invitation.email } });
    return { revoked: true };
  });
}
