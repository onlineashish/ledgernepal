import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { contactIdParams, createContactBody, listContactsQuery, updateContactBody } from './schemas.js';
import * as service from './service.js';

export function contactRoutes({ pool, guards }) {
  const router = Router();
  const deps = { pool };

  router.get('/', ...guards.tenant('contacts.view'), validate({ query: listContactsQuery }), async (req, res) => {
    res.json(await service.list({ ...deps, req }, req.valid.query));
  });

  router.post('/', ...guards.tenant('contacts.create'), validate({ body: createContactBody }), async (req, res) => {
    res.status(201).json({ data: await service.create({ ...deps, req }, req.valid.body) });
  });

  router.get('/:id', ...guards.tenant('contacts.view'), validate({ params: contactIdParams }), async (req, res) => {
    res.json({ data: await service.get({ ...deps, req }, req.valid.params.id) });
  });

  router.patch(
    '/:id',
    ...guards.tenant('contacts.update'),
    validate({ params: contactIdParams, body: updateContactBody }),
    async (req, res) => {
      res.json({ data: await service.update({ ...deps, req }, req.valid.params.id, req.valid.body) });
    },
  );

  router.post('/:id/archive', ...guards.tenant('contacts.archive'), validate({ params: contactIdParams }), async (req, res) => {
    res.json({ data: await service.setArchived({ ...deps, req }, req.valid.params.id, true) });
  });

  router.post('/:id/unarchive', ...guards.tenant('contacts.archive'), validate({ params: contactIdParams }), async (req, res) => {
    res.json({ data: await service.setArchived({ ...deps, req }, req.valid.params.id, false) });
  });

  return router;
}
