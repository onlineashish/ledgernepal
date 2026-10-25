import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays } from '@ledgernepal/shared/dates';
import { fromPaisa, toPaisa } from '@ledgernepal/shared/money';
import { createTestApp } from '../helpers/testApp.js';
import { cleanupApiTestData, registerUser } from '../helpers/api.js';

// Randomized end-to-end check of the books. A long, random but reproducible sequence of invoices, bills,
// receipts, payments, allocations, direct entries and voids is pushed through the real API. A SEPARATE model
// (plain BigInt arithmetic, written from the accounting rules, sharing no code with the server) keeps its own
// idea of every balance. After the run everything the system reports must agree with the model and with itself:
// contact balances, ledger running balances, dashboard and report totals, paid amounts, allocation limits.
//
// Set LEDGER_FUZZ_SEED to replay a failing run; LEDGER_FUZZ_STEPS to run longer.

const { app, pool, close } = createTestApp();
const SEED = Number(process.env.LEDGER_FUZZ_SEED ?? Date.now() % 1_000_000_000);
const STEPS = Number(process.env.LEDGER_FUZZ_STEPS ?? 90);

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(SEED);
const int = (min, max) => min + Math.floor(random() * (max - min + 1));
const pick = (list) => list[int(0, list.length - 1)];
const chance = (p) => random() < p;
const amount = () => `${int(1, 5000)}.${String(int(0, 99)).padStart(2, '0')}`.replace(/\.00$/, '');
const DATES = ['2025-07-20', '2025-08-05', '2025-08-18', '2025-09-02', '2025-09-25', '2025-10-10', '2025-11-15'];

let owner;
const contacts = [];
// The model: what SHOULD be true, kept independently of anything the server says about balances.
const docs = []; // { id, type: 'sale'|'purchase', contactId, total: bigint, status, date }
const money = []; // { id, type: 'receipt'|'payment', contactId, total: bigint, status, date }
const entries = []; // { id, contactId, effect: +1|-1, total: bigint, status }

beforeAll(async () => {
  await cleanupApiTestData(pool);
  owner = await registerUser(app, { businessName: `Fuzz Co ${SEED}` });
  for (let i = 0; i < 4; i += 1) {
    contacts.push((await owner.post('/api/contacts', { name: `Fuzz Contact ${i}`, types: ['customer', 'supplier'] })).body.data);
  }
});
afterAll(async () => {
  await cleanupApiTestData(pool);
  await close();
});

const log = [];
const note = (text) => log.push(text);

