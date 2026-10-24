import { OWNER_ONLY_GRANTS } from '@ledgernepal/shared/permissions';

// Who may do what to whom inside a business (plan.md §7). Pure functions: each returns a
// message explaining why NOT, or null when allowed. The service turns a message into a 403.
//
// actor  = { membershipId, roleRank, isOwner, permissions: Set }   (from the request's business context)
// target = { membershipId, roleRank, isOwner }

/** A role may be handed out only if it ranks below the giver. Ownership moves only by transfer. */
export function assignableRoleProblem(actor, role) {
  if (role.key === 'owner') return 'Ownership can only be moved with "transfer ownership"';
  if (role.rank >= actor.roleRank) return 'You can only assign roles ranked below your own';
  return null;
}

/** Changing someone's role, access or active status: never yourself, never the owner, never an equal or higher rank. */
export function manageTargetProblem(actor, target) {
  if (target.membershipId === actor.membershipId) return 'You cannot change your own role or access';
  if (target.isOwner) return 'The owner cannot be changed this way';
  if (target.roleRank >= actor.roleRank) return 'You can only manage members ranked below you';
  return null;
}

/**
 * Per-member permission overrides may not be used to hand out powers the giver lacks.
 *   roleDefaults  Set of permissions the member's (new) role gives by default
 *   before/after  { grants:Set, denies:Set } before and after this change
 * Only what is NEWLY given counts: a new grant, or lifting a deny that was holding back a role default.
 * Re-saving an existing grant you do not hold yourself is fine.
 */
export function overrideProblem(actor, { roleDefaults, before, after }) {
  const newlyAllowed = new Set();
  for (const p of after.grants) {
    if (!before.grants.has(p) && !roleDefaults.has(p)) newlyAllowed.add(p);
  }
  for (const p of before.denies) {
    if (!after.denies.has(p) && roleDefaults.has(p)) newlyAllowed.add(p);
  }
  for (const p of newlyAllowed) {
    if (actor.isOwner) continue;
    if (OWNER_ONLY_GRANTS.includes(p)) return `Only the owner can give "${p}"`;
    if (!actor.permissions.has(p)) return `You cannot give "${p}" because you do not have it yourself`;
  }
  return null;
}
