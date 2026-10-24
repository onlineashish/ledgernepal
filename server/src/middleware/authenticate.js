import { forbidden, unauthenticated } from '../lib/errors.js';
import { hashToken, safeEqual } from '../lib/tokens.js';
import * as repo from '../modules/auth/repo.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Turns the session cookie into req.auth = { sessionId, csrfToken, activeBusinessId, user }.
 * The cookie holds a random token; only its hash is stored server-side. Revoked, expired,
 * idle, or suspended-user sessions are refused on the very next request.
 */
export function authenticate({ config, pool }) {
  return async (req, _res, next) => {
    const token = req.cookies?.[config.session.cookieName];
    if (typeof token !== 'string' || token.length === 0 || token.length > 200) return next(unauthenticated());

    const row = await repo.findUsableSession(pool, hashToken(token), config.session.idleMs);
    if (!row) return next(unauthenticated());

    if (row.user_status !== 'active') {
      await repo.revokeAllSessionsForUser(pool, row.user_id);
      return next(unauthenticated());
    }

    repo.touchSession(pool, row.session_id).catch((err) => req.log?.warn({ err }, 'Could not update session activity'));

    req.auth = {
      sessionId: row.session_id,
      csrfToken: row.csrf_token,
      activeBusinessId: row.active_business_id,
      user: {
        id: row.user_id,
        email: row.email,
        fullName: row.full_name,
        isPlatformAdmin: row.is_platform_admin,
      },
    };
    return next();
  };
}

/** Synchronizer-token CSRF check for state-changing requests made with a session. */
export function requireCsrf(req, _res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  if (!safeEqual(req.get('x-csrf-token'), req.auth?.csrfToken)) {
    return next(forbidden('Missing or invalid CSRF token'));
  }
  return next();
}
