import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bsMonthRange, fiscalYear } from '@ledgernepal/shared/dates';
import { toPaisa } from '@ledgernepal/shared/money';
import { createTestApp } from '../helpers/testApp.js';
import { cleanupApiTestData, registerUser } from '../helpers/api.js';

// The corners: very large amounts, rounding at the paisa, fiscal-year and Bikram Sambat month boundaries.
// Every one of these must give a clear answer (never a 500) and exact money.

const { app, pool, close } = createTestApp();
let owner;
let vat;

const contact = async (session, name = 'Edge Contact') => (await session.post('/api/contacts', { name, types: ['customer', 'supplier'] })).body.data;
const line = (o = {}) => ({ description: 'Goods', quantity: '1', unitPrice: '100', ...o });
const sale = (session, contactId, body = {}) => session.post('/api/sales', { contactId, txnDate: '2025-08-01', post: true, lines: [line()], ...body });

beforeAll(async () => {
  await cleanupApiTestData(pool);
  owner = await registerUser(app, { businessName: 'Edge Co' });
  vat = await registerUser(app, { businessName: 'Edge VAT Co' });
  await vat.patch('/api/settings', { isVatRegistered: true, defaultVatRate: '13' });
});
afterAll(async () => {
  await cleanupApiTestData(pool);
  await close();
});

describe('large amounts', () => {
  const MAX = '999999999999.99'; // 12 whole digits: the largest amount the system accepts

  it('the largest amount is kept exactly, in a receipt, a sale and the balance', async () => {
    const c = await contact(owner, 'Max Contact');
    const receipt = await owner.post('/api/receipts', { contactId: c.id, txnDate: '2025-08-01', amount: MAX, method: 'cash' });
    expect(receipt.status).toBe(201);
    expect(receipt.body.data.amount).toBe(MAX);
    const invoice = await sale(owner, c.id, { lines: [line({ unitPrice: MAX })] });
    expect(invoice.status).toBe(201);
    expect(invoice.body.data.total).toBe(MAX);
    const balance = (await owner.get(`/api/contacts/${c.id}`)).body.data.balance;
    expect(balance).toEqual({ amount: '0.00', side: 'settled' });
  });

  it('one paisa more than the largest amount is refused with a clear message', async () => {
    const c = await contact(owner, 'Too Big');
    const res = await owner.post('/api/receipts', { contactId: c.id, txnDate: '2025-08-01', amount: '1000000000000.00', method: 'cash' });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].message).toMatch(/too large/i);
    const direct = await owner.post('/api/ledger/entries', { contactId: c.id, txnDate: '2025-08-01', direction: 'you_gave', amount: '1000000000000' });
    expect(direct.status).toBe(400);
  });

  it('an invoice whose quantity times price is out of range is refused, never a server error', async () => {
    const c = await contact(owner, 'Overflow');
    for (const lines of [
      [line({ quantity: '99999999999', unitPrice: '999999999999.99' })],
      [line({ quantity: '1000000', unitPrice: '999999999.99' })],
      [line({ unitPrice: MAX }), line({ unitPrice: MAX })], // two maximum lines add up past the limit
    ]) {
      const res = await sale(owner, c.id, { lines });
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(JSON.stringify(res.body)).toMatch(/too large|out of range|exceed/i);
    }
    expect((await owner.get(`/api/sales?contactId=${c.id}`)).body.data).toEqual([]); // nothing half-saved
  });

  it('many large documents still add up exactly in the balance, the ledger and the reports', async () => {
    const c = await contact(owner, 'Whale');
    // Four maximum-size documents make a 13-digit balance, which is beyond what one document may hold.
    for (let i = 0; i < 4; i += 1) expect((await sale(owner, c.id, { lines: [line({ unitPrice: MAX })] })).status).toBe(201);
    const expected = toPaisa(MAX) * 4n;
    const balance = (await owner.get(`/api/contacts/${c.id}`)).body.data.balance;
    expect(toPaisa(balance.amount)).toBe(expected);
    expect(toPaisa((await owner.get(`/api/ledger/contacts/${c.id}`)).body.data.closingBalance)).toBe(expected);
    const owed = (await owner.get('/api/reports/outstanding?side=receivable&q=Whale')).body.data;
    expect(toPaisa(owed.total)).toBe(expected);
  }, 120_000);
});

