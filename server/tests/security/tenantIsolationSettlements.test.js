import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../helpers/testApp.js';
import { cleanupApiTestData, registerUser } from '../helpers/api.js';

// Business A's user attacks Business B's receipts, payments, allocations and reports: ids in URLs, B's contact
// or invoice named in A's own request, and direct database writes. Nothing may be read or changed.

const { app, pool, close } = createTestApp();
let a;
let b;
let aContact;
let bContact;
let aInvoice;
let bInvoice;
const b_ = { receipt: null, payment: null }; // B's settlements
const KIND = { receipt: { path: '/api/receipts', doc: '/api/sales' }, payment: { path: '/api/payments', doc: '/api/purchases' } };
const NIL = '00000000-0000-4000-8000-000000000000';
const SECRET = 'Zorblax';

const bBooks = async () =>
  (await pool.query('SELECT id, type, status, total, contact_id, reference_no, notes, payment_method FROM transactions WHERE business_id = $1 ORDER BY id', [b.businessId])).rows;
const bAllocations = async () =>
  (await pool.query('SELECT id, payment_txn_id, invoice_txn_id, amount, status FROM payment_allocations WHERE business_id = $1 ORDER BY id', [b.businessId])).rows;

beforeAll(async () => {
  await cleanupApiTestData(pool);
  a = await registerUser(app, { businessName: 'Settle A' });
  b = await registerUser(app, { businessName: 'Settle B' });
  aContact = (await a.post('/api/contacts', { name: 'A Customer', types: ['customer', 'supplier'] })).body.data;
  bContact = (await b.post('/api/contacts', { name: `${SECRET} Client`, types: ['customer', 'supplier'] })).body.data;
  aInvoice = (await a.post('/api/sales', { contactId: aContact.id, txnDate: '2025-08-01', post: true, lines: [{ description: 'x', quantity: '1', unitPrice: '100' }] })).body.data;
  bInvoice = (await b.post('/api/sales', { contactId: bContact.id, txnDate: '2025-08-01', post: true, lines: [{ description: `${SECRET} goods`, quantity: '1', unitPrice: '777' }] })).body.data;
  for (const kind of ['receipt', 'payment']) {
    const doc = kind === 'receipt' ? bInvoice : (await b.post('/api/purchases', { contactId: bContact.id, txnDate: '2025-08-01', post: true, lines: [{ description: 'bill', quantity: '1', unitPrice: '500' }] })).body.data;
    b_[kind] = (await b.post(KIND[kind].path, { contactId: bContact.id, txnDate: '2025-08-05', amount: '300', method: 'cash', notes: `B private ${kind}`, allocations: [{ invoiceId: doc.id, amount: '200' }] })).body.data;
  }
});
afterAll(async () => {
  await cleanupApiTestData(pool);
  await close();
});

