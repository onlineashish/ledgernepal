import { Router } from 'express';
import { forbidden } from '../../lib/errors.js';
import { writeAudit } from '../../lib/audit.js';
import { num, toCsv } from '../../lib/csv.js';
import { validate } from '../../middleware/validate.js';
import { activityQuery, dashboardQuery, outstandingQuery, overdueQuery } from './schemas.js';
import * as service from './service.js';

const SIDE_WORDS = { receivable: ['Customer', 'Receivables'], payable: ['Supplier', 'Payables'] };

// How each report becomes a CSV: [headers, rows, file name].
const CSV = {
  activity: ({ data }) => [
    ['Period', 'Sales', 'Sales VAT', 'Sales count', 'Purchases', 'Purchases VAT', 'Purchases count', 'Receipts', 'Payments'],
    [
      ...data.rows.map((r) => [r.period, num(r.sales), num(r.salesVat), r.salesCount, num(r.purchases), num(r.purchasesVat), r.purchasesCount, num(r.receipts), num(r.payments)]),
      ['Total', num(data.totals.sales), num(data.totals.salesVat), '', num(data.totals.purchases), num(data.totals.purchasesVat), '', num(data.totals.receipts), num(data.totals.payments)],
    ],
    `activity-${data.period.from}-to-${data.period.to}`,
  ],
  outstanding: ({ data }) => [
    [SIDE_WORDS[data.side][0], 'Phone', 'Balance', 'Overdue'],
    [...data.rows.map((r) => [r.contact.name, r.contact.phone, num(r.balance), num(r.overdue)]), ['Total', '', num(data.total), num(data.totalOverdue)]],
    `outstanding-${data.side}`,
  ],
  overdue: ({ data }) => [
    ['Number', SIDE_WORDS[data.side][0], 'Phone', 'Date', 'Due date', 'Days overdue', 'Total', 'Paid', 'Outstanding'],
    [
      ...data.rows.map((r) => [r.referenceNo, r.contact.name, r.contact.phone, r.txnDate, r.dueDate, r.daysOverdue, num(r.total), num(r.paid), num(r.outstanding)]),
      ['Total', '', '', '', '', '', '', '', num(data.total)],
    ],
    `overdue-${data.side}-${data.asOf}`,
  ],
};

export function reportRoutes({ pool, guards }) {
  const router = Router();
  const deps = { pool };

  /** JSON by default; ?format=csv sends a download, for those allowed to export (and records that it happened). */
  async function respond(req, res, name, result) {
    if (req.valid.query.format !== 'csv') return res.json(result);
    if (!req.business.permissions.has('reports.export')) throw forbidden();
    const [headers, rows, file] = CSV[name](result);
    await writeAudit(pool, {
      req, businessId: req.business.id, actorUserId: req.auth.user.id, action: 'report.export',
      entityType: 'report', metadata: { report: name, rows: rows.length, query: req.valid.query },
    });
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${file}.csv"`, 'Cache-Control': 'no-store' });
    return res.send(toCsv(headers, rows));
  }

  router.get('/dashboard', ...guards.tenant('reports.view'), validate({ query: dashboardQuery }), async (req, res) => {
    res.json(await service.dashboard({ ...deps, req }, req.valid.query));
  });

  router.get('/activity', ...guards.tenant('reports.view'), validate({ query: activityQuery }), async (req, res) => {
    await respond(req, res, 'activity', await service.activity({ ...deps, req }, req.valid.query));
  });

  // Who owes what is a balance, so these also need the ledger permission (as contact balances do).
  router.get('/outstanding', ...guards.tenant('reports.view', 'ledger.view'), validate({ query: outstandingQuery }), async (req, res) => {
    await respond(req, res, 'outstanding', await service.outstanding({ ...deps, req }, req.valid.query));
  });

  router.get('/overdue', ...guards.tenant('reports.view', 'ledger.view'), validate({ query: overdueQuery }), async (req, res) => {
    await respond(req, res, 'overdue', await service.overdue({ ...deps, req }, req.valid.query));
  });

  return router;
}
