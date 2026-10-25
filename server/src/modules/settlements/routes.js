import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { createSettlementBody, idParams, listSettlementsQuery, openDocumentsQuery, setAllocationsBody, updateTextBody, voidBody } from './schemas.js';
import * as service from './service.js';

/**
 * Routes for receipts ('receipt', money in) or payments ('payment', money out). Same behaviour, own permissions:
 *   perms = { view, create, void }.  create also covers choosing what the money is applied to and editing the notes.
 */
export function settlementRoutes({ pool, guards, kind, perms }) {
  const router = Router();
  const deps = { pool, kind };

  router.get('/', ...guards.tenant(perms.view), validate({ query: listSettlementsQuery }), async (req, res) => {
    res.json(await service.list({ ...deps, req }, req.valid.query));
  });

  // Declared before '/:id' so "open-documents" is never read as an id.
  router.get('/open-documents', ...guards.tenant(perms.create), validate({ query: openDocumentsQuery }), async (req, res) => {
    res.json({ data: await service.openDocuments({ ...deps, req }, req.valid.query.contactId) });
  });

  router.post('/', ...guards.tenant(perms.create), validate({ body: createSettlementBody }), async (req, res) => {
    res.status(201).json({ data: await service.create({ ...deps, req }, req.valid.body) });
  });

  router.get('/:id', ...guards.tenant(perms.view), validate({ params: idParams }), async (req, res) => {
    res.json({ data: await service.get({ ...deps, req }, req.valid.params.id) });
  });

  router.patch('/:id', ...guards.tenant(perms.create), validate({ params: idParams, body: updateTextBody }), async (req, res) => {
    res.json({ data: await service.updateText({ ...deps, req }, req.valid.params.id, req.valid.body) });
  });

  router.put('/:id/allocations', ...guards.tenant(perms.create), validate({ params: idParams, body: setAllocationsBody }), async (req, res) => {
    res.json({ data: await service.setAllocations({ ...deps, req }, req.valid.params.id, req.valid.body) });
  });

  router.post('/:id/auto-allocate', ...guards.tenant(perms.create), validate({ params: idParams }), async (req, res) => {
    res.json({ data: await service.autoAllocate({ ...deps, req }, req.valid.params.id) });
  });

  router.post('/:id/void', ...guards.tenant(perms.void), validate({ params: idParams, body: voidBody }), async (req, res) => {
    res.json({ data: await service.voidSettlement({ ...deps, req }, req.valid.params.id, req.valid.body) });
  });

  return router;
}
