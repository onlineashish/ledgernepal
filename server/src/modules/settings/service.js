import { notFound } from '../../lib/errors.js';
import { writeAudit } from '../../lib/audit.js';
import { withTransaction } from '../../db/pool.js';
import * as repo from './repo.js';

export const toApi = (row) => ({
  business: {
    name: row.name,
    legalName: row.legal_name,
    address: row.address,
    phone: row.phone,
    email: row.email,
    panNumber: row.pan_number,
    vatNumber: row.vat_number,
  },
  settings: {
    dateDisplay: row.date_display,
    isVatRegistered: row.is_vat_registered,
    defaultVatRate: row.default_vat_rate,
    defaultCreditDays: row.default_credit_days,
    invoiceFooter: row.invoice_footer,
    prefixes: {
      sale: row.sale_prefix,
      purchase: row.purchase_prefix,
      receipt: row.receipt_prefix,
      payment: row.payment_prefix,
      ledgerEntry: row.ledger_prefix,
      openingBalance: row.opening_prefix,
    },
  },
});

const audit = (tx, req, action, before, after) =>
  writeAudit(tx, { req, businessId: req.business.id, actorUserId: req.auth.user.id, action, entityType: 'business', entityId: req.business.id, before, after });

/** Only the parts that actually changed, for the audit log. */
function diff(before, after) {
  const changedBefore = {};
  const changedAfter = {};
  for (const key of Object.keys(after)) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      changedBefore[key] = before[key];
      changedAfter[key] = after[key];
    }
  }
  return [changedBefore, changedAfter];
}

export async function get({ pool, req }) {
  const row = await repo.getAll(pool, req.business.id);
  if (!row) throw notFound('Business not found');
  return toApi(row);
}

export function updateSettings({ pool, req }, changes) {
  return withTransaction(pool, async (tx) => {
    const before = toApi(await repo.getAll(tx, req.business.id, { forUpdate: true })).settings;
    await repo.updateSettings(tx, req.business.id, req.auth.user.id, changes);
    const result = toApi(await repo.getAll(tx, req.business.id));
    const [b, a] = diff(before, result.settings);
    if (Object.keys(a).length > 0) await audit(tx, req, 'settings.update', b, a);
    return result;
  });
}

export function updateProfile({ pool, req }, changes) {
  return withTransaction(pool, async (tx) => {
    const before = toApi(await repo.getAll(tx, req.business.id, { forUpdate: true })).business;
    await repo.updateProfile(tx, req.business.id, changes);
    const result = toApi(await repo.getAll(tx, req.business.id));
    const [b, a] = diff(before, result.business);
    if (Object.keys(a).length > 0) await audit(tx, req, 'business.update', b, a);
    return result;
  });
}
