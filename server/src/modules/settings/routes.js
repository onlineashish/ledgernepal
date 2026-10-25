import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { updateSettingsBody } from './schemas.js';
import * as service from './service.js';

export function settingsRoutes({ pool, guards }) {
  const router = Router();
  const deps = { pool };

  router.get('/', ...guards.tenant('business.view'), async (req, res) => {
    res.json({ data: await service.get({ ...deps, req }) });
  });

  router.patch('/', ...guards.tenant('settings.manage'), validate({ body: updateSettingsBody }), async (req, res) => {
    res.json({ data: await service.updateSettings({ ...deps, req }, req.valid.body) });
  });

  return router;
}
