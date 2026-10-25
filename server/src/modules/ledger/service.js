import { DIRECTIONS, OPENING_SIDES, directionOfEffect, openingSideOfEffect } from '@ledgernepal/shared/ledger';
import { todayInNepal } from '@ledgernepal/shared/dates';
import { conflict, forbidden, notFound } from '../../lib/errors.js';
import { writeAudit } from '../../lib/audit.js';
import { nextReference } from '../../lib/sequences.js';
import { withTransaction } from '../../db/pool.js';
import * as contactsRepo from '../contacts/repo.js';
import * as repo from './repo.js';

const canSeeCreators = (req) => req.business.permissions.has('users.view');

export const toEntry = (row, req) => ({
  id: row.id,
  referenceNo: row.reference_no,
  type: row.type,
  status: row.status,
  // The way the person chose it: "You gave / You got" for direct entries, "they owe me / I owe them" for opening balances.
  direction: row.type === 'opening_balance' ? openingSideOfEffect(row.effect) : directionOfEffect(row.effect),
  effect: row.effect,
  txnDate: row.txn_date,
  amount: row.amount,
  description: row.description,
  notes: row.notes,
  externalRef: row.external_ref,
  contact: { id: row.contact_id, name: row.contact_name },
  correctsId: row.corrects_transaction_id,
  createdAt: row.created_at,
  createdBy: canSeeCreators(req) && row.created_by ? { id: row.created_by, fullName: row.created_by_name } : null,
  voidedAt: row.voided_at,
  voidReason: row.void_reason,
});

const audit = (tx, req, action, entry, extra = {}) =>
  writeAudit(tx, {
    req,
    businessId: req.business.id,
    actorUserId: req.auth.user.id,
    action,
    entityType: 'transaction',
    entityId: entry.id,
    ...extra,
  });

const snapshot = (row) => ({
  referenceNo: row.reference_no,
  type: row.type,
  effect: row.effect,
  txnDate: row.txn_date,
  amount: row.amount,
  description: row.description,
  externalRef: row.external_ref,
  contactId: row.contact_id,
});

/** The contact must belong to THIS business (a foreign id looks like a missing one) and not be archived. */
export async function lockPostableContact(tx, req, contactId) {
  const contact = await contactsRepo.findContact(tx, req.business.id, contactId, { forUpdate: true });
  if (!contact) throw notFound('Contact not found');
  if (contact.archived_at) throw conflict('This contact is archived. Unarchive it before adding entries.');
  return contact;
}

async function post(tx, req, { contactId, type, effect, txnDate, amount, externalRef, description, correctsId }) {
  const referenceNo = await nextReference(tx, req.business.id, type, txnDate);
  const id = await repo.insertPosted(tx, {
    businessId: req.business.id,
    userId: req.auth.user.id,
    contactId,
    type,
    effect,
    txnDate,
    amount,
    referenceNo,
    externalRef,
    description,
    correctsId,
  });
  return repo.findEntry(tx, req.business.id, id);
}

// ------------------------------------------------------------------ direct entries

export function createEntry({ pool, req }, body) {
  return withTransaction(pool, async (tx) => {
    await lockPostableContact(tx, req, body.contactId);
    const row = await post(tx, req, {
      contactId: body.contactId,
      type: 'ledger_entry',
      effect: DIRECTIONS[body.direction].effect,
      txnDate: body.txnDate,
      amount: body.amount,
      externalRef: body.externalRef,
      description: body.description,
    });
    await audit(tx, req, 'ledger.entry_create', row, { after: snapshot(row) });
    return toEntry(row, req);
  });
}

export async function getEntry({ pool, req }, id) {
  const row = await repo.findEntry(pool, req.business.id, id);
  if (!row) throw notFound('Entry not found');
  return toEntry(row, req);
}

export async function listEntries({ pool, req }, query) {
  const { rows, total } = await repo.listEntries(pool, req.business.id, query);
  return { data: rows.map((row) => toEntry(row, req)), meta: { page: query.page, pageSize: query.pageSize, total } };
}

async function lockPostedEntry(tx, req, id) {
  const row = await repo.findEntry(tx, req.business.id, id, { forUpdate: true });
  if (!row) throw notFound('Entry not found');
  if (row.status === 'voided') throw conflict('This entry has already been voided');
  return row;
}

export function voidEntry({ pool, req }, id, { reason }) {
  return withTransaction(pool, async (tx) => {
    const row = await lockPostedEntry(tx, req, id);
    await repo.voidPosted(tx, { businessId: req.business.id, userId: req.auth.user.id, id, reason });
    await audit(tx, req, 'ledger.entry_void', row, { before: snapshot(row), metadata: { reason } });
    return toEntry(await repo.findEntry(tx, req.business.id, id), req);
  });
}

