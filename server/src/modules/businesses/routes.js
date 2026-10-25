import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import * as settings from '../settings/service.js';
import { updateBusinessBody } from '../settings/schemas.js';
import { transferOwnershipBody } from '../users/schemas.js';
import * as service from './service.js';

export function businessRoutes({ config, pool, guards }) {
  const router = Router();

  // Business profile (name, address, PAN, VAT number). Tax and numbering settings live under /api/settings.
  router.patch('/current', ...guards.tenant('business.update'), validate({ body: updateBusinessBody }), async (req, res) => {
    res.json({ data: (await settings.updateProfile({ pool, req }, req.valid.body)).business });
  });

  // Owner-exclusive: not a grantable permission, so it cannot be delegated by mistake.
  router.post('/current/transfer-ownership', ...guards.owner, validate({ body: transferOwnershipBody }), async (req, res) => {
    res.json({ data: await service.transferOwnership({ pool, config, req }, req.valid.body) });
  });

  return router;
}