describe.each(['receipt', 'payment'])('A cannot touch B’s %ss', (kind) => {
  const { path } = KIND[kind];

  it('reads nothing: the answer is the same as for an id that does not exist', async () => {
    const real = await a.get(`${path}/${b_[kind].id}`);
    const fake = await a.get(`${path}/${NIL}`);
    expect(real.status).toBe(404);
    expect(real.body.error.message).toBe(fake.body.error.message);
    expect(JSON.stringify(real.body)).not.toMatch(new RegExp(`${SECRET}|B private|300`));
    expect(JSON.stringify((await a.get(path)).body)).not.toMatch(new RegExp(`${SECRET}|B private`));
  });

  it('changes nothing: every write is 404, and B’s books and allocations are untouched', async () => {
    const [books, allocations] = [await bBooks(), await bAllocations()];
    const id = b_[kind].id;
    const attempts = [
      await a.patch(`${path}/${id}`, { notes: 'defaced' }),
      await a.put(`${path}/${id}/allocations`, { allocations: [] }),
      await a.post(`${path}/${id}/auto-allocate`),
      await a.post(`${path}/${id}/void`, { reason: 'attack on another business' }),
    ];
    expect(attempts.map((r) => r.status)).toEqual([404, 404, 404, 404]);
    expect(await bBooks()).toEqual(books);
    expect(await bAllocations()).toEqual(allocations);
  });

  it('cannot record one for B’s contact, nor see B’s open documents', async () => {
    const before = await bBooks();
    const res = await a.post(path, { contactId: bContact.id, txnDate: '2025-08-10', amount: '10', method: 'cash' });
    expect(res.status).toBe(404);
    expect((await a.get(`${path}/open-documents?contactId=${bContact.id}`)).status).toBe(404);
    expect(await bBooks()).toEqual(before);
    expect((await pool.query('SELECT 1 FROM transactions WHERE business_id = $1 AND contact_id = $2', [a.businessId, bContact.id])).rowCount).toBe(0);
  });

  it('cannot apply A’s money to B’s invoice or bill (404), and nothing is recorded', async () => {
    const mine = (await a.post(path, { contactId: aContact.id, txnDate: '2025-08-10', amount: '50', method: 'cash' })).body.data;
    const targets = kind === 'receipt' ? [bInvoice.id] : [(await pool.query("SELECT id FROM transactions WHERE business_id = $1 AND type = 'purchase' LIMIT 1", [b.businessId])).rows[0].id];
    const before = await bAllocations();
    for (const invoiceId of targets) {
      expect((await a.post(path, { contactId: aContact.id, txnDate: '2025-08-10', amount: '10', method: 'cash', allocations: [{ invoiceId, amount: '10' }] })).status).toBe(404);
      expect((await a.put(`${path}/${mine.id}/allocations`, { allocations: [{ invoiceId, amount: '10' }] })).status).toBe(404);
    }
    expect(await bAllocations()).toEqual(before);
    expect((await a.get(`${path}/${mine.id}`)).body.data.allocations).toEqual([]);
  });

  it('the database itself refuses an allocation that crosses businesses, even written directly', async () => {
    const mine = (await a.post(path, { contactId: aContact.id, txnDate: '2025-08-10', amount: '50', method: 'cash' })).body.data;
    const bDoc = (await pool.query('SELECT id FROM transactions WHERE business_id = $1 AND type = $2 LIMIT 1', [b.businessId, kind === 'receipt' ? 'sale' : 'purchase'])).rows[0].id;
    await expect(
      pool.query(
        `INSERT INTO payment_allocations (business_id, payment_txn_id, invoice_txn_id, amount, created_by) VALUES ($1, $2, $3, 10, $4)`,
        [a.businessId, mine.id, bDoc, a.user.id],
      ),
    ).rejects.toThrow();
    await expect(
      pool.query(
        `INSERT INTO payment_allocations (business_id, payment_txn_id, invoice_txn_id, amount, created_by) VALUES ($1, $2, $3, 10, $4)`,
        [b.businessId, mine.id, bDoc, a.user.id],
      ),
    ).rejects.toThrow();
  });
});

describe('A’s paid status never reflects B’s money', () => {
  it('A’s invoice stays unpaid whatever B records', async () => {
    const doc = (await a.get(`/api/sales/${aInvoice.id}`)).body.data;
    expect(doc).toMatchObject({ paid: '0.00', outstanding: '100.00', paymentStatus: 'unpaid', payments: [] });
  });

  it('B’s invoice list shows B’s payments only', async () => {
    const list = (await b.get('/api/sales?payment=open')).body.data;
    expect(list.map((d) => d.id)).toContain(bInvoice.id);
    expect(JSON.stringify((await a.get('/api/sales')).body)).not.toContain(bInvoice.id);
  });
});

describe('reports only ever use the caller’s own business', () => {
  it('the dashboard, activity and outstanding reports carry none of B’s figures or names', async () => {
    const seen = [
      await a.get('/api/reports/dashboard?from=2025-08-01&to=2025-08-31'),
      await a.get('/api/reports/activity?from=2025-08-01&to=2025-08-31&group=day'),
      await a.get('/api/reports/outstanding?side=receivable'),
      await a.get('/api/reports/outstanding?side=payable'),
      await a.get('/api/reports/overdue?side=receivable'),
      await a.get('/api/reports/outstanding?side=receivable&format=csv'),
    ];
    for (const res of seen) {
      expect(res.status).toBe(200);
      expect(res.text).not.toContain(SECRET);
    }
    const dash = seen[0].body.data;
    expect(dash.sales.total).toBe('100.00'); // A's only invoice, not B's 777
    const ownReceipts = await pool.query("SELECT COALESCE(SUM(total), 0)::numeric(16, 2) AS total FROM transactions WHERE business_id = $1 AND type = 'receipt' AND status = 'posted'", [a.businessId]);
    expect(dash.receipts.total).toBe(ownReceipts.rows[0].total); // A's own receipts only, never B's 300
  });

  it('the contact-account export of B’s contact is a 404 for A', async () => {
    expect((await a.get(`/api/ledger/contacts/${bContact.id}/export`)).status).toBe(404);
  });
});
