import { isOverdue, paymentStatus } from '@ledgernepal/shared/allocation';
import { addDays, todayInNepal } from '@ledgernepal/shared/dates';
import { calculateDocument } from '@ledgernepal/shared/invoice';
import { MoneyError, fromPaisa, toPaisa } from '@ledgernepal/shared/money';
import { conflict, notFound, validationFailed } from '../../lib/errors.js';
import { writeAudit } from '../../lib/audit.js';
import { nextReference } from '../../lib/sequences.js';
import { withTransaction } from '../../db/pool.js';
import * as ledgerRepo from '../ledger/repo.js';
import * as settlementsRepo from '../settlements/repo.js';
import { lockPostableContact } from '../ledger/service.js';
import * as repo from './repo.js';

// The two kinds share every rule except these. A sale is a debit (the customer owes more), a purchase a
// credit (you owe more); see docs/accounting-conventions.md.
export const KINDS = {
  sale: { effect: 'debit', noun: 'sales invoice' },
  purchase: { effect: 'credit', noun: 'purchase bill' },
};

const canSeeCreators = (req) => req.business.permissions.has('users.view');

// ------------------------------------------------------------------ shaping

/** How much of a posted document has been paid. Drafts and voided documents have no payment status. */
function paymentInfo(row, today) {
  if (row.status !== 'posted') return { paid: null, outstanding: null, paymentStatus: null, overdue: false };
  const total = toPaisa(row.total);
  const paid = toPaisa(row.paid);
  return {
    paid: row.paid,
    outstanding: fromPaisa(total - paid),
    paymentStatus: paymentStatus(total, paid),
    overdue: isOverdue({ dueDate: row.due_date, outstanding: total - paid, today }),
  };
}

const header = (row, today = todayInNepal()) => ({
  id: row.id,
  status: row.status,
  referenceNo: row.reference_no,
  txnDate: row.txn_date,
  dueDate: row.due_date,
  externalRef: row.external_ref,
  description: row.description,
  contact: { id: row.contact_id, name: row.contact_name },
  total: row.total,
  ...paymentInfo(row, today),
  createdAt: row.created_at,
  postedAt: row.posted_at,
  voidedAt: row.voided_at,
});

function toDocument(row, lines, payments, req) {
  return {
    ...header(row),
    type: row.type,
    notes: row.notes,
    voidReason: row.void_reason,
    // The receipts / payments currently applied to this document.
    payments: payments.map((p) => ({ id: p.id, amount: p.amount, payment: { id: p.payment_id, type: p.type, referenceNo: p.reference_no, txnDate: p.txn_date, method: p.payment_method } })),
    createdBy: canSeeCreators(req) && row.created_by ? { id: row.created_by, fullName: row.created_by_name } : null,
    totals: {
      subtotal: row.subtotal,
      discount: row.discount_total,
      taxable: row.taxable_total,
      nonTaxable: row.non_taxable_total,
      tax: row.tax_total,
      total: row.total,
    },
    lines: lines.map((l) => ({
      lineNo: l.line_no,
      description: l.description,
      quantity: l.quantity,
      unit: l.unit,
      unitPrice: l.unit_price,
      grossAmount: l.gross_amount,
      discount: l.discount_amount,
      invoiceDiscountShare: l.invoice_discount_share,
      taxable: l.is_taxable,
      taxRate: l.tax_rate,
      taxableAmount: l.taxable_amount,
      taxAmount: l.tax_amount,
      lineTotal: l.line_total,
    })),
  };
}

const snapshot = (row) => ({ referenceNo: row.reference_no, contactId: row.contact_id, txnDate: row.txn_date, dueDate: row.due_date, total: row.total });

const audit = (tx, req, type, action, row, extra = {}) =>
  writeAudit(tx, {
    req,
    businessId: req.business.id,
    actorUserId: req.auth.user.id,
    action: `${type}.${action}`,
    entityType: 'transaction',
    entityId: row.id,
    ...extra,
  });

