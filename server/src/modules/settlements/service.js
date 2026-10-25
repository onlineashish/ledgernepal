import { isOverdue, planOldestFirst } from '@ledgernepal/shared/allocation';
import { todayInNepal } from '@ledgernepal/shared/dates';
import { fromPaisa, toPaisa } from '@ledgernepal/shared/money';
import { conflict, notFound, validationFailed } from '../../lib/errors.js';
import { writeAudit } from '../../lib/audit.js';
import { nextReference } from '../../lib/sequences.js';
import { withTransaction } from '../../db/pool.js';
import * as contactsRepo from '../contacts/repo.js';
import * as ledgerRepo from '../ledger/repo.js';
import { lockPostableContact } from '../ledger/service.js';
import * as repo from './repo.js';

// A receipt is money IN from a customer (a credit: they owe you less) and settles sales invoices.
// A payment is money OUT to a supplier (a debit: you owe them less) and settles purchase bills.
export const KINDS = {
  receipt: { effect: 'credit', documentType: 'sale', noun: 'receipt', documentNoun: 'sales invoice' },
  payment: { effect: 'debit', documentType: 'purchase', noun: 'payment', documentNoun: 'purchase bill' },
};

const cap = (text) => text[0].toUpperCase() + text.slice(1);
const canSeeCreators = (req) => req.business.permissions.has('users.view');

// ------------------------------------------------------------------ shaping

function summary(row, req) {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    referenceNo: row.reference_no,
    txnDate: row.txn_date,
    amount: row.total,
    method: row.payment_method,
    externalRef: row.external_ref,
    description: row.description,
    notes: row.notes,
    contact: { id: row.contact_id, name: row.contact_name },
    allocated: row.allocated, // matched to invoices/bills
    unallocated: row.unallocated, // the advance: counts toward the balance but is not matched to a document
    createdAt: row.created_at,
    createdBy: canSeeCreators(req) && row.created_by ? { id: row.created_by, fullName: row.created_by_name } : null,
    voidedAt: row.voided_at,
    voidReason: row.void_reason,
  };
}

const toAllocation = (a) => ({
  id: a.id,
  amount: a.amount,
  document: { id: a.document_id, type: a.document_type, referenceNo: a.reference_no, txnDate: a.txn_date, total: a.document_total },
});

async function load(db, req, kind, id, options) {
  const row = await repo.findPayment(db, req.business.id, kind, id, options);
  if (!row) throw notFound(`${cap(KINDS[kind].noun)} not found`); // also what another business's looks like
  return row;
}

async function loadFull(db, req, kind, id) {
  const row = await load(db, req, kind, id);
  const allocations = await repo.findAllocations(db, req.business.id, id);
  return { ...summary(row, req), allocations: allocations.map(toAllocation) };
}

const audit = (tx, req, kind, action, row, extra = {}) =>
  writeAudit(tx, { req, businessId: req.business.id, actorUserId: req.auth.user.id, action: `${kind}.${action}`, entityType: 'transaction', entityId: row.id, ...extra });

// ------------------------------------------------------------------ allocating

/**
 * Matches a posted receipt/payment to invoices/bills. `payment.allocated` is what is already matched.
 * Checks each document (right kind, same contact, posted, enough still outstanding) under a row lock; the
 * database re-checks all of it as a safety net. Allocation never changes any contact's balance.
 */
