import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { createDocumentBody, documentIdParams, listDocumentsQuery, updateDocumentBody, voidDocumentBody } from './schemas.js';
import * as service from './service.js';

/**
 * Routes for one kind of document ('sale' or 'purchase'). Same behaviour, different permissions:
 *   perms = { view, create, update, void }  e.g. 'sales.view' ...
 * create covers saving a draft and posting; update covers editing and deleting drafts and editing notes.
 */
export function documentRoutes({ pool, guards, type, perms }) {
  const router = Router();
  const deps = { pool, type };

  router.get('/', ...guards.tenant(perms.view), validate({ query: listDocumentsQuery }), async (req, res) => {
    res.json(await service.list({ ...deps, req }, req.valid.query));
  });

  router.post('/', ...guards.tenant(perms.create), validate({ body: createDocumentBody }), async (req, res) => {
    res.status(201).json({ data: await service.create({ ...deps, req }, req.valid.body) });
  });

  router.get('/:id', ...guards.tenant(perms.view), validate({ params: documentIdParams }), async (req, res) => {
    res.json({ data: await service.get({ ...deps, req }, req.valid.params.id) });
  });

  router.patch('/:id', ...guards.tenant(perms.update), validate({ params: documentIdParams, body: updateDocumentBody }), async (req, res) => {
    res.json({ data: await service.update({ ...deps, req }, req.valid.params.id, req.valid.body) });
  });

  router.delete('/:id', ...guards.tenant(perms.update), validate({ params: documentIdParams }), async (req, res) => {
    res.json({ data: await service.deleteDraft({ ...deps, req }, req.valid.params.id) });
  });

  router.post('/:id/post', ...guards.tenant(perms.create), validate({ params: documentIdParams }), async (req, res) => {
    res.json({ data: await service.post({ ...deps, req }, req.valid.params.id) });
  });

  router.post('/:id/void', ...guards.tenant(perms.void), validate({ params: documentIdParams, body: voidDocumentBody }), async (req, res) => {
    res.json({ data: await service.voidDocument({ ...deps, req }, req.valid.params.id, req.valid.body) });
  });

  return router;
}