async function load(db, req, type, id, { forUpdate = false } = {}) {
  const row = await repo.findDocument(db, req.business.id, type, id, { forUpdate });
  if (!row) throw notFound(`${KINDS[type].noun[0].toUpperCase()}${KINDS[type].noun.slice(1)} not found`); // also what another business's looks like
  return row;
}

async function loadFull(db, req, type, id) {
  const row = await load(db, req, type, id);
  const [lines, payments] = await Promise.all([repo.findLines(db, req.business.id, id), repo.findPayments(db, req.business.id, id)]);
  return toDocument(row, lines, payments, req);
}

// ------------------------------------------------------------------ building a document from a request

/**
 * Turns the request into stored values: decides each line's VAT rate, adds everything up with the shared
 * rules, and works out the due date. Every refusal names the input at fault. Nothing is assumed about VAT:
 * a taxable line needs the business to be VAT-registered and needs a rate (its own, or the business default).
 */
function build(settings, input) {
  const problems = [];
  input.lines.forEach((l, i) => {
    if (l.taxable) {
      if (!settings.is_vat_registered) {
        problems.push({ field: `lines.${i}.taxable`, message: 'Your business is not set up for VAT. Turn on VAT in Settings first.' });
      } else if ((l.taxRate ?? settings.default_vat_rate) == null) {
        problems.push({ field: `lines.${i}.taxRate`, message: 'Enter a VAT rate for this line, or set a default rate in Settings' });
      }
    } else if (l.taxRate != null) {
      problems.push({ field: `lines.${i}.taxRate`, message: 'A VAT rate was given for a line that is not taxable' });
    }
  });

  const dueDate = resolveDueDate(settings, input);
  if (dueDate && dueDate < input.txnDate) problems.push({ field: 'dueDate', message: 'The due date cannot be before the document date' });
  if (problems.length) throw validationFailed(problems);

  const rates = input.lines.map((l) => (l.taxable ? String(l.taxRate ?? settings.default_vat_rate) : null));
  let calculated;
  try {
    calculated = calculateDocument({
      lines: input.lines.map((l, i) => ({ quantity: l.quantity, unitPrice: toPaisa(l.unitPrice), discount: toPaisa(l.discount ?? '0'), taxRate: rates[i] })),
      invoiceDiscount: toPaisa(input.invoiceDiscount ?? '0'),
    });
    for (const value of Object.values(calculated.totals)) fromPaisa(value); // must fit the database's NUMERIC(14,2)
    calculated.lines.forEach((l) => [l.gross, l.net, l.tax, l.total].forEach(fromPaisa));
  } catch (err) {
    if (err instanceof MoneyError) throw validationFailed([{ field: err.field ?? 'lines', message: err.message }]);
    throw err;
  }

  const money = fromPaisa;
  const lines = input.lines.map((l, i) => {
    const r = calculated.lines[i];
    return {
      lineNo: i + 1,
      description: l.description,
      quantity: l.quantity,
      unit: l.unit ?? null,
      unitPrice: money(toPaisa(l.unitPrice)),
      gross: money(r.gross),
      discount: money(r.discount),
      share: money(r.invoiceDiscountShare),
      isTaxable: l.taxable,
      taxRate: rates[i],
      taxable: money(r.taxable),
      tax: money(r.tax),
      total: money(r.total),
    };
  });
  const t = calculated.totals;
  const totals = { subtotal: money(t.subtotal), discount: money(t.discount), taxable: money(t.taxable), nonTaxable: money(t.nonTaxable), tax: money(t.tax), total: money(t.total) };
  const first = input.lines[0].description;
  const description = `${first.length > 120 ? `${first.slice(0, 117)}...` : first}${input.lines.length > 1 ? ` +${input.lines.length - 1} more` : ''}`;
  return { lines, totals, dueDate, description };
}