describe('rounding', () => {
  it('VAT is rounded once per line and totals equal the sum of the lines to the paisa', async () => {
    const c = await contact(vat);
    const res = await vat.post('/api/sales', {
      contactId: c.id, txnDate: '2025-08-01', post: true,
      lines: [
        line({ quantity: '3', unitPrice: '0.01', taxable: true }), // 13% of 0.03 = 0.0039 -> 0.00
        line({ quantity: '0.333', unitPrice: '10.01', taxable: true }), // 3.33333 -> 3.33; VAT 0.4329 -> 0.43
        line({ quantity: '7', unitPrice: '19.99', discount: '0.50', taxable: true }),
        line({ quantity: '1', unitPrice: '5.55' }), // not taxable
      ],
      invoiceDiscount: '1.07',
    });
    expect(res.status).toBe(201);
    const d = res.body.data;
    const sum = (key) => d.lines.reduce((s, l) => s + toPaisa(l[key]), 0n);
    expect(toPaisa(d.totals.total)).toBe(sum('lineTotal'));
    expect(toPaisa(d.totals.tax)).toBe(sum('taxAmount'));
    // gross - discounts + VAT = total, exactly
    expect(toPaisa(d.totals.subtotal) - toPaisa(d.totals.discount) + toPaisa(d.totals.tax)).toBe(toPaisa(d.totals.total));
    // the 1.07 discount is spread with no paisa lost or invented
    expect(d.lines.reduce((s, l) => s + toPaisa(l.invoiceDiscountShare), 0n)).toBe(toPaisa('1.07'));
    expect(toPaisa((await vat.get(`/api/contacts/${c.id}`)).body.data.balance.amount)).toBe(toPaisa(d.totals.total));
  });

  it('a discount equal to the whole line leaves a free line, and a larger one is refused', async () => {
    const c = await contact(owner, 'Discount');
    const free = await sale(owner, c.id, { lines: [line({ unitPrice: '40', discount: '40' }), line({ unitPrice: '10' })] });
    expect(free.status).toBe(201);
    expect(free.body.data.totals.total).toBe('10.00');
    const bad = await sale(owner, c.id, { lines: [line({ unitPrice: '40', discount: '40.01' })] });
    expect(bad.status).toBe(400);
  });

  it('a discount on the whole invoice cannot exceed what is being sold', async () => {
    const c = await contact(owner, 'Whole Discount');
    expect((await sale(owner, c.id, { invoiceDiscount: '100.01' })).status).toBe(400);
    const draft = await sale(owner, c.id, { invoiceDiscount: '100', post: false });
    expect(draft.body.data.totals.total).toBe('0.00'); // discounting everything is allowed on a draft...
    const post = await owner.post(`/api/sales/${draft.body.data.id}/post`);
    expect(post.status).toBe(400); // ...but a document worth nothing cannot be posted
    expect(JSON.stringify(post.body)).toMatch(/greater than zero/);
  });

  it('part payments of awkward amounts never leave a stray paisa', async () => {
    const c = await contact(owner, 'Thirds');
    const invoice = (await sale(owner, c.id, { lines: [line({ unitPrice: '100' })] })).body.data;
    for (const amount of ['33.33', '33.33', '33.34']) {
      const r = await owner.post('/api/receipts', { contactId: c.id, txnDate: '2025-08-02', amount, method: 'cash', allocations: [{ invoiceId: invoice.id, amount }] });
      expect(r.status).toBe(201);
    }
    expect((await owner.get(`/api/sales/${invoice.id}`)).body.data).toMatchObject({ paid: '100.00', outstanding: '0.00', paymentStatus: 'paid' });
    expect((await owner.get(`/api/contacts/${c.id}`)).body.data.balance.side).toBe('settled');
  });
});

