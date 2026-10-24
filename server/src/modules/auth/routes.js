import { Router } from 'express';
import { authenticate, requireCsrf } from '../../middleware/authenticate.js';
import { businessContext } from '../../middleware/businessContext.js';
import { validate } from '../../middleware/validate.js';
import { activeBusinessBody, loginBody, registerBody } from './schemas.js';
import * as service from './service.js';

export function authRoutes({ config, pool, rateLimiters }) {
  const router = Router();
  const deps = { pool, config };
  const requireSession = [authenticate({ config, pool }), businessContext({ pool }), requireCsrf];

  // The cookie is HttpOnly (JavaScript cannot read it), Secure in production, and only sent to /api.
  const cookieOptions = { httpOnly: true, secure: config.isProduction, sameSite: 'lax', path: '/api' };
  const setSessionCookie = (res, token) =>
    res.cookie(config.session.cookieName, token, { ...cookieOptions, maxAge: config.session.absoluteMs });

  router.post('/register', rateLimiters.register, validate({ body: registerBody }), async (req, res) => {
    const { token, payload } = await service.register({ ...deps, req }, req.valid.body);
    setSessionCookie(res, token);
    res.status(201).json({ data: payload });
  });

  router.post('/login', rateLimiters.loginIp, rateLimiters.login, validate({ body: loginBody }), async (req, res) => {
    const { token, payload } = await service.login({ ...deps, req }, req.valid.body);
    setSessionCookie(res, token);
    res.json({ data: payload });
  });

  router.get('/me', ...requireSession, async (req, res) => {
    const payload = await service.describeSession(pool, {
      sessionId: req.auth.sessionId,
      csrfToken: req.auth.csrfToken,
      user: req.auth.user,
      business: req.business,
    });
    res.json({ data: payload });
  });

  router.post('/logout', ...requireSession, async (req, res) => {
    await service.logout({ ...deps, req });
    res.clearCookie(config.session.cookieName, cookieOptions);
    res.json({ data: { loggedOut: true } });
  });

  router.post('/active-business', ...requireSession, validate({ body: activeBusinessBody }), async (req, res) => {
    res.json({ data: await service.switchBusiness({ ...deps, req }, req.valid.body.businessId) });
  });

  return router;
}