/** An explicit due date wins ("null" = none); otherwise the business's credit days, if it has set any. */
function resolveDueDate(settings, input) {
  if (input.dueDate !== undefined) return input.dueDate;
  return settings.default_credit_days == null ? null : addDays(input.txnDate, settings.default_credit_days);
}

// ------------------------------------------------------------------ create, read, list

export function create({ pool, req, type }, body) {
  return withTransaction(pool, async (tx) => {
    await lockPostableContact(tx, req, body.contactId);
    const built = build(await repo.getTaxSettings(tx, req.business.id), body);
    const id = await repo.insertDraft(tx, {
      businessId: req.business.id, userId: req.auth.user.id, type, effect: KINDS[type].effect,
      contactId: body.contactId, txnDate: body.txnDate, dueDate: built.dueDate, externalRef: body.externalRef, notes: body.notes,
      description: built.description, totals: built.totals,
    });
    await repo.replaceLines(tx, req.business.id, id, built.lines);
    await audit(tx, req, type, 'create_draft', { id }, { after: { contactId: body.contactId, txnDate: body.txnDate, total: built.totals.total, lines: built.lines.length } });
    if (body.post) await postInTx(tx, req, type, id);
    return loadFull(tx, req, type, id);
  });
}

export const get = ({ pool, req, type }, id) => loadFull(pool, req, type, id);

export async function list({ pool, req, type }, query) {
  const today = todayInNepal(); // "overdue" means past its due date as of today in Nepal
  const { rows, total } = await repo.listDocuments(pool, req.business.id, type, { ...query, today });
  return { data: rows.map((row) => header(row, today)), meta: { page: query.page, pageSize: query.pageSize, total } };
}

// ------------------------------------------------------------------ change

/**
 * A DRAFT can be changed freely: send the lines again (with the invoice discount) to change amounts.
 * A POSTED document is history: only its notes and reference may be edited; anything else means
 * voiding it and entering a new one.
 */
export function update({ pool, req, type }, id, body) {
  return withTransaction(pool, async (tx) => {
    const row = await load(tx, req, type, id, { forUpdate: true });

    if (row.status === 'voided') throw conflict('This document has been voided and cannot be changed');
    if (row.status === 'posted') {
      const forbidden = Object.keys(body).filter((k) => !['notes', 'externalRef'].includes(k));
      if (forbidden.length > 0) {
        throw conflict(`A posted ${KINDS[type].noun} cannot be changed except for its notes and reference. Void it and enter a new one.`);
      }
      await ledgerRepo.updateText(tx, { businessId: req.business.id, userId: req.auth.user.id, id, changes: body });
      const after = await load(tx, req, type, id);
      await audit(tx, req, type, 'update_text', after, {
        before: Object.fromEntries(Object.keys(body).map((k) => [k, k === 'notes' ? row.notes : row.external_ref])),
        after: Object.fromEntries(Object.keys(body).map((k) => [k, k === 'notes' ? after.notes : after.external_ref])),
      });
      return loadFull(tx, req, type, id);
    }

    if (body.invoiceDiscount !== undefined && body.lines === undefined) {
      throw validationFailed([{ field: 'lines', message: 'Send the lines again when you change the invoice discount' }]);
    }
    const contactId = body.contactId ?? row.contact_id;
    if (contactId !== row.contact_id) await lockPostableContact(tx, req, contactId);
    const txnDate = body.txnDate ?? row.txn_date;
    // Not sent = keep it; null = no due date; a date = that date. (The credit-days default only applies when a document is first created.)
    const dueDate = body.dueDate !== undefined ? body.dueDate : row.due_date;

    let totals;
    let description = row.description;
    let finalDue = dueDate;
    if (body.lines) {
      const built = build(await repo.getTaxSettings(tx, req.business.id), { txnDate, dueDate, lines: body.lines, invoiceDiscount: body.invoiceDiscount });
      await repo.replaceLines(tx, req.business.id, id, built.lines);
      totals = built.totals;
      description = built.description;
      finalDue = built.dueDate;
    } else {
      if (finalDue && finalDue < txnDate) throw validationFailed([{ field: 'dueDate', message: 'The due date cannot be before the document date' }]);
      totals = { subtotal: row.subtotal, discount: row.discount_total, taxable: row.taxable_total, nonTaxable: row.non_taxable_total, tax: row.tax_total, total: row.total };
    }

    await repo.updateDraftHeader(tx, {
      businessId: req.business.id, userId: req.auth.user.id, id, contactId, txnDate, dueDate: finalDue,
      externalRef: body.externalRef !== undefined ? body.externalRef : row.external_ref,
      notes: body.notes !== undefined ? body.notes : row.notes,
      description, totals,
    });
    await audit(tx, req, type, 'update_draft', row, { before: { total: row.total, txnDate: row.txn_date }, after: { total: totals.total, txnDate } });
    return loadFull(tx, req, type, id);
  });
}

