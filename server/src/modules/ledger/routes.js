import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import {
  contactIdParams,
  contactLedgerQuery,
  correctEntryBody,
  createEntryBody,
  exportLedgerQuery,
  entryIdParams,
  listEntriesQuery,
  updateEntryTextBody,
  voidEntryBody,
} from './schemas.js';
import * as service from './service.js';

export function ledgerRoutes({ pool, guards }) {
  const router = Router();
  const deps = { pool };

  router.get('/contacts/:contactId', ...guards.tenant('ledger.view'), validate({ params: contactIdParams, query: contactLedgerQuery }), async (req, res) => {
    res.json(await service.contactLedger({ ...deps, req }, req.valid.params.contactId, req.valid.query));
  });

  // The whole account (all pages) as a spreadsheet file. Needs the export permission as well.
  router.get('/contacts/:contactId/export', ...guards.tenant('ledger.view', 'reports.export'), validate({ params: contactIdParams, query: exportLedgerQuery }), async (req, res) => {
    const file = await service.exportContactLedger({ ...deps, req }, req.valid.params.contactId, req.valid.query);
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${file.name}"`, 'Cache-Control': 'no-store' });
    res.send(file.content);
  });

  router.get('/entries', ...guards.tenant('ledger.view'), validate({ query: listEntriesQuery }), async (req, res) => {
    res.json(await service.listEntries({ ...deps, req }, req.valid.query));
  });

  router.post('/entries', ...guards.tenant('ledger.create'), validate({ body: createEntryBody }), async (req, res) => {
    res.status(201).json({ data: await service.createEntry({ ...deps, req }, req.valid.body) });
  });

  router.get('/entries/:id', ...guards.tenant('ledger.view'), validate({ params: entryIdParams }), async (req, res) => {
    res.json({ data: await service.getEntry({ ...deps, req }, req.valid.params.id) });
  });

  router.patch('/entries/:id', ...guards.tenant('ledger.correct'), validate({ params: entryIdParams, body: updateEntryTextBody }), async (req, res) => {
    res.json({ data: await service.updateEntryText({ ...deps, req }, req.valid.params.id, req.valid.body) });
  });

  router.post('/entries/:id/void', ...guards.tenant('ledger.correct'), validate({ params: entryIdParams, body: voidEntryBody }), async (req, res) => {
    res.json({ data: await service.voidEntry({ ...deps, req }, req.valid.params.id, req.valid.body) });
  });

  router.post('/entries/:id/correct', ...guards.tenant('ledger.correct'), validate({ params: entryIdParams, body: correctEntryBody }), async (req, res) => {
    res.status(201).json({ data: await service.correctEntry({ ...deps, req }, req.valid.params.id, req.valid.body) });
  });

  return router;
}
