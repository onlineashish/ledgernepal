import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { acceptNewBody, tokenBody } from '../users/schemas.js';
import * as service from './service.js';

/**
 * Invitation links are used by people who may not have an account yet, so two of these
 * routes are public. The unguessable token (256 bits, stored only as a hash) is the credential.
 * The token travels in the POST body, never the URL, so it does not end up in access logs.
 */
export function invitationRoutes({ config, pool, rateLimiters, guards }) {
  const router = Router();
  const deps = { pool, config };

  router.post('/preview', rateLimiters.invitation, validate({ body: tokenBody }), async (req, res) => {
    res.json({ data: await service.preview(deps, req.valid.body.token) });
  });

  router.post('/accept-new', rateLimiters.invitation, validate({ body: acceptNewBody }), async (req, res) => {
    const { token, payload } = await service.acceptNew({ ...deps, req }, req.valid.body);
    res.cookie(config.session.cookieName, token, {
      httpOnly: true,
      secure: config.isProduction,
      sameSite: 'lax',
      path: '/api',
      maxAge: config.session.absoluteMs,
    });
    res.status(201).json({ data: payload });
  });

  router.post('/accept', ...guards.session, validate({ body: tokenBody }), async (req, res) => {
    res.json({ data: await service.accept({ ...deps, req }, req.valid.body.token) });
  });

  return router;
}
