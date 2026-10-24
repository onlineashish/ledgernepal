import { AppError, forbidden } from '../lib/errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Defence in depth against cross-site requests, on top of SameSite cookies and CSRF tokens:
 * a state-changing request that carries an Origin header must come from our own app.
 * (Non-browser clients send no Origin and are covered by the cookie + CSRF token rules.)
 */
export function originCheck(config) {
  return (req, _res, next) => {
    const origin = req.headers.origin;
    if (SAFE_METHODS.has(req.method) || !origin || origin === config.appOrigin) return next();
    return next(forbidden('Request origin is not allowed'));
  };
}

/**
 * State-changing requests with a body must be JSON. A cross-site HTML form cannot send
 * application/json without a CORS preflight, which our allow-list rejects.
 */
export function requireJson(req, _res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  const hasBody = Number(req.headers['content-length'] ?? 0) > 0 || req.headers['transfer-encoding'];
  if (hasBody && !req.is('application/json')) {
    return next(new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json'));
  }
  return next();
}
