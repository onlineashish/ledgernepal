// Members, overrides and invitations. Every query is scoped by business_id from the session.

const MEMBER_SELECT = `
  SELECT bu.id AS membership_id, bu.status, bu.is_owner, bu.joined_at, bu.deactivated_at,
         u.id AS user_id, u.full_name, u.email,
         r.key AS role_key, r.name AS role_name, r.rank AS role_rank,
         COALESCE((SELECT json_agg(json_build_object('permission', p.key, 'effect', o.effect) ORDER BY p.key)
                     FROM business_user_permission_overrides o
                     JOIN permissions p ON p.id = o.permission_id
                    WHERE o.business_user_id = bu.id), '[]'::json) AS overrides
    FROM business_users bu
    JOIN users u ON u.id = bu.user_id
    JOIN roles r ON r.id = bu.role_id`;

export async function listMembers(db, businessId) {
  const { rows } = await db.query(
    `${MEMBER_SELECT} WHERE bu.business_id = $1 ORDER BY bu.status, r.rank DESC, lower(u.full_name), bu.id`,
    [businessId],
  );
  return rows;
}

export async function findMember(db, businessId, membershipId, { forUpdate = false } = {}) {
  const { rows } = await db.query(
    `${MEMBER_SELECT} WHERE bu.business_id = $1 AND bu.id = $2 ${forUpdate ? 'FOR UPDATE OF bu' : ''}`,
    [businessId, membershipId],
  );
  return rows[0] ?? null;
}

export async function findMemberByUser(db, businessId, userId, { forUpdate = false } = {}) {
  const { rows } = await db.query(
    `${MEMBER_SELECT} WHERE bu.business_id = $1 AND bu.user_id = $2 ${forUpdate ? 'FOR UPDATE OF bu' : ''}`,
    [businessId, userId],
  );
  return rows[0] ?? null;
}

export async function isActiveMemberByEmail(db, businessId, email) {
  const { rowCount } = await db.query(
    `SELECT 1 FROM business_users bu JOIN users u ON u.id = bu.user_id
      WHERE bu.business_id = $1 AND u.email = $2 AND bu.status = 'active'`,
    [businessId, email],
  );
  return rowCount > 0;
}

export async function findRole(db, key) {
  const { rows } = await db.query('SELECT id, key, name, rank FROM roles WHERE key = $1', [key]);
  return rows[0] ?? null;
}

export async function setMemberRole(db, businessId, membershipId, roleKey) {
  await db.query(
    `UPDATE business_users SET role_id = (SELECT id FROM roles WHERE key = $3)
      WHERE business_id = $1 AND id = $2`,
    [businessId, membershipId, roleKey],
  );
}

/** Replaces the member's whole override set. `overrides` = [{ permission, effect }]. */
export async function replaceOverrides(db, businessId, membershipId, overrides, grantedBy) {
  await db.query(
    'DELETE FROM business_user_permission_overrides WHERE business_id = $1 AND business_user_id = $2',
    [businessId, membershipId],
  );
  if (overrides.length === 0) return;
  await db.query(
    `INSERT INTO business_user_permission_overrides (business_id, business_user_id, permission_id, effect, granted_by)
     SELECT $1, $2, p.id, x.effect, $3
       FROM unnest($4::text[], $5::text[]) AS x(permission, effect)
       JOIN permissions p ON p.key = x.permission`,
    [businessId, membershipId, grantedBy, overrides.map((o) => o.permission), overrides.map((o) => o.effect)],
  );
}

export async function setMemberActive(db, businessId, membershipId, active, actorUserId) {
  await db.query(
    `UPDATE business_users
        SET status = CASE WHEN $3 THEN 'active' ELSE 'deactivated' END,
            deactivated_at = CASE WHEN $3 THEN NULL ELSE now() END,
            deactivated_by = CASE WHEN $3 THEN NULL ELSE $4::uuid END
      WHERE business_id = $1 AND id = $2`,
    [businessId, membershipId, active, actorUserId],
  );
}

// ------------------------------------------------------------------ invitations

const INVITATION_SELECT = `
  SELECT i.id, i.business_id, i.email, i.expires_at, i.created_at, i.accepted_at, i.revoked_at,
         (i.expires_at <= now()) AS is_expired,
         r.id AS role_id, r.key AS role_key, r.name AS role_name, r.rank AS role_rank,
         inviter.full_name AS invited_by_name,
         b.name AS business_name, b.status AS business_status
    FROM invitations i
    JOIN roles r ON r.id = i.role_id
    JOIN users inviter ON inviter.id = i.invited_by
    JOIN businesses b ON b.id = i.business_id`;

export async function listOpenInvitations(db, businessId) {
  const { rows } = await db.query(
    `${INVITATION_SELECT}
      WHERE i.business_id = $1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL
      ORDER BY i.created_at DESC`,
    [businessId],
  );
  return rows;
}

export async function findOpenInvitation(db, businessId, id, { forUpdate = false } = {}) {
  const { rows } = await db.query(
    `${INVITATION_SELECT}
      WHERE i.business_id = $1 AND i.id = $2 AND i.accepted_at IS NULL AND i.revoked_at IS NULL
      ${forUpdate ? 'FOR UPDATE OF i' : ''}`,
    [businessId, id],
  );
  return rows[0] ?? null;
}

/** For the public accept flow: look up by token hash. Usable = open, unexpired, business active. */
export async function findUsableInvitationByHash(db, tokenHash, { forUpdate = false } = {}) {
  const { rows } = await db.query(
    `${INVITATION_SELECT}
      WHERE i.token_hash = $1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL
        AND i.expires_at > now() AND b.status = 'active'
      ${forUpdate ? 'FOR UPDATE OF i' : ''}`,
    [tokenHash],
  );
  return rows[0] ?? null;
}

/** An unaccepted invitation past its expiry would still block a new one (unique index); retire it. */
export async function revokeExpiredInvitations(db, businessId, email) {
  await db.query(
    `UPDATE invitations SET revoked_at = now()
      WHERE business_id = $1 AND email = $2 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at <= now()`,
    [businessId, email],
  );
}

export async function insertInvitation(db, { businessId, email, roleKey, tokenHash, invitedBy, expiresAt }) {
  const { rows } = await db.query(
    `INSERT INTO invitations (business_id, email, role_id, token_hash, invited_by, expires_at)
     VALUES ($1, $2, (SELECT id FROM roles WHERE key = $3), $4, $5, $6)
     RETURNING id`,
    [businessId, email, roleKey, tokenHash, invitedBy, expiresAt],
  );
  return rows[0];
}

export async function revokeInvitation(db, businessId, id) {
  await db.query('UPDATE invitations SET revoked_at = now() WHERE business_id = $1 AND id = $2', [businessId, id]);
}

export async function markInvitationAccepted(db, id) {
  await db.query('UPDATE invitations SET accepted_at = now() WHERE id = $1', [id]);
}

export async function userExistsByEmail(db, email) {
  const { rowCount } = await db.query('SELECT 1 FROM users WHERE email = $1', [email]);
  return rowCount > 0;
}

/** What decides whether an owner may create a password-reset link for this person (see service). */
export async function getUserSecurityInfo(db, userId, businessId) {
  const { rows } = await db.query(
    `SELECT u.status, u.is_platform_admin,
            (SELECT count(*)::int FROM business_users o WHERE o.user_id = u.id AND o.business_id <> $2) AS other_memberships
       FROM users u WHERE u.id = $1`,
    [userId, businessId],
  );
  return rows[0];
}