export function deleteDraft({ pool, req, type }, id) {
  return withTransaction(pool, async (tx) => {
    const row = await load(tx, req, type, id, { forUpdate: true });
    if (row.status !== 'draft') {
      throw conflict(row.status === 'posted' ? `A posted ${KINDS[type].noun} cannot be deleted. Void it instead.` : 'This document has been voided and is kept for the record');
    }
    await repo.deleteDraft(tx, req.business.id, id);
    await audit(tx, req, type, 'delete_draft', row, { before: snapshot(row) });
    return { deleted: true };
  });
}

// ------------------------------------------------------------------ post and void

async function postInTx(tx, req, type, id) {
  const row = await load(tx, req, type, id, { forUpdate: true });
  if (row.status !== 'draft') {
    throw conflict(row.status === 'posted' ? `This ${KINDS[type].noun} is already posted` : 'This document has been voided');
  }
  const lines = await repo.findLines(tx, req.business.id, id);
  if (lines.length === 0) throw validationFailed([{ field: 'lines', message: 'Add at least one line before posting' }]);
  if (toPaisa(row.total) <= 0n) throw validationFailed([{ field: 'lines', message: 'The total must be greater than zero to post' }]);

  await lockPostableContact(tx, req, row.contact_id); // may have been archived since the draft was saved
  const referenceNo = await nextReference(tx, req.business.id, type, row.txn_date);
  await repo.markPosted(tx, { businessId: req.business.id, userId: req.auth.user.id, id, referenceNo });
  await audit(tx, req, type, 'post', row, { after: { referenceNo, contactId: row.contact_id, txnDate: row.txn_date, total: row.total } });
}

export function post({ pool, req, type }, id) {
  return withTransaction(pool, async (tx) => {
    await postInTx(tx, req, type, id);
    return loadFull(tx, req, type, id);
  });
}

export function voidDocument({ pool, req, type }, id, { reason }) {
  return withTransaction(pool, async (tx) => {
    const row = await load(tx, req, type, id, { forUpdate: true });
    if (row.status === 'draft') throw conflict('A draft is deleted, not voided');
    if (row.status === 'voided') throw conflict('This document has already been voided');
    // Money applied to this document is released first: those receipts/payments go back to being advances.
    const released = await settlementsRepo.cancelAllocationsOfDocument(tx, req.business.id, id, req.auth.user.id);
    await ledgerRepo.voidPosted(tx, { businessId: req.business.id, userId: req.auth.user.id, id, reason });
    await audit(tx, req, type, 'void', row, {
      before: snapshot(row),
      metadata: { reason, releasedPayments: released.length, releasedAmount: fromPaisa(released.reduce((sum, r) => sum + toPaisa(r.amount), 0n)) },
    });
    return loadFull(tx, req, type, id);
  });
}
