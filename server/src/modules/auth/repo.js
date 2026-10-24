// SQL for users, sessions and memberships. Every function takes `db` (a pool or a transaction
// client) first, and uses parameterised queries only.

export async function insertUser(db, { email, passwordHash, fullName }) {
  const { rows } = await db.query(
    `INSERT INTO users (email, password_hash, full_name, password_changed_at)
     VALUES ($1, $2, $3, now())
     RETURNING id, email, full_name, is_platform_admin, status`,
    [email, passwordHash, fullName],
  );
  return rows[0];
}

export async function findUserByEmail(db, email) {
  const { rows } = await db.query(
    `SELECT id, email, full_name, password_hash, status, is_platform_admin,
            (locked_until IS NOT NULL AND locked_until > now()) AS is_locked
     FROM users WHERE email = $1`,
    [email],
  );
  return rows[0] ?? null;
}

export async function getPasswordHash(db, userId) {
  const { rows } = await db.query('SELECT password_hash FROM users WHERE id = $1', [userId]);
  return rows[0]?.password_hash ?? null;
}

/** Counts a failed password attempt and locks the account once the limit is reached. */
export async function recordFailedLogin(db, userId, { maxFailedLogins, lockMs }) {
  const { rows } = await db.query(
    `UPDATE users
        SET failed_login_count = failed_login_count + 1,
            locked_until = CASE WHEN failed_login_count + 1 >= $2
                                THEN now() + ($3::int * interval '1 millisecond')
                                ELSE locked_until END
      WHERE id = $1
      RETURNING failed_login_count, (locked_until IS NOT NULL AND locked_until > now()) AS is_locked`,
    [userId, maxFailedLogins, lockMs],
  );
  return rows[0];
}

export async function clearFailedLogins(db, userId) {
  await db.query('UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE id = $1', [userId]);
}

export async function insertBusiness(db, { name, createdBy }) {
  const { rows } = await db.query(
    'INSERT INTO businesses (name, created_by) VALUES ($1, $2) RETURNING id, name',
    [name, createdBy],
  );
  return rows[0];
}

export async function insertBusinessSettings(db, { businessId, userId }) {
  await db.query('INSERT INTO business_settings (business_id, updated_by) VALUES ($1, $2)', [businessId, userId]);
}

export async function insertMembership(db, { businessId, userId, roleKey, invitedBy = null }) {
  const { rows } = await db.query(
    `INSERT INTO business_users (business_id, user_id, role_id, invited_by)
     VALUES ($1, $2, (SELECT id FROM roles WHERE key = $3), $4)
     RETURNING id`,
    [businessId, userId, roleKey, invitedBy],
  );
  return rows[0];
}

/** Businesses the user can currently work in: active membership AND active business. */
export async function listActiveMemberships(db, userId) {
  const { rows } = await db.query(
    `SELECT b.id AS business_id, b.name AS business_name, r.key AS role_key, r.name AS role_name
       FROM business_users bu
       JOIN businesses b ON b.id = bu.business_id
       JOIN roles r ON r.id = bu.role_id
      WHERE bu.user_id = $1 AND bu.status = 'active' AND b.status = 'active'
      ORDER BY b.name, b.id`,
    [userId],
  );
  return rows;
}

// ------------------------------------------------------------------ sessions

export async function insertSession(db, { tokenHash, csrfToken, userId, activeBusinessId, ip, userAgent, expiresAt }) {
  const { rows } = await db.query(
    `INSERT INTO sessions (token_hash, csrf_token, user_id, active_business_id, ip, user_agent, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [tokenHash, csrfToken, userId, activeBusinessId, ip, userAgent, expiresAt],
  );
  return rows[0];
}

/** A session is usable only if not revoked, not past its hard expiry, and not idle too long. */
export async function findUsableSession(db, tokenHash, idleMs) {
  const { rows } = await db.query(
    `SELECT s.id AS session_id, s.csrf_token, s.active_business_id,
            u.id AS user_id, u.email, u.full_name, u.status AS user_status, u.is_platform_admin
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > now()
        AND s.last_seen_at > now() - ($2::int * interval '1 millisecond')`,
    [tokenHash, idleMs],
  );
  return rows[0] ?? null;
}

/** Updates last_seen_at at most every 5 minutes, so reads do not turn into a write per request. */
export async function touchSession(db, sessionId) {
  await db.query(
    "UPDATE sessions SET last_seen_at = now() WHERE id = $1 AND last_seen_at < now() - interval '5 minutes'",
    [sessionId],
  );
}

export async function revokeSession(db, sessionId) {
  await db.query('UPDATE sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL', [sessionId]);
}

export async function revokeAllSessionsForUser(db, userId) {
  await db.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
}

export async function setSessionBusiness(db, sessionId, businessId) {
  await db.query('UPDATE sessions SET active_business_id = $2 WHERE id = $1', [sessionId, businessId]);
}