async function allocate(tx, req, kind, payment, items) {
  if (items.length === 0) return;
  const k = KINDS[kind];
  const field = (i, name) => `allocations.${i}.${name}`;

  if (new Set(items.map((i) => i.invoiceId)).size !== items.length) {
    throw validationFailed([{ field: 'allocations', message: `Each ${k.documentNoun} can appear only once` }]);
  }
  const total = items.reduce((sum, i) => sum + toPaisa(i.amount), 0n);
  const free = toPaisa(payment.total) - toPaisa(payment.allocated);
  if (total > free) {
    throw validationFailed([{ field: 'allocations', message: `The amounts add up to ${fromPaisa(total)}, but only ${fromPaisa(free)} of this ${k.noun} is not yet applied` }]);
  }

  const documents = await repo.lockDocuments(tx, req.business.id, k.documentType, items.map((i) => i.invoiceId));
  const byId = new Map(documents.map((d) => [d.id, d]));
  const problems = [];
  items.forEach((item, i) => {
    const doc = byId.get(item.invoiceId);
    if (!doc) throw notFound(`${cap(k.documentNoun)} not found`); // missing, another business's, or the wrong kind: all the same answer
    if (doc.contact_id !== payment.contact_id) problems.push({ field: field(i, 'invoiceId'), message: `This ${k.documentNoun} belongs to a different contact` });
    else if (doc.status !== 'posted') throw conflict(`Only posted documents can be paid. ${doc.reference_no ?? 'A draft'} is ${doc.status}.`);
    else {
      const outstanding = toPaisa(doc.total) - toPaisa(doc.paid);
      if (toPaisa(item.amount) > outstanding) {
        problems.push({ field: field(i, 'amount'), message: `Only ${fromPaisa(outstanding)} is still outstanding on ${doc.reference_no}` });
      }
    }
  });
  if (problems.length > 0) throw validationFailed(problems);

  await repo.insertAllocations(tx, req.business.id, payment.id, req.auth.user.id, items);
}

/** Applies what is left of a receipt/payment to the contact's open documents, oldest first. Returns what was applied. */
async function allocateOldestFirst(tx, req, kind, payment) {
  const k = KINDS[kind];
  const free = toPaisa(payment.total) - toPaisa(payment.allocated);
  if (free <= 0n) return [];
  const open = await repo.listOpenDocuments(tx, req.business.id, k.documentType, payment.contact_id, { forUpdate: true });
  const { allocations } = planOldestFirst(
    free,
    open.map((d) => ({ id: d.id, txnDate: d.txn_date, referenceNo: d.reference_no, outstanding: toPaisa(d.outstanding) })),
  );
  const items = allocations.map((a) => ({ invoiceId: a.id, amount: fromPaisa(a.amount) }));
  if (items.length > 0) await repo.insertAllocations(tx, req.business.id, payment.id, req.auth.user.id, items);
  return items;
}

// ------------------------------------------------------------------ create, read, list

export function create({ pool, req, kind }, body) {
  const k = KINDS[kind];
  return withTransaction(pool, async (tx) => {
    await lockPostableContact(tx, req, body.contactId);
    const referenceNo = await nextReference(tx, req.business.id, kind, body.txnDate);
    const id = await repo.insertPayment(tx, {
      businessId: req.business.id, userId: req.auth.user.id, type: kind, effect: k.effect, contactId: body.contactId,
      txnDate: body.txnDate, amount: body.amount, method: body.method, referenceNo,
      externalRef: body.externalRef, description: body.description, notes: body.notes,
    });
    let payment = await load(tx, req, kind, id, { forUpdate: true });
    let applied = [];
    if (body.autoAllocate) applied = await allocateOldestFirst(tx, req, kind, payment);
    else if (body.allocations?.length) {
      await allocate(tx, req, kind, payment, body.allocations);
      applied = body.allocations;
    }
    await audit(tx, req, kind, 'create', payment, {
      after: { referenceNo, contactId: body.contactId, txnDate: body.txnDate, amount: body.amount, method: body.method, allocatedTo: applied.length },
    });
    return loadFull(tx, req, kind, id);
  });
}

export const get = ({ pool, req, kind }, id) => loadFull(pool, req, kind, id);

export async function list({ pool, req, kind }, query) {
  const { rows, total } = await repo.listPayments(pool, req.business.id, kind, query);
  return { data: rows.map((row) => summary(row, req)), meta: { page: query.page, pageSize: query.pageSize, total } };
}

