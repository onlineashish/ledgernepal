import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { transferOwnershipBody } from '../users/schemas.js';
import * as service from './service.js';

export function businessRoutes({ config, pool, guards }) {
  const router = Router();

  // Owner-exclusive: not a grantable permission, so it cannot be delegated by mistake.
  router.post('/current/transfer-ownership', ...guards.owner, validate({ body: transferOwnershipBody }), async (req, res) => {
    res.json({ data: await service.transferOwnership({ pool, config, req }, req.valid.body) });
  });

  return router;
}
