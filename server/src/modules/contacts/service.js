import { balanceSideOfAmount, openingSideOfEffect } from '@ledgernepal/shared/ledger';
import { conflict, forbidden, notFound } from '../../lib/errors.js';
import { writeAudit } from '../../lib/audit.js';
import { withTransaction } from '../../db/pool.js';
import * as ledgerRepo from '../ledger/repo.js';
import { setOpeningBalance } from '../ledger/service.js';
import * as repo from './repo.js';

// Balances are financial data: shown only to people who may view the ledger.
const canSeeBalances = (req) => req.business.permissions.has('ledger.view');

/** The contact's own fields. This is also what is written to the audit log (no balance: it is derived). */
const core = (row) => ({
  id: row.id,
  name: row.name,
  types: [
    ...(row.is_customer ? ['customer'] : []),
    ...(row.is_supplier ? ['supplier'] : []),
    ...(row.is_partner ? ['partner'] : []),
  ],
  phone: row.phone,
  email: row.email,
  address: row.address,
  panNumber: row.pan_number,
  vatNumber: row.vat_number,
  notes: row.notes,
  archivedAt: row.archived_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/** What the API returns: the fields plus the current balance ("5000.00" = they owe you, "-300.00" = you owe them). */
export const toApi = (row, req) => ({
  ...core(row),
  balance:
    canSeeBalances(req) && row.balance !== undefined
      ? { amount: row.balance, side: balanceSideOfAmount(row.balance) }
      : null,
});

const audit = (tx, req, action, contact, extra = {}) =>
  writeAudit(tx, {
    req,
    businessId: req.business.id,
    actorUserId: req.auth.user.id,
    action,
    entityType: 'contact',
    entityId: contact.id,
    ...extra,
  });

/** All functions read the business and the user from the authenticated request, never from client input. */

export async function list({ pool, req }, query) {
  const { rows, total } = await repo.listContacts(pool, req.business.id, query);
  return { data: rows.map((row) => toApi(row, req)), meta: { page: query.page, pageSize: query.pageSize, total } };
}

export async function get({ pool, req }, id) {
  const row = await repo.findContact(pool, req.business.id, id, { withBalance: true });
  if (!row) throw notFound('Contact not found'); // also what a contact of another business looks like
  const contact = toApi(row, req);

  // The opening balance entered for this contact, if any (a normal ledger line that can be voided and replaced).
  let openingBalance = null;
  if (canSeeBalances(req)) {
    const ob = await ledgerRepo.findActiveOpeningBalance(pool, req.business.id, id);
    if (ob) {
      openingBalance = { id: ob.id, amount: ob.amount, side: openingSideOfEffect(ob.effect), asOfDate: ob.txn_date, referenceNo: ob.reference_no };
    }
  }
  return { ...contact, openingBalance };
}

export function create({ pool, req }, data) {
  const { openingBalance, ...fields } = data;
  // Saying how much a new contact owes is a ledger action, so it needs ledger permission as well.
  if (openingBalance && !req.business.permissions.has('ledger.create')) {
    throw forbidden('You can add contacts but not opening balances. Leave the opening balance empty.');
  }
  return withTransaction(pool, async (tx) => {
    const inserted = await repo.insertContact(tx, req.business.id, req.auth.user.id, fields);
    await audit(tx, req, 'contact.create', inserted, { after: core(inserted) });
    if (openingBalance) await setOpeningBalance(tx, req, inserted.id, openingBalance);
    // Re-read so the response shows the balance including the opening balance.
    return toApi(await repo.findContact(tx, req.business.id, inserted.id, { withBalance: true }), req);
  });
}

export function update({ pool, req }, id, data) {
  return withTransaction(pool, async (tx) => {
    const existing = await repo.findContact(tx, req.business.id, id, { forUpdate: true });
    if (!existing) throw notFound('Contact not found');
    const row = await repo.updateContact(tx, req.business.id, req.auth.user.id, id, data);

    const before = core(existing);
    const after = core(row);
    const changed = Object.keys(after).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]) && k !== 'updatedAt');
    await audit(tx, req, 'contact.update', after, {
      before: Object.fromEntries(changed.map((k) => [k, before[k]])),
      after: Object.fromEntries(changed.map((k) => [k, after[k]])),
    });
    return toApi(row, req);
  });
}

export function setArchived({ pool, req }, id, archived) {
  return withTransaction(pool, async (tx) => {
    const existing = await repo.findContact(tx, req.business.id, id, { forUpdate: true });
    if (!existing) throw notFound('Contact not found');
    if (Boolean(existing.archived_at) === archived) {
      throw conflict(archived ? 'This contact is already archived' : 'This contact is not archived');
    }
    const row = await repo.setArchived(tx, req.business.id, req.auth.user.id, id, archived);
    await audit(tx, req, archived ? 'contact.archive' : 'contact.unarchive', row);
    return toApi(row, req);
  });
}