/** Void the old entry and post the corrected one together. Anything left out keeps its old value. */
export function correctEntry({ pool, req }, id, body) {
  return withTransaction(pool, async (tx) => {
    const original = await lockPostedEntry(tx, req, id);
    if (original.type !== 'ledger_entry') throw conflict('Opening balances are changed from the contact page');
    await lockPostableContact(tx, req, original.contact_id);

    await repo.voidPosted(tx, { businessId: req.business.id, userId: req.auth.user.id, id, reason: `Corrected: ${body.reason}` });
    const replacement = await post(tx, req, {
      contactId: original.contact_id,
      type: 'ledger_entry',
      effect: body.direction ? DIRECTIONS[body.direction].effect : original.effect,
      txnDate: body.txnDate ?? original.txn_date,
      amount: body.amount ?? original.amount,
      externalRef: body.externalRef === undefined ? original.external_ref : body.externalRef,
      description: body.description === undefined ? original.description : body.description,
      correctsId: original.id,
    });
    await audit(tx, req, 'ledger.entry_correct', replacement, {
      before: snapshot(original),
      after: snapshot(replacement),
      metadata: { reason: body.reason, correctsId: original.id, correctsReference: original.reference_no },
    });
    return {
      voided: toEntry(await repo.findEntry(tx, req.business.id, id), req),
      replacement: toEntry(replacement, req),
    };
  });
}

/** Description, notes and external reference stay editable on a posted entry; nothing financial does. */
export function updateEntryText({ pool, req }, id, changes) {
  return withTransaction(pool, async (tx) => {
    const before = await lockPostedEntry(tx, req, id);
    await repo.updateText(tx, { businessId: req.business.id, userId: req.auth.user.id, id, changes });
    const after = await repo.findEntry(tx, req.business.id, id);
    const changed = Object.keys(changes).filter((k) => changes[k] !== undefined);
    const pick = (row) => ({ description: row.description, notes: row.notes, externalRef: row.external_ref });
    await audit(tx, req, 'ledger.entry_update', after, {
      before: Object.fromEntries(changed.map((k) => [k, pick(before)[k]])),
      after: Object.fromEntries(changed.map((k) => [k, pick(after)[k]])),
    });
    return toEntry(after, req);
  });
}

// ------------------------------------------------------------------ opening balances

/**
 * Sets a contact's opening balance. The first one needs ledger.create; replacing an existing one
 * voids it and needs ledger.correct as well. Runs inside the caller's transaction so a contact can
 * be created together with its opening balance.
 */
export async function setOpeningBalance(tx, req, contactId, { amount, side, asOfDate }) {
  const existing = await repo.findActiveOpeningBalance(tx, req.business.id, contactId, { forUpdate: true });
  if (existing) {
    if (!req.business.permissions.has('ledger.correct')) {
      throw forbidden('Only someone who can correct the ledger may change an existing opening balance');
    }
    await repo.voidPosted(tx, { businessId: req.business.id, userId: req.auth.user.id, id: existing.id, reason: 'Replaced by a new opening balance' });
  }
  const row = await post(tx, req, {
    contactId,
    type: 'opening_balance',
    effect: OPENING_SIDES[side].effect,
    txnDate: asOfDate ?? todayInNepal(),
    amount,
  });
  await audit(tx, req, 'ledger.opening_balance_set', row, {
    before: existing ? snapshot(existing) : null,
    after: snapshot(row),
  });
  return row;
}

export function putOpeningBalance({ pool, req }, contactId, body) {
  return withTransaction(pool, async (tx) => {
    await lockPostableContact(tx, req, contactId);
    return toEntry(await setOpeningBalance(tx, req, contactId, body), req);
  });
}

export function clearOpeningBalance({ pool, req }, contactId) {
  return withTransaction(pool, async (tx) => {
    const contact = await contactsRepo.findContact(tx, req.business.id, contactId, { forUpdate: true });
    if (!contact) throw notFound('Contact not found');
    const existing = await repo.findActiveOpeningBalance(tx, req.business.id, contactId, { forUpdate: true });
    if (!existing) throw notFound('This contact has no opening balance');
    await repo.voidPosted(tx, { businessId: req.business.id, userId: req.auth.user.id, id: existing.id, reason: 'Opening balance removed' });
    await audit(tx, req, 'ledger.opening_balance_remove', existing, { before: snapshot(existing) });
    return { removed: true };
  });
}

// ------------------------------------------------------------------ the contact ledger

export async function contactLedger({ pool, req }, contactId, query) {
  const contact = await contactsRepo.findContact(pool, req.business.id, contactId);
  if (!contact) throw notFound('Contact not found');
  const { rows, summary, total } = await repo.ledgerRows(pool, req.business.id, contactId, query);

  return {
    data: {
      contact: { id: contact.id, name: contact.name },
      period: { from: query.from ?? null, to: query.to ?? null },
      // Balance brought forward: everything posted before "from" (0.00 when no start date is given).
      openingBalance: summary.brought_forward,
      rows: rows.map((r) => ({
        id: r.id,
        referenceNo: r.reference_no,
        txnDate: r.txn_date,
        type: r.type,
        description: r.description,
        externalRef: r.external_ref,
        debit: r.effect === 'debit' ? r.total : null,
        credit: r.effect === 'credit' ? r.total : null,
        balance: r.running,
        createdBy: canSeeCreators(req) && r.created_by ? { id: r.created_by, fullName: r.created_by_name } : null,
      })),
      // Totals cover the whole date range, whatever the search text or page.
      totals: { debit: summary.debit_total, credit: summary.credit_total },
      closingBalance: summary.closing,
    },
    meta: { page: query.page, pageSize: query.pageSize, total },
  };
}
