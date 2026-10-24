import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { AppError } from '../lib/errors.js';

/**
 * Builds the rate limiters from config.rateLimit. Counters live in memory, which is
 * correct for a single Render instance; move to a shared store if we ever scale out.
 */
export function createRateLimiters(settings) {
  const make = (options) =>
    rateLimit({
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      handler: (_req, _res, next) =>
        next(new AppError(429, 'RATE_LIMITED', 'Too many attempts. Please wait a few minutes and try again.')),
      ...options,
    });

  const byIp = (req) => ipKeyGenerator(req.ip);
  const byIpAndEmail = (req) => `${ipKeyGenerator(req.ip)}|${String(req.body?.email ?? '').trim().toLowerCase()}`;

  return {
    // Slows guessing one account from one address. Only failures count, so normal logins never hit it.
    login: make({ windowMs: settings.loginWindowMs, limit: settings.loginMax, keyGenerator: byIpAndEmail, skipSuccessfulRequests: true }),
    // Slows one address trying many accounts.
    loginIp: make({ windowMs: settings.loginIpWindowMs, limit: settings.loginIpMax, keyGenerator: byIp, skipSuccessfulRequests: true }),
    register: make({ windowMs: settings.registerWindowMs, limit: settings.registerMax, keyGenerator: byIp }),
    // Public invitation endpoints (preview / sign up with an invitation link).
    invitation: make({ windowMs: settings.invitationWindowMs, limit: settings.invitationMax, keyGenerator: byIp }),
    // Generous ceiling on everything under /api.
    api: make({ windowMs: settings.apiWindowMs, limit: settings.apiMax, keyGenerator: byIp }),
  };
}
