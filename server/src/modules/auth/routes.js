import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import * as passwords from './passwordService.js';
import {
  activeBusinessBody,
  changePasswordBody,
  forgotPasswordBody,
  loginBody,
  registerBody,
  resetPasswordBody,
  sessionIdParams,
} from './schemas.js';
import * as service from './service.js';

export function authRoutes({ config, pool, rateLimiters, guards, mailer, background }) {
  const router = Router();
  const deps = { pool, config };
  const requireSession = guards.session;

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

  // ----- forgotten password (public) -----------------------------------------------------------
  // Always the same 202 answer, sent BEFORE any lookup: whether the address has an account cannot
  // be learned from the response or from how long it takes.
  router.post('/password/forgot', rateLimiters.passwordForgotIp, rateLimiters.passwordForgot, validate({ body: forgotPasswordBody }), (req, res) => {
    res.status(202).json({ data: { accepted: true } });
    background.run(passwords.requestPasswordReset({ ...deps, mailer, req }, req.valid.body.email), 'password-reset-request');
  });

  router.post('/password/reset', rateLimiters.passwordReset, validate({ body: resetPasswordBody }), async (req, res) => {
    await passwords.resetPassword({ ...deps, mailer, background, req }, req.valid.body);
    res.json({ data: { reset: true } });
  });

  // ----- own account security (logged in) ------------------------------------------------------
  router.post('/password/change', ...requireSession, validate({ body: changePasswordBody }), async (req, res) => {
    await passwords.changePassword({ ...deps, mailer, background, req }, req.valid.body);
    res.json({ data: { changed: true } });
  });

  router.get('/sessions', ...requireSession, async (req, res) => {
    res.json({ data: await passwords.listSessions({ ...deps, req }) });
  });

  router.post('/sessions/revoke-others', ...requireSession, async (req, res) => {
    res.json({ data: await passwords.revokeOtherSessions({ ...deps, req }) });
  });

  router.delete('/sessions/:id', ...requireSession, validate({ params: sessionIdParams }), async (req, res) => {
    await passwords.revokeSession({ ...deps, req }, req.valid.params.id);
    res.json({ data: { revoked: true } });
  });

  router.post('/active-business', ...requireSession, validate({ body: activeBusinessBody }), async (req, res) => {
    res.json({ data: await service.switchBusiness({ ...deps, req }, req.valid.body.businessId) });
  });

  return router;
}
