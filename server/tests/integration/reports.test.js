import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { todayInNepal } from '@ledgernepal/shared/dates';
import { createTestApp } from '../helpers/testApp.js';
import { cleanupApiTestData, createMemberSession, registerUser } from '../helpers/api.js';

const { app, pool, close } = createTestApp();
let owner;
let other;
let customer;
let customer2;
let supplier;
let overdueInvoice;

const contact = async (session, name, types) => (await session.post('/api/contacts', { name, types })).body.data;
const lines = (amount) => [{ description: 'Goods', quantity: '1', unitPrice: amount }];
const sale = async (c, amount, date, extra = {}) => (await owner.post('/api/sales', { contactId: c.id, txnDate: date, post: true, lines: lines(amount), ...extra })).body.data;
const purchase = async (c, amount, date, extra = {}) => (await owner.post('/api/purchases', { contactId: c.id, txnDate: date, post: true, lines: lines(amount), ...extra })).body.data;
const money = async (path, c, amount, date, extra = {}) => (await owner.post(path, { contactId: c.id, txnDate: date, amount, method: 'cash', ...extra })).body.data;

beforeAll(async () => {
  await cleanupApiTestData(pool);
  owner = await registerUser(app, { businessName: 'Reports Co' });
  other = await registerUser(app, { businessName: 'Other Reports Co' });
  customer = await contact(owner, 'Ram Traders', ['customer']);
  customer2 = await contact(owner, '=HYPERLINK("http://evil.example")', ['customer']);
  supplier = await contact(owner, 'Hari Supplies', ['supplier']);

  // Customer: sales 1000 (Aug 2025, due 2025-08-20, overdue) + 400 (Sep 2025, no due date), receipt 300 against the first.
  overdueInvoice = await sale(customer, '1000', '2025-08-05', { dueDate: '2025-08-20' });
  await sale(customer, '400', '2025-09-10');
  await money('/api/receipts', customer, '300', '2025-08-25', { allocations: [{ invoiceId: overdueInvoice.id, amount: '300' }] });
  // Customer 2: one small overdue invoice, nothing paid.
  await sale(customer2, '50', '2025-08-06', { dueDate: '2025-08-07' });
  // Supplier: bill 500 (due 2025-08-15, overdue), payment 100 against it.
  const bill = await purchase(supplier, '500', '2025-08-08', { dueDate: '2025-08-15' });
  await money('/api/payments', supplier, '100', '2025-08-12', { allocations: [{ invoiceId: bill.id, amount: '100' }] });
  // Things that must NOT count: a draft, and a voided invoice.
  await owner.post('/api/sales', { contactId: customer.id, txnDate: '2025-08-07', lines: lines('9999') });
  const voided = await sale(customer, '7777', '2025-08-09');
  await owner.post(`/api/sales/${voided.id}/void`, { reason: 'entered by mistake' });
  // Another business with its own big numbers.
  const stranger = await contact(other, 'Stranger', ['customer']);
  await other.post('/api/sales', { contactId: stranger.id, txnDate: '2025-08-05', post: true, lines: lines('123456') });
});
afterAll(async () => {
  await cleanupApiTestData(pool);
  await close();
});

const august = 'from=2025-08-01&to=2025-08-31';