describe('fiscal-year and Bikram Sambat boundaries', () => {
  const fy = fiscalYear(2082); // Shrawan 1 2082 .. Ashadh end 2083

  it('the last day of Ashadh and the first day of Shrawan get different fiscal years and numbering', async () => {
    const mine = await registerUser(app, { businessName: 'Boundary Co' });
    const c = await contact(mine);
    const lastDay = await sale(mine, c.id, { txnDate: fiscalYear(2081).end });
    const firstDay = await sale(mine, c.id, { txnDate: fy.start });
    const secondOfNew = await sale(mine, c.id, { txnDate: fy.start });
    expect(lastDay.body.data.referenceNo).toBe('SI-2081/82-0001');
    expect(firstDay.body.data.referenceNo).toBe('SI-2082/83-0001');
    expect(secondOfNew.body.data.referenceNo).toBe('SI-2082/83-0002');
    // a back-dated document continues the OLD year's numbers rather than disturbing the new one
    const backdated = await sale(mine, c.id, { txnDate: fiscalYear(2081).start });
    expect(backdated.body.data.referenceNo).toBe('SI-2081/82-0002');
  });

  it('a report period ending on the last day of the fiscal year includes it, and the next day starts the next', async () => {
    const mine = await registerUser(app, { businessName: 'Period Co' });
    const c = await contact(mine);
    await sale(mine, c.id, { txnDate: fiscalYear(2081).end, lines: [line({ unitPrice: '10' })] });
    await sale(mine, c.id, { txnDate: fy.start, lines: [line({ unitPrice: '20' })] });
    const old = await mine.get(`/api/reports/dashboard?from=${fiscalYear(2081).start}&to=${fiscalYear(2081).end}`);
    const current = await mine.get(`/api/reports/dashboard?from=${fy.start}&to=${fy.end}`);
    expect(old.body.data.sales.total).toBe('10.00');
    expect(current.body.data.sales.total).toBe('20.00');
  });

  it('monthly activity splits exactly at the Bikram Sambat month boundary, whatever the AD month', async () => {
    const mine = await registerUser(app, { businessName: 'Month Co' });
    const c = await contact(mine);
    const shrawan = bsMonthRange(2082, 4);
    const bhadra = bsMonthRange(2082, 5);
    await sale(mine, c.id, { txnDate: shrawan.end, lines: [line({ unitPrice: '1' })] });
    await sale(mine, c.id, { txnDate: bhadra.start, lines: [line({ unitPrice: '2' })] });
    await sale(mine, c.id, { txnDate: bhadra.end, lines: [line({ unitPrice: '4' })] });
    const rows = (await mine.get(`/api/reports/activity?from=${shrawan.start}&to=${bhadra.end}&group=month`)).body.data.rows;
    expect(rows.map((r) => [r.period, r.sales])).toEqual([['Shrawan 2082', '1.00'], ['Bhadra 2082', '6.00']]);
  });

  it('the earliest and latest accepted dates work; one day outside is refused', async () => {
    const mine = await registerUser(app, { businessName: 'Range Co' });
    const c = await contact(mine);
    const first = await sale(mine, c.id, { txnDate: '1990-01-01' });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const last = await sale(mine, c.id, { txnDate: '2042-01-01' });
    expect(last.status, JSON.stringify(last.body)).toBe(201);
    expect((await sale(mine, c.id, { txnDate: '1989-12-31' })).status).toBe(400);
    expect((await sale(mine, c.id, { txnDate: '2042-01-02' })).status).toBe(400);
    expect((await sale(mine, c.id, { txnDate: '2025-02-29' })).status).toBe(400); // not a leap year
    expect((await sale(mine, c.id, { txnDate: '2024-02-29' })).status).toBe(201); // a leap year
  });

  it('a due date on the invoice date is fine; the day before is not', async () => {
    const c = await contact(owner, 'Due Dates');
    expect((await sale(owner, c.id, { dueDate: '2025-08-01' })).status).toBe(201);
    expect((await sale(owner, c.id, { dueDate: '2025-07-31' })).status).toBe(400);
  });
});

describe('numbering under pressure', () => {
  // Invoices of one business take the numbering lock one after another, so on a slow network the last of a big
  // burst waits longer than the 15 s database connection timeout. Eight (below the pool size of ten) proves the
  // same thing, that no number is repeated or skipped, without depending on how fast the network is.
  it('eight simultaneous invoices get eight different consecutive numbers', async () => {
    const mine = await registerUser(app, { businessName: 'Race Co' });
    const c = await contact(mine);
    const results = await Promise.all(Array.from({ length: 8 }, () => sale(mine, c.id)));
    expect(results.map((r) => r.status)).toEqual(Array(8).fill(201));
    const numbers = results.map((r) => Number(r.body.data.referenceNo.split('-').pop())).sort((a, b) => a - b);
    expect(numbers).toEqual(Array.from({ length: 8 }, (_, i) => i + 1));
  }, 120_000);
});
