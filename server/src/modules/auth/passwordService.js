import { AppError, badRequest, notFound, validationFailed } from '../../lib/errors.js';
import { writeAudit } from '../../lib/audit.js';
import { passwordChangedEmail, passwordResetEmail } from '../../lib/mailTemplates.js';
import { hashPassword, passwordProblem, verifyPassword } from '../../lib/password.js';
import { generateToken, hashToken } from '../../lib/tokens.js';
import { withTransaction } from '../../db/pool.js';
import * as repo from './repo.js';

export const EMAIL_RESET_MINUTES = 30;
export const ASSISTED_RESET_MINUTES = 24 * 60; // shared by hand (e.g. WhatsApp), so it gets longer

const invalidResetLink = () =>
  new AppError(400, 'INVALID_RESET_TOKEN', 'This reset link is not valid or has expired. Request a new one.');

/**
 * Creates a fresh single-use reset token for a user (retiring any older ones) and returns the raw
 * token. Only its hash is stored. Used by the email flow and by the owner-assisted flow.
 */
export async function issueResetToken(db, userId, minutes) {
  const token = generateToken();
  await repo.invalidateResetTokens(db, userId);
  await repo.insertResetToken(db, { userId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + minutes * 60_000) });
  return token;
}

export const resetUrl = (config, token) => `${config.appOrigin}/reset-password?token=${token}`;

/**
 * "Forgot password". Runs in the background AFTER the identical 202 response has been sent, and
 * behaves the same on the outside for unknown, suspended and real accounts. Mail problems are
 * logged by the background runner and never reach the person asking.
 */
export async function requestPasswordReset({ pool, config, mailer, req }, email) {
  const user = await repo.findUserForReset(pool, email);

  if (!user || user.status !== 'active') {
    await writeAudit(pool, { req, actorUserId: user?.id ?? null, action: 'auth.password_reset_requested', metadata: { email, outcome: user ? 'suspended' : 'unknown_email' } });
    return;
  }
  if (!mailer.enabled) {
    await writeAudit(pool, { req, actorUserId: user.id, action: 'auth.password_reset_requested', metadata: { outcome: 'email_not_configured' } });
    throw new Error('Password reset email requested but no mail provider is configured');
  }

  const token = await issueResetToken(pool, user.id, EMAIL_RESET_MINUTES);
  await writeAudit(pool, { req, actorUserId: user.id, action: 'auth.password_reset_requested', metadata: { outcome: 'link_sent' } });
  await mailer.send({
    to: user.email,
    ...passwordResetEmail({ name: user.full_name, url: resetUrl(config, token), minutes: EMAIL_RESET_MINUTES }),
  });
}

/** Sets a new password from a reset link (email or owner-assisted), ends every session, clears any lockout. */
export async function resetPassword({ pool, mailer, background, req }, { token, password }) {
  const tokenHash = hashToken(token);
  const peek = await repo.findUsableResetToken(pool, tokenHash);
  if (!peek) throw invalidResetLink();

  const problem = passwordProblem(password, { email: peek.email, fullName: peek.full_name });
  if (problem) throw validationFailed([{ field: 'password', message: problem }]);
  const passwordHash = await hashPassword(password);

  const user = await withTransaction(pool, async (tx) => {
    const found = await repo.findUsableResetToken(tx, tokenHash, { forUpdate: true });
    if (!found) throw invalidResetLink(); // used a moment ago by someone else
    await repo.markResetTokenUsed(tx, found.id);
    await repo.invalidateResetTokens(tx, found.user_id); // any other outstanding links die with this one
    await repo.setPassword(tx, found.user_id, passwordHash);
    await repo.revokeAllSessionsForUser(tx, found.user_id);
    await writeAudit(tx, { req, actorUserId: found.user_id, action: 'auth.password_reset', entityType: 'user', entityId: found.user_id });
    return found;
  });

  notifyPasswordChanged({ mailer, background }, user);
}

/** Logged-in change. Needs the current password; ends every OTHER session but keeps this one. */
export async function changePassword({ pool, config, mailer, background, req }, { currentPassword, newPassword }) {
  const user = req.auth.user;
  const sessionId = req.auth.sessionId;

  const hash = await repo.getPasswordHash(pool, user.id);
  if (!(await verifyPassword(hash, currentPassword))) {
    // Counts toward the account lock, like a failed login, so this cannot be used to guess the password.
    const result = await repo.recordFailedLogin(pool, user.id, config.auth);
    await writeAudit(pool, { req, actorUserId: user.id, action: 'auth.password_change_denied', metadata: { failedCount: result.failed_login_count } });
    throw new AppError(403, 'INVALID_PASSWORD', 'Your current password is not correct');
  }
  const problem = passwordProblem(newPassword, { email: user.email, fullName: user.fullName });
  if (problem) throw validationFailed([{ field: 'newPassword', message: problem }]);
  if (newPassword === currentPassword) {
    throw validationFailed([{ field: 'newPassword', message: 'Choose a password different from the current one' }]);
  }
  const passwordHash = await hashPassword(newPassword);

  await withTransaction(pool, async (tx) => {
    await repo.setPassword(tx, user.id, passwordHash);
    await repo.invalidateResetTokens(tx, user.id);
    const ended = await repo.revokeOtherSessions(tx, user.id, sessionId);
    await writeAudit(tx, { req, actorUserId: user.id, action: 'auth.password_change', entityType: 'user', entityId: user.id, metadata: { otherSessionsEnded: ended } });
  });
  notifyPasswordChanged({ mailer, background }, { email: user.email, full_name: user.fullName });
}

function notifyPasswordChanged({ mailer, background }, user) {
  if (!mailer.enabled) return;
  background.run(mailer.send({ to: user.email, ...passwordChangedEmail({ name: user.full_name }) }), 'password-changed-notice');
}

// ------------------------------------------------------------------ own sessions

export async function listSessions({ pool, config, req }) {
  const rows = await repo.listUsableSessions(pool, req.auth.user.id, config.session.idleMs);
  return rows.map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    ip: row.ip,
    userAgent: row.user_agent,
    current: row.id === req.auth.sessionId,
  }));
}

export async function revokeSession({ pool, req }, sessionId) {
  if (sessionId === req.auth.sessionId) throw badRequest('This is the session you are using. Use "Log out" instead.');
  // Matches only the caller's own sessions: someone else's id looks exactly like one that does not exist.
  if (!(await repo.revokeOwnSession(pool, req.auth.user.id, sessionId))) throw notFound('Session not found');
  await writeAudit(pool, { req, actorUserId: req.auth.user.id, action: 'auth.session_revoke', entityType: 'session', entityId: sessionId });
}

export async function revokeOtherSessions({ pool, req }) {
  const ended = await repo.revokeOtherSessions(pool, req.auth.user.id, req.auth.sessionId);
  await writeAudit(pool, { req, actorUserId: req.auth.user.id, action: 'auth.sessions_revoke_others', metadata: { ended } });
  return { ended };
}
