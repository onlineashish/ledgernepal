import { AppError, conflict, forbidden, notFound } from '../../lib/errors.js';
import { writeAudit } from '../../lib/audit.js';
import { hashPassword, verifyAgainstDummy, verifyPassword } from '../../lib/password.js';
import { generateToken, hashToken } from '../../lib/tokens.js';
import { withTransaction } from '../../db/pool.js';
import { loadBusinessContext } from '../../middleware/businessContext.js';
import * as repo from './repo.js';

const invalidCredentials = () =>
  new AppError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password, or too many attempts. Please try again later.');

const PG_UNIQUE_VIOLATION = '23505';

export const publicUser = (row) => ({
  id: row.id,
  email: row.email,
  fullName: row.full_name,
  isPlatformAdmin: row.is_platform_admin,
});

export async function startSession(db, { config, req, userId, activeBusinessId }) {
  const token = generateToken();
  const csrfToken = generateToken();
  const { id: sessionId } = await repo.insertSession(db, {
    tokenHash: hashToken(token),
    csrfToken,
    userId,
    activeBusinessId,
    ip: req.ip ?? null,
    userAgent: (req.get('user-agent') ?? '').slice(0, 255) || null,
    expiresAt: new Date(Date.now() + config.session.absoluteMs),
  });
  return { sessionId, token, csrfToken };
}

/**
 * What the frontend needs to know about a session. If the user belongs to exactly one
 * business and none is selected yet, that one is selected for them.
 */
export async function describeSession(pool, { sessionId, csrfToken, user, business }) {
  const memberships = await repo.listActiveMemberships(pool, user.id);

  if (!business && memberships.length === 1) {
    business = await loadBusinessContext(pool, user.id, memberships[0].business_id);
    if (business) await repo.setSessionBusiness(pool, sessionId, business.id);
  }

  return {
    user,
    csrfToken,
    memberships: memberships.map((m) => ({
      businessId: m.business_id,
      businessName: m.business_name,
      roleKey: m.role_key,
      roleName: m.role_name,
    })),
    activeBusiness: business && {
      id: business.id,
      name: business.name,
      roleKey: business.roleKey,
      roleName: business.roleName,
      permissions: [...business.permissions].sort(),
    },
    needsBusinessSelection: !business && memberships.length > 1,
  };
}

/** Creates the user, their first business, default settings and an Owner membership, atomically. */
export async function register({ pool, config, req }, { fullName, email, password, businessName }) {
  const passwordHash = await hashPassword(password); // slow on purpose; done before opening a transaction

  let created;
  try {
    created = await withTransaction(pool, async (tx) => {
      const user = await repo.insertUser(tx, { email, passwordHash, fullName });
      const business = await repo.insertBusiness(tx, { name: businessName, createdBy: user.id });
      await repo.insertBusinessSettings(tx, { businessId: business.id, userId: user.id });
      await repo.insertMembership(tx, { businessId: business.id, userId: user.id, roleKey: 'owner' });
      const session = await startSession(tx, { config, req, userId: user.id, activeBusinessId: business.id });

      await writeAudit(tx, { req, businessId: business.id, actorUserId: user.id, action: 'auth.register', entityType: 'user', entityId: user.id });
      await writeAudit(tx, { req, businessId: business.id, actorUserId: user.id, action: 'business.create', entityType: 'business', entityId: business.id, after: { name: business.name } });
      return { user, businessId: business.id, session };
    });
  } catch (err) {
    if (err.code === PG_UNIQUE_VIOLATION && err.constraint === 'users_email_key') {
      throw conflict('An account with this email already exists');
    }
    throw err;
  }

  const user = publicUser(created.user);
  const business = await loadBusinessContext(pool, user.id, created.businessId);
  const payload = await describeSession(pool, { ...created.session, user, business });
  return { token: created.session.token, payload };
}

export async function login({ pool, config, req }, { email, password }) {
  const row = await repo.findUserByEmail(pool, email);

  if (!row) {
    await verifyAgainstDummy(password);
    await writeAudit(pool, { req, action: 'auth.login_failed', metadata: { email, reason: 'unknown_email' } });
    throw invalidCredentials();
  }
  if (row.is_locked) {
    await writeAudit(pool, { req, actorUserId: row.id, action: 'auth.login_blocked', metadata: { reason: 'locked' } });
    throw invalidCredentials();
  }
  if (!(await verifyPassword(row.password_hash, password))) {
    const result = await repo.recordFailedLogin(pool, row.id, config.auth);
    await writeAudit(pool, { req, actorUserId: row.id, action: 'auth.login_failed', metadata: { reason: 'wrong_password', failedCount: result.failed_login_count } });
    if (result.is_locked) {
      await writeAudit(pool, { req, actorUserId: row.id, action: 'auth.account_locked', metadata: { minutes: config.auth.lockMs / 60_000 } });
    }
    throw invalidCredentials();
  }
  // Only reveal "suspended" to someone who proved they know the password.
  if (row.status !== 'active') {
    await writeAudit(pool, { req, actorUserId: row.id, action: 'auth.login_blocked', metadata: { reason: 'suspended' } });
    throw forbidden('This account has been suspended. Contact support.');
  }

  await repo.clearFailedLogins(pool, row.id);
  const user = publicUser(row);
  const memberships = await repo.listActiveMemberships(pool, user.id);
  const business = memberships.length === 1 ? await loadBusinessContext(pool, user.id, memberships[0].business_id) : null;
  const session = await startSession(pool, { config, req, userId: user.id, activeBusinessId: business?.id ?? null });
  await writeAudit(pool, { req, businessId: business?.id ?? null, actorUserId: user.id, action: 'auth.login', entityType: 'user', entityId: user.id });

  const payload = await describeSession(pool, { ...session, user, business });
  return { token: session.token, payload };
}

export async function logout({ pool, req }) {
  await repo.revokeSession(pool, req.auth.sessionId);
  await writeAudit(pool, { req, businessId: req.business?.id ?? null, actorUserId: req.auth.user.id, action: 'auth.logout' });
}

/** Switches the session's active business — only to one the user is an active member of. */
export async function switchBusiness({ pool, req }, businessId) {
  const business = await loadBusinessContext(pool, req.auth.user.id, businessId);
  // Same answer for "does not exist", "not a member", "deactivated" and "suspended": nothing is revealed.
  if (!business) throw notFound('Business not found');
  await repo.setSessionBusiness(pool, req.auth.sessionId, business.id);
  await writeAudit(pool, { req, businessId: business.id, actorUserId: req.auth.user.id, action: 'auth.switch_business', entityType: 'business', entityId: business.id });
  return describeSession(pool, { sessionId: req.auth.sessionId, csrfToken: req.auth.csrfToken, user: req.auth.user, business });
}