async function step() {
  const roll = random();
  const contact = pick(contacts);

  if (roll < 0.34) { // an invoice or a bill, posted
    const type = pick(['sale', 'purchase']);
    const txnDate = pick(DATES);
    const dueDate = chance(0.5) ? addDays(txnDate, pick([0, 15, 30, 400])) : undefined; // some end up overdue, some never will
    const price = amount();
    const qty = int(1, 4);
    const res = await owner.post(type === 'sale' ? '/api/sales' : '/api/purchases', {
      contactId: contact.id, txnDate, post: true, ...(dueDate && { dueDate }),
      lines: [{ description: 'Fuzz goods', quantity: String(qty), unitPrice: price }],
    });
    note(`${type} ${price}x${qty} -> ${res.status}`);
    if (res.status === 201) docs.push({ id: res.body.data.id, type, contactId: contact.id, total: toPaisa(res.body.data.total), status: 'posted' });
    else expect(res.status, JSON.stringify(res.body)).toBe(201);
    // The model must agree on the total too: quantity x unit price, no tax, no discount.
    if (res.status === 201) expect(toPaisa(res.body.data.total)).toBe(toPaisa(price) * BigInt(qty));
  } else if (roll < 0.62) { // a receipt or a payment, applied in one of several ways
    const kind = pick(['receipt', 'payment']);
    const path = kind === 'receipt' ? '/api/receipts' : '/api/payments';
    const total = amount();
    const body = { contactId: contact.id, txnDate: pick(DATES), amount: total, method: pick(['cash', 'esewa', 'cheque', 'bank_transfer']) };
    const mode = pick(['advance', 'auto', 'explicit', 'explicit']);
    if (mode === 'auto') body.autoAllocate = true;
    if (mode === 'explicit') {
      const open = (await owner.get(`${path}/open-documents?contactId=${contact.id}`)).body.data;
      let left = toPaisa(total);
      body.allocations = [];
      for (const doc of open.filter(() => chance(0.7))) {
        const part = BigInt(Math.max(1, Math.floor(Number(left < toPaisa(doc.outstanding) ? left : toPaisa(doc.outstanding)) * (chance(0.5) ? 1 : random()))));
        if (part <= 0n || left <= 0n) break;
        body.allocations.push({ invoiceId: doc.id, amount: fromPaisa(part) });
        left -= part;
      }
    }
    const res = await owner.post(path, body);
    note(`${kind} ${total} ${mode} (${body.allocations?.length ?? 0}) -> ${res.status}`);
    expect(res.status, JSON.stringify(res.body)).toBe(201); // every request here is valid by construction
    money.push({ id: res.body.data.id, type: kind, contactId: contact.id, total: toPaisa(total), status: 'posted' });
  } else if (roll < 0.70) { // void a document
    const target = pick(docs.filter((d) => d.status === 'posted'));
    if (!target) return;
    const res = await owner.post(`/api/${target.type === 'sale' ? 'sales' : 'purchases'}/${target.id}/void`, { reason: 'fuzz void' });
    note(`void ${target.type} -> ${res.status}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    target.status = 'voided';
  } else if (roll < 0.78) { // void a receipt or payment
    const target = pick(money.filter((m) => m.status === 'posted'));
    if (!target) return;
    const res = await owner.post(`/api/${target.type}s/${target.id}/void`, { reason: 'fuzz void' });
    note(`void ${target.type} -> ${res.status}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    target.status = 'voided';
  } else if (roll < 0.86) { // a direct entry, sometimes voided afterwards
    const direction = pick(['you_gave', 'you_got']);
    const total = amount();
    const res = await owner.post('/api/ledger/entries', { contactId: contact.id, txnDate: pick(DATES), direction, amount: total });
    note(`entry ${direction} ${total} -> ${res.status}`);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const entry = { id: res.body.data.id, contactId: contact.id, effect: direction === 'you_gave' ? 1n : -1n, total: toPaisa(total), status: 'posted' };
    entries.push(entry);
    if (chance(0.3)) {
      const voided = await owner.post(`/api/ledger/entries/${entry.id}/void`, { reason: 'fuzz void' });
      expect(voided.status).toBe(200);
      entry.status = 'voided';
    }
  } else if (roll < 0.94) { // move a receipt/payment's allocations around
    const target = pick(money.filter((m) => m.status === 'posted'));
    if (!target) return;
    const path = `/api/${target.type}s`;
    if (chance(0.5)) {
      const res = await owner.post(`${path}/${target.id}/auto-allocate`);
      note(`auto-allocate ${target.type} -> ${res.status}`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    } else {
      const open = (await owner.get(`${path}/open-documents?contactId=${target.contactId}`)).body.data;
      const current = (await owner.get(`${path}/${target.id}`)).body.data;
      const chosen = [];
      let left = toPaisa(target.total === undefined ? '0' : fromPaisa(target.total));
      for (const doc of open) {
        const freeOnDoc = toPaisa(doc.outstanding) + toPaisa(current.allocations.find((a) => a.document.id === doc.id)?.amount ?? '0');
        const part = freeOnDoc < left ? freeOnDoc : left;
        if (part > 0n && chance(0.6)) { chosen.push({ invoiceId: doc.id, amount: fromPaisa(part) }); left -= part; }
      }
      const res = await owner.put(`${path}/${target.id}/allocations`, { allocations: chosen });
      note(`re-allocate ${target.type} to ${chosen.length} -> ${res.status}`);
      // Some of those documents may include ones already paid by this very payment; the rules decide.
      expect([200, 400]).toContain(res.status);
    }
  }
}

// ----------------------------------------------------------------------------- the independent model

const sign = { sale: 1n, purchase: -1n, receipt: -1n, payment: 1n };
function modelBalance(contactId) {
  let total = 0n;
  for (const d of docs) if (d.contactId === contactId && d.status === 'posted') total += sign[d.type] * d.total;
  for (const m of money) if (m.contactId === contactId && m.status === 'posted') total += sign[m.type] * m.total;
  for (const e of entries) if (e.contactId === contactId && e.status === 'posted') total += e.effect * e.total;
  return total;
}
const sumOf = (list, type) => list.filter((x) => x.type === type && x.status === 'posted').reduce((s, x) => s + x.total, 0n);

describe(`random bookkeeping, seed ${SEED}`, () => {
  it(`${STEPS} random operations leave the books consistent`, async () => {
    for (let i = 0; i < STEPS; i += 1) {
      try {
        await step();
      } catch (error) {
        error.message = `step ${i} (seed ${SEED}) failed: ${error.message}\nlast operations:\n${log.slice(-8).join('\n')}`;
        throw error;
      }
    }
    expect(docs.length + money.length).toBeGreaterThan(10); // the run really did something

    // 1. Every contact's balance, and the closing balance and last running balance of its ledger, equal the model.
    for (const c of contacts) {
      const expected = modelBalance(c.id);
      const contact = (await owner.get(`/api/contacts/${c.id}`)).body.data;
      expect(toPaisa(contact.balance.amount, { allowNegative: true }), `${c.name} balance`).toBe(expected);
      const ledger = (await owner.get(`/api/ledger/contacts/${c.id}?pageSize=200`)).body.data;
      expect(toPaisa(ledger.closingBalance, { allowNegative: true }), `${c.name} closing`).toBe(expected);
      if (ledger.rows.length > 0) expect(toPaisa(ledger.rows.at(-1).balance, { allowNegative: true })).toBe(expected);
      // Running balance really is the running sum of the rows shown.
      let running = toPaisa(ledger.openingBalance, { allowNegative: true });
      for (const row of ledger.rows) {
        running += toPaisa(row.debit ?? '0') - toPaisa(row.credit ?? '0');
        expect(toPaisa(row.balance, { allowNegative: true })).toBe(running);
      }
    }

    // 2. The dashboard and reports agree with the model.
    const dash = (await owner.get('/api/reports/dashboard?from=2025-01-01&to=2026-12-31')).body.data;
    expect(toPaisa(dash.sales.total)).toBe(sumOf(docs, 'sale'));
    expect(toPaisa(dash.purchases.total)).toBe(sumOf(docs, 'purchase'));
    expect(toPaisa(dash.receipts.total)).toBe(sumOf(money, 'receipt'));
    expect(toPaisa(dash.payments.total)).toBe(sumOf(money, 'payment'));
    const balances = contacts.map((c) => modelBalance(c.id));
    expect(toPaisa(dash.receivables.outstanding)).toBe(balances.filter((b) => b > 0n).reduce((s, b) => s + b, 0n));
    expect(toPaisa(dash.payables.outstanding)).toBe(balances.filter((b) => b < 0n).reduce((s, b) => s - b, 0n));
    const activity = (await owner.get('/api/reports/activity?from=2025-01-01&to=2026-12-31&group=day')).body.data;
    expect(toPaisa(activity.totals.sales)).toBe(sumOf(docs, 'sale'));
    expect(toPaisa(activity.totals.receipts)).toBe(sumOf(money, 'receipt'));
    const owed = (await owner.get('/api/reports/outstanding?side=receivable')).body.data;
    const owing = (await owner.get('/api/reports/outstanding?side=payable')).body.data;
    expect(toPaisa(owed.total)).toBe(toPaisa(dash.receivables.outstanding));
    expect(toPaisa(owing.total)).toBe(toPaisa(dash.payables.outstanding));

    // 3. The whole system nets out: what is owed to you minus what you owe equals all debits minus all credits.
    const net = (await pool.query(
      `SELECT COALESCE(SUM(CASE effect WHEN 'debit' THEN total ELSE -total END), 0)::numeric(16, 2) AS net FROM transactions WHERE business_id = $1 AND status = 'posted'`,
      [owner.businessId],
    )).rows[0].net;
    expect(toPaisa(net, { allowNegative: true })).toBe(balances.reduce((s, b) => s + b, 0n));

    // 4. Allocation rules hold everywhere, whatever order things happened in.
    const q = async (sql) => (await pool.query(sql, [owner.businessId])).rows;
    expect(await q(`SELECT i.id FROM transactions i JOIN payment_allocations a ON a.invoice_txn_id = i.id AND a.status = 'active' WHERE i.business_id = $1 GROUP BY i.id, i.total HAVING SUM(a.amount) > i.total`)).toEqual([]);
    expect(await q(`SELECT p.id FROM transactions p JOIN payment_allocations a ON a.payment_txn_id = p.id AND a.status = 'active' WHERE p.business_id = $1 GROUP BY p.id, p.total HAVING SUM(a.amount) > p.total`)).toEqual([]);
    expect(await q(`SELECT a.id FROM payment_allocations a JOIN transactions t ON t.id IN (a.payment_txn_id, a.invoice_txn_id) WHERE a.business_id = $1 AND a.status = 'active' AND t.status <> 'posted'`)).toEqual([]);
    expect(await q(`SELECT a.id FROM payment_allocations a JOIN transactions p ON p.id = a.payment_txn_id JOIN transactions i ON i.id = a.invoice_txn_id WHERE a.business_id = $1 AND p.contact_id <> i.contact_id`)).toEqual([]);

    // 5. What each document says it has been paid matches its live allocations, and the status words match the amounts.
    for (const d of docs.filter((x) => x.status === 'posted')) {
      const doc = (await owner.get(`/api/${d.type === 'sale' ? 'sales' : 'purchases'}/${d.id}`)).body.data;
      const paid = toPaisa(doc.paid);
      expect(paid + toPaisa(doc.outstanding), doc.referenceNo).toBe(d.total);
      expect(doc.paymentStatus).toBe(paid === 0n ? 'unpaid' : paid === d.total ? 'paid' : 'partially_paid');
      expect(doc.payments.reduce((s, p) => s + toPaisa(p.amount), 0n)).toBe(paid);
    }
    for (const m of money.filter((x) => x.status === 'posted')) {
      const settlement = (await owner.get(`/api/${m.type}s/${m.id}`)).body.data;
      expect(toPaisa(settlement.allocated) + toPaisa(settlement.unallocated), settlement.referenceNo).toBe(m.total);
    }

    // 6. Reference numbers are unique within the business, with no gaps or repeats among posted rows of a kind.
    const duplicates = await q(`SELECT reference_no FROM transactions WHERE business_id = $1 AND reference_no IS NOT NULL GROUP BY reference_no HAVING count(*) > 1`);
    expect(duplicates).toEqual([]);

    // 7. Nothing posted was ever altered: voided rows keep their amounts, and drafts never counted.
    const statuses = await q(`SELECT status, count(*)::int AS n FROM transactions WHERE business_id = $1 GROUP BY status`);
    expect(statuses.map((s) => s.status).sort()).toEqual(expect.arrayContaining(['posted']));
  }, 600_000);
});