describe('GET /api/reports/dashboard', () => {
  it('totals the period from posted records only: no drafts, no voided documents, no other business', async () => {
    const res = await owner.get(`/api/reports/dashboard?${august}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      period: { from: '2025-08-01', to: '2025-08-31' },
      sales: { total: '1050.00', count: 2 },
      purchases: { total: '500.00', count: 1 },
      receipts: { total: '300.00', count: 1 },
      payments: { total: '100.00', count: 1 },
    });
  });

  it('a wider period adds the September sale', async () => {
    const res = await owner.get('/api/reports/dashboard?from=2025-08-01&to=2025-09-30');
    expect(res.body.data.sales).toMatchObject({ total: '1450.00', count: 3 });
  });

  it('receivables and payables are today’s balances, whatever the period', async () => {
    const res = await owner.get(`/api/reports/dashboard?from=2030-01-01&to=2030-01-02`);
    // customer 1000+400-300 = 1100, customer2 50 -> 1150 owed to us; supplier 500-100 = 400 we owe
    expect(res.body.data.sales.total).toBe('0.00');
    expect(res.body.data.receivables).toMatchObject({ outstanding: '1150.00', contacts: 2 });
    expect(res.body.data.payables).toMatchObject({ outstanding: '400.00', contacts: 1 });
  });

  it('overdue is what is still owed on documents past their due date', async () => {
    const { receivables, payables } = (await owner.get(`/api/reports/dashboard?${august}`)).body.data;
    expect(receivables).toMatchObject({ overdue: '750.00', overdueCount: 2 }); // 700 left on the first invoice + 50
    expect(payables).toMatchObject({ overdue: '400.00', overdueCount: 1 });
  });

  it('lists the most recent transactions, newest first, never drafts or voided ones', async () => {
    const { recent } = (await owner.get('/api/reports/dashboard')).body.data;
    expect(recent.length).toBeGreaterThan(0);
    expect(recent.length).toBeLessThanOrEqual(10);
    expect(recent.map((r) => r.amount)).not.toContain('9999.00');
    expect(recent.map((r) => r.amount)).not.toContain('7777.00');
    expect(recent[0]).toMatchObject({ type: 'payment', amount: '100.00', contact: { name: 'Hari Supplies' } });
  });

  it('defaults to the current fiscal year', async () => {
    const today = todayInNepal();
    const mine = await registerUser(app, { businessName: 'Default Period Co' });
    const c = (await mine.post('/api/contacts', { name: 'Anyone', types: ['customer'] })).body.data;
    await mine.post('/api/sales', { contactId: c.id, txnDate: today, post: true, lines: lines('250') });
    await mine.post('/api/sales', { contactId: c.id, txnDate: '2020-01-01', post: true, lines: lines('999') });
    const res = await mine.get('/api/reports/dashboard');
    expect(res.body.data.sales).toMatchObject({ total: '250.00', count: 1 });
    expect(res.body.data.period.fiscalYear).toMatch(/^\d{4}\/\d{2}$/);
  });

  it('other businesses see none of it', async () => {
    const res = await other.get(`/api/reports/dashboard?${august}`);
    expect(res.body.data.sales.total).toBe('123456.00');
    expect(res.body.data.receipts.total).toBe('0.00');
    expect(res.body.data.payables.outstanding).toBe('0.00');
  });

  it('rejects a backwards period and unknown parameters', async () => {
    expect((await owner.get('/api/reports/dashboard?from=2025-09-01&to=2025-08-01')).status).toBe(400);
    expect((await owner.get('/api/reports/dashboard?businessId=x')).status).toBe(400);
    expect((await owner.get('/api/reports/dashboard?from=2025-02-30')).status).toBe(400);
  });

  it('the receivable figure equals what the contact balances add up to', async () => {
    const dash = (await owner.get('/api/reports/dashboard')).body.data;
    const all = (await owner.get('/api/contacts?pageSize=100')).body.data;
    const owed = all.filter((c) => c.balance.side === 'receivable').reduce((s, c) => s + Number(c.balance.amount), 0);
    const owing = all.filter((c) => c.balance.side === 'payable').reduce((s, c) => s - Number(c.balance.amount), 0);
    expect(Number(dash.receivables.outstanding)).toBeCloseTo(owed, 2);
    expect(Number(dash.payables.outstanding)).toBeCloseTo(owing, 2);
  });
});

describe('GET /api/reports/activity', () => {
  it('groups by month in the business’s calendar (Bikram Sambat by default), with totals', async () => {
    const res = await owner.get('/api/reports/activity?from=2025-08-01&to=2025-09-30&group=month');
    expect(res.status).toBe(200);
    expect(res.body.data.rows.map((r) => r.period)).toEqual(['Shrawan 2082', 'Bhadra 2082']);
    // Shrawan runs to about 16 August, so the 25 August receipt and the September sale are in Bhadra.
    expect(res.body.data.rows[0]).toMatchObject({ sales: '1050.00', salesCount: 2, purchases: '500.00', receipts: '0.00', payments: '100.00' });
    expect(res.body.data.rows[1]).toMatchObject({ sales: '400.00', purchases: '0.00', receipts: '300.00', payments: '0.00' });
    expect(res.body.data.totals).toMatchObject({ sales: '1450.00', purchases: '500.00', receipts: '300.00', payments: '100.00' });
  });

  it('groups by AD month when the business uses AD', async () => {
    const ad = await registerUser(app, { businessName: 'AD Reports Co' });
    await ad.patch('/api/settings', { dateDisplay: 'AD' });
    const c = (await ad.post('/api/contacts', { name: 'X', types: ['customer'] })).body.data;
    await ad.post('/api/sales', { contactId: c.id, txnDate: '2025-08-05', post: true, lines: lines('10') });
    const res = await ad.get('/api/reports/activity?from=2025-08-01&to=2025-08-31');
    expect(res.body.data.rows.map((r) => r.period)).toEqual(['2025-08']);
  });

  it('groups by day, in date order', async () => {
    const res = await owner.get('/api/reports/activity?from=2025-08-01&to=2025-08-31&group=day');
    const days = res.body.data.rows.map((r) => r.period);
    expect(days).toEqual([...days].sort());
    expect(days).toContain('2025-08-05');
    expect(res.body.data.rows.find((r) => r.period === '2025-08-12')).toMatchObject({ payments: '100.00', sales: '0.00' });
  });

  it('shows the VAT of sales and purchases', async () => {
    const vat = await registerUser(app, { businessName: 'VAT Reports Co' });
    await vat.patch('/api/settings', { isVatRegistered: true, defaultVatRate: '13' });
    const c = (await vat.post('/api/contacts', { name: 'V', types: ['customer'] })).body.data;
    await vat.post('/api/sales', { contactId: c.id, txnDate: '2025-08-05', post: true, lines: [{ description: 'Goods', quantity: '1', unitPrice: '1000', taxable: true }] });
    const res = await vat.get('/api/reports/activity?from=2025-08-01&to=2025-08-31');
    expect(res.body.data.rows[0]).toMatchObject({ sales: '1130.00', salesVat: '130.00' });
  });

  it('rejects an unknown grouping', async () => {
    expect((await owner.get('/api/reports/activity?group=year')).status).toBe(400);
  });
});

describe('GET /api/reports/outstanding', () => {
  it('lists who owes you, biggest first, with the overdue part and a total', async () => {
    const res = await owner.get('/api/reports/outstanding?side=receivable');
    expect(res.status).toBe(200);
    expect(res.body.data.rows.map((r) => [r.contact.name, r.balance, r.overdue])).toEqual([
      ['Ram Traders', '1100.00', '700.00'],
      ['=HYPERLINK("http://evil.example")', '50.00', '50.00'],
    ]);
    expect(res.body.data).toMatchObject({ total: '1150.00', totalOverdue: '750.00' });
  });

  it('lists what you owe, as positive amounts', async () => {
    const res = await owner.get('/api/reports/outstanding?side=payable');
    expect(res.body.data.rows.map((r) => [r.contact.name, r.balance])).toEqual([['Hari Supplies', '400.00']]);
  });

  it('an advance paid by a customer shows up as something you owe them', async () => {
    const adv = await registerUser(app, { businessName: 'Advance Reports Co' });
    const c = (await adv.post('/api/contacts', { name: 'Prepaid Pasal', types: ['customer'] })).body.data;
    await adv.post('/api/receipts', { contactId: c.id, txnDate: '2025-08-01', amount: '500', method: 'cash' });
    expect((await adv.get('/api/reports/outstanding?side=receivable')).body.data.rows).toEqual([]);
    expect((await adv.get('/api/reports/outstanding?side=payable')).body.data.rows[0]).toMatchObject({ contact: { name: 'Prepaid Pasal' }, balance: '500.00' });
  });

  it('searches by name, treating % literally', async () => {
    expect((await owner.get('/api/reports/outstanding?side=receivable&q=ram')).body.data.rows).toHaveLength(1);
    expect((await owner.get(`/api/reports/outstanding?side=receivable&q=${encodeURIComponent('%')}`)).body.data.rows).toHaveLength(0);
  });

  it('needs a side, and settled contacts do not appear', async () => {
    expect((await owner.get('/api/reports/outstanding')).status).toBe(400);
    const mine = await registerUser(app, { businessName: 'Settled Reports Co' });
    const c = (await mine.post('/api/contacts', { name: 'Settled Co', types: ['customer'] })).body.data;
    await mine.post('/api/sales', { contactId: c.id, txnDate: '2025-08-01', post: true, lines: lines('10') });
    await mine.post('/api/receipts', { contactId: c.id, txnDate: '2025-08-02', amount: '10', method: 'cash' });
    const names = (await mine.get('/api/reports/outstanding?side=receivable')).body.data.rows.map((r) => r.contact.name);
    expect(names).not.toContain('Settled Co');
  });

  it('never shows another business’s contacts', async () => {
    expect((await other.get('/api/reports/outstanding?side=receivable')).body.data.rows.map((r) => r.contact.name)).toEqual(['Stranger']);
  });
});

describe('GET /api/reports/overdue', () => {
  it('lists documents past their due date that still owe money, oldest due first, with days overdue', async () => {
    const res = await owner.get('/api/reports/overdue?side=receivable');
    expect(res.status).toBe(200);
    const rows = res.body.data.rows;
    expect(rows.map((r) => [r.contact.name, r.outstanding, r.total, r.paid])).toEqual([
      ['=HYPERLINK("http://evil.example")', '50.00', '50.00', '0.00'],
      ['Ram Traders', '700.00', '1000.00', '300.00'],
    ]);
    expect(rows[1]).toMatchObject({ id: overdueInvoice.id, dueDate: '2025-08-20' });
    expect(rows[1].daysOverdue).toBeGreaterThan(300);
    expect(res.body.data.total).toBe('750.00');
  });

  it('payables use purchase bills', async () => {
    const res = await owner.get('/api/reports/overdue?side=payable');
    expect(res.body.data.rows.map((r) => [r.contact.name, r.outstanding])).toEqual([['Hari Supplies', '400.00']]);
  });

  it('a fully paid or not-yet-due document is not overdue', async () => {
    const mine = await registerUser(app, { businessName: 'Not Overdue Co' });
    const c = (await mine.post('/api/contacts', { name: 'Fine', types: ['customer'] })).body.data;
    const paid = (await mine.post('/api/sales', { contactId: c.id, txnDate: '2025-08-01', dueDate: '2025-08-05', post: true, lines: lines('100') })).body.data;
    await mine.post('/api/receipts', { contactId: c.id, txnDate: '2025-08-02', amount: '100', method: 'cash', allocations: [{ invoiceId: paid.id, amount: '100' }] });
    await mine.post('/api/sales', { contactId: c.id, txnDate: '2025-08-01', dueDate: '2099-01-01', post: true, lines: lines('100') });
    expect((await mine.get('/api/reports/overdue?side=receivable')).body.data.rows).toEqual([]);
  });

  it('voiding the receipt makes the invoice overdue again', async () => {
    const mine = await registerUser(app, { businessName: 'Void Overdue Co' });
    const c = (await mine.post('/api/contacts', { name: 'Late', types: ['customer'] })).body.data;
    const inv = (await mine.post('/api/sales', { contactId: c.id, txnDate: '2025-08-01', dueDate: '2025-08-05', post: true, lines: lines('100') })).body.data;
    const r = (await mine.post('/api/receipts', { contactId: c.id, txnDate: '2025-08-02', amount: '100', method: 'cash', allocations: [{ invoiceId: inv.id, amount: '100' }] })).body.data;
    expect((await mine.get('/api/reports/overdue?side=receivable')).body.data.rows).toHaveLength(0);
    await mine.post(`/api/receipts/${r.id}/void`, { reason: 'cheque bounced' });
    expect((await mine.get('/api/reports/overdue?side=receivable')).body.data.rows[0]).toMatchObject({ outstanding: '100.00' });
  });
});

describe('CSV export', () => {
  it('downloads with a byte-order mark, the right headers and exact amounts', async () => {
    const res = await owner.get('/api/reports/outstanding?side=receivable&format=csv');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/csv; charset=utf-8/);
    expect(res.headers['content-disposition']).toBe('attachment; filename="outstanding-receivable.csv"');
    expect(res.headers['cache-control']).toBe('no-store');
    const text = res.text;
    expect(text.charCodeAt(0)).toBe(0xfeff);
    const lines_ = text.slice(1).trim().split('\r\n');
    expect(lines_[0]).toBe('Customer,Phone,Balance,Overdue');
    expect(lines_[1]).toBe('Ram Traders,,1100.00,700.00');
    expect(lines_.at(-1)).toBe('Total,,1150.00,750.00');
  });

  it('neutralises spreadsheet formulas in names', async () => {
    const text = (await owner.get('/api/reports/outstanding?side=receivable&format=csv')).text;
    expect(text).toContain('"\'=HYPERLINK(""http://evil.example"")"');
    expect(text).not.toMatch(/(^|\r\n)=HYPERLINK/);
  });

  it('keeps a negative amount as a number', async () => {
    const mine = await registerUser(app, { businessName: 'Negative Csv Co' });
    const c = (await mine.post('/api/contacts', { name: 'Neg', types: ['customer'] })).body.data;
    await mine.post('/api/sales', { contactId: c.id, txnDate: '2025-08-01', post: true, lines: lines('10') });
    const text = (await mine.get('/api/reports/activity?from=2025-08-01&to=2025-08-31&format=csv')).text;
    expect(text.split('\r\n')[1]).toBe('Shrawan 2082,10.00,0.00,1,0.00,0.00,0,0.00,0.00');
  });

  it('activity and overdue also export', async () => {
    const a = await owner.get('/api/reports/activity?from=2025-08-01&to=2025-09-30&format=csv');
    expect(a.headers['content-disposition']).toBe('attachment; filename="activity-2025-08-01-to-2025-09-30.csv"');
    expect(a.text.split('\r\n')[0].slice(1)).toBe('Period,Sales,Sales VAT,Sales count,Purchases,Purchases VAT,Purchases count,Receipts,Payments');
    const o = await owner.get('/api/reports/overdue?side=payable&format=csv');
    expect(o.text).toContain('Hari Supplies');
  });

  it('is written to the audit log', async () => {
    await owner.get('/api/reports/overdue?side=receivable&format=csv');
    const { rows } = await pool.query("SELECT metadata FROM audit_logs WHERE business_id = $1 AND action = 'report.export' ORDER BY id DESC LIMIT 1", [owner.businessId]);
    expect(rows[0].metadata).toMatchObject({ report: 'overdue', query: { side: 'receivable', format: 'csv' } });
  });

  it('JSON is not audited as an export', async () => {
    const before = (await pool.query("SELECT count(*)::int AS n FROM audit_logs WHERE business_id = $1 AND action = 'report.export'", [owner.businessId])).rows[0].n;
    await owner.get('/api/reports/overdue?side=receivable');
    const after = (await pool.query("SELECT count(*)::int AS n FROM audit_logs WHERE business_id = $1 AND action = 'report.export'", [owner.businessId])).rows[0].n;
    expect(after).toBe(before);
  });
});

describe('who may see reports', () => {
  const as = (roleKey, options = {}) => createMemberSession(app, pool, { businessId: owner.businessId, roleKey, label: `reports-${roleKey}`, ...options });

  it('staff have no reports at all', async () => {
    const staff = await as('staff');
    for (const path of ['dashboard', 'activity', 'outstanding?side=receivable', 'overdue?side=receivable']) {
      expect((await staff.get(`/api/reports/${path}`)).status, path).toBe(403);
    }
  });

  it('a viewer reads reports but cannot export them', async () => {
    const viewer = await as('viewer');
    expect((await viewer.get('/api/reports/outstanding?side=receivable')).status).toBe(200);
    const csv = await viewer.get('/api/reports/outstanding?side=receivable&format=csv');
    expect(csv.status).toBe(403);
    expect(csv.text).not.toContain('Ram Traders');
  });

  it('an accountant can export', async () => {
    const accountant = await as('accountant');
    expect((await accountant.get('/api/reports/overdue?side=receivable&format=csv')).status).toBe(200);
  });

  it('someone with reports but without the ledger permission sees no balances anywhere', async () => {
    const limited = await as('viewer', { denies: ['ledger.view'] });
    const dash = await limited.get(`/api/reports/dashboard?${august}`);
    expect(dash.status).toBe(200);
    expect(dash.body.data.sales.total).toBe('1050.00'); // activity is fine
    expect(dash.body.data.receivables).toBeNull();
    expect(dash.body.data.payables).toBeNull();
    expect((await limited.get('/api/reports/outstanding?side=receivable')).status).toBe(403);
    expect((await limited.get('/api/reports/overdue?side=receivable')).status).toBe(403);
  });

  it('logged-out requests are refused', async () => {
    const { default: request } = await import('supertest');
    expect((await request(app).get('/api/reports/dashboard')).status).toBe(401);
  });
});

describe('GET /api/ledger/contacts/:id/export', () => {
  it('exports the whole account with opening balance, totals and exact amounts', async () => {
    const res = await owner.get(`/api/ledger/contacts/${customer.id}/export`);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toBe('attachment; filename="ledger-Ram-Traders.csv"');
    const rows = res.text.slice(1).trim().split('\r\n');
    expect(rows[0]).toBe('Date,Number,Type,Description,Reference,Debit,Credit,Balance');
    expect(rows[1]).toBe(',,,Opening balance,,,,0.00');
    expect(rows.filter((r) => r.includes(',sale,'))).toHaveLength(2); // the voided and draft ones are not in it
    expect(rows.some((r) => r.includes(',receipt,'))).toBe(true);
    expect(rows.at(-1)).toBe(',,,Total,,1400.00,300.00,1100.00');
  });

  it('respects the date range and brings the balance forward', async () => {
    const res = await owner.get(`/api/ledger/contacts/${customer.id}/export?from=2025-09-01&to=2025-09-30`);
    const rows = res.text.slice(1).trim().split('\r\n');
    expect(rows[1]).toBe(',,,Opening balance,,,,700.00');
    expect(rows.at(-1)).toBe(',,,Total,,400.00,0.00,1100.00');
  });

  it('is audited, and needs both the ledger and export permissions', async () => {
    const { rows } = await pool.query("SELECT metadata FROM audit_logs WHERE business_id = $1 AND action = 'ledger.export' ORDER BY id DESC LIMIT 1", [owner.businessId]);
    expect(rows[0].metadata).toMatchObject({ from: '2025-09-01', to: '2025-09-30' });
    const viewer = await createMemberSession(app, pool, { businessId: owner.businessId, roleKey: 'viewer', label: 'export-viewer' });
    expect((await viewer.get(`/api/ledger/contacts/${customer.id}/export`)).status).toBe(403);
  });

  it('404s for another business’s contact and neutralises formula names', async () => {
    expect((await other.get(`/api/ledger/contacts/${customer.id}/export`)).status).toBe(404);
    const res = await owner.get(`/api/ledger/contacts/${customer2.id}/export`);
    expect(res.headers['content-disposition']).toBe('attachment; filename="ledger-HYPERLINK-http-evil-example.csv"');
  });
});