/** Invoices/bills of a contact that can still receive money, oldest first: the picker for "apply to…". */
export async function openDocuments({ pool, req, kind }, contactId) {
  const contact = await contactsRepo.findContact(pool, req.business.id, contactId);
  if (!contact) throw notFound('Contact not found');
  const today = todayInNepal();
  const rows = await repo.listOpenDocuments(pool, req.business.id, KINDS[kind].documentType, contactId);
  return rows.map((d) => ({
    id: d.id, referenceNo: d.reference_no, txnDate: d.txn_date, dueDate: d.due_date, description: d.description,
    total: d.total, paid: d.paid, outstanding: d.outstanding,
    overdue: isOverdue({ dueDate: d.due_date, outstanding: toPaisa(d.outstanding), today }),
  }));
}

// ------------------------------------------------------------------ change

/** Replaces what a receipt/payment is matched to. An empty list turns it all back into an advance. */
export function setAllocations({ pool, req, kind }, id, { allocations }) {
  return withTransaction(pool, async (tx) => {
    const payment = await load(tx, req, kind, id, { forUpdate: true });
    if (payment.status !== 'posted') throw conflict(`This ${KINDS[kind].noun} has been voided and cannot be changed`);
    const released = await repo.cancelAllocationsOfPayment(tx, req.business.id, id, req.auth.user.id);
    await allocate(tx, req, kind, { ...payment, allocated: '0.00' }, allocations);
    await audit(tx, req, kind, 'reallocate', payment, { before: { allocatedTo: released.length, allocated: payment.allocated }, after: { allocatedTo: allocations.length } });
    return loadFull(tx, req, kind, id);
  });
}

export function autoAllocate({ pool, req, kind }, id) {
  return withTransaction(pool, async (tx) => {
    const payment = await load(tx, req, kind, id, { forUpdate: true });
    if (payment.status !== 'posted') throw conflict(`This ${KINDS[kind].noun} has been voided and cannot be changed`);
    const applied = await allocateOldestFirst(tx, req, kind, payment);
    if (applied.length > 0) await audit(tx, req, kind, 'auto_allocate', payment, { after: { allocatedTo: applied.length } });
    return loadFull(tx, req, kind, id);
  });
}

export function updateText({ pool, req, kind }, id, changes) {
  return withTransaction(pool, async (tx) => {
    const before = await load(tx, req, kind, id, { forUpdate: true });
    if (before.status !== 'posted') throw conflict(`This ${KINDS[kind].noun} has been voided and cannot be changed`);
    await ledgerRepo.updateText(tx, { businessId: req.business.id, userId: req.auth.user.id, id, changes });
    const after = await load(tx, req, kind, id);
    const pick = (row) => ({ description: row.description, notes: row.notes, externalRef: row.external_ref });
    const keys = Object.keys(changes);
    await audit(tx, req, kind, 'update_text', after, {
      before: Object.fromEntries(keys.map((key) => [key, pick(before)[key]])),
      after: Object.fromEntries(keys.map((key) => [key, pick(after)[key]])),
    });
    return loadFull(tx, req, kind, id);
  });
}

/** Cancels the receipt/payment: its allocations are released first, so those invoices/bills become unpaid again. */
export function voidSettlement({ pool, req, kind }, id, { reason }) {
  return withTransaction(pool, async (tx) => {
    const row = await load(tx, req, kind, id, { forUpdate: true });
    if (row.status === 'voided') throw conflict(`This ${KINDS[kind].noun} has already been voided`);
    const released = await repo.cancelAllocationsOfPayment(tx, req.business.id, id, req.auth.user.id);
    await ledgerRepo.voidPosted(tx, { businessId: req.business.id, userId: req.auth.user.id, id, reason });
    await audit(tx, req, kind, 'void', row, { metadata: { reason, releasedAllocations: released.length } });
    return loadFull(tx, req, kind, id);
  });
}
