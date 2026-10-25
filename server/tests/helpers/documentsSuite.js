import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fiscalYear } from '@ledgernepal/shared/dates';
import { createTestApp } from './testApp.js';
import { cleanupApiTestData, createMemberSession, registerUser } from './api.js';

// The whole test suite for one kind of document. tests/integration/sales.test.js and purchases.test.js
// each call it, so the two kinds are tested identically but run in parallel (the suite is slow-ish because
// every step talks to the real database).
export function defineDocumentsSuite(k) {
  const { app, pool, close } = createTestApp();
  let owner; // plain business: not VAT-registered, no credit days
  let vatOwner; // VAT-registered, default rate 13%
  let creditOwner; // 30 credit days
  let prefixOwner; // changes its numbering prefixes

  beforeAll(async () => {
    await cleanupApiTestData(pool);
    owner = await registerUser(app, { businessName: 'Documents Co' });
    vatOwner = await registerUser(app, { businessName: 'VAT Co' });
    expect((await vatOwner.patch('/api/settings', { isVatRegistered: true, defaultVatRate: '13' })).status).toBe(200);
    creditOwner = await registerUser(app, { businessName: 'Credit Co' });
    expect((await creditOwner.patch('/api/settings', { defaultCreditDays: 30 })).status).toBe(200);
    prefixOwner = await registerUser(app, { businessName: 'Prefix Co' });
  });
  afterAll(async () => {
    await cleanupApiTestData(pool);
    await close();
  });

  const line = (o = {}) => ({ description: 'Rice', quantity: '2', unitPrice: '100', ...o });
  const newContact = async (session = owner, name = 'Ram Traders') => (await session.post('/api/contacts', { name, types: ['customer', 'supplier'] })).body.data;
  const balanceOf = async (contactId, session = owner) => (await session.get(`/api/contacts/${contactId}`)).body.data.balance.amount;
  const auditActions = async (id) => (await pool.query('SELECT action FROM audit_logs WHERE entity_id = $1 ORDER BY id', [id])).rows.map((r) => r.action);

  describe(`${k.type} documents (${k.path})`, () => {
    const make = (contactId, o = {}, session = owner) => session.post(k.path, { contactId, txnDate: '2025-08-01', lines: [line()], ...o });
    const created = async (contactId, o = {}, session = owner) => (await make(contactId, o, session)).body.data;

    describe('creating', () => {
      it('saves a draft: lines worked out, no number yet, and no effect on the balance', async () => {
        const c = await newContact();
        const res = await make(c.id, { lines: [line({ quantity: '3', unitPrice: '150.50' })], notes: 'for the shop' });
        expect(res.status).toBe(201);
        expect(res.body.data).toMatchObject({ type: k.type, status: 'draft', referenceNo: null, notes: 'for the shop', contact: { id: c.id, name: 'Ram Traders' } });
        expect(res.body.data.totals).toEqual({ subtotal: '451.50', discount: '0.00', taxable: '0.00', nonTaxable: '451.50', tax: '0.00', total: '451.50' });
        expect(res.body.data.lines[0]).toMatchObject({ lineNo: 1, quantity: '3.000', unitPrice: '150.50', grossAmount: '451.50', lineTotal: '451.50', taxable: false, taxRate: null });
        expect(await balanceOf(c.id)).toBe('0.00');
        expect((await owner.get(`/api/ledger/contacts/${c.id}`)).body.data.rows).toEqual([]);
      });

      it(`posts straight away with post:true: numbered ${k.prefix}-<fiscal year>-0001, and moves the balance the right way`, async () => {
        const c = await newContact();
        const doc = await created(c.id, { post: true, lines: [line({ quantity: '4', unitPrice: '250' })] });
        expect(doc.status).toBe('posted');
        expect(doc.referenceNo).toMatch(new RegExp(`^${k.prefix}-2082/83-\\d{4}$`));
        expect(doc.postedAt).toBeTruthy();
        expect(await balanceOf(c.id)).toBe(`${k.sign}1000.00`);
        const row = (await owner.get(`/api/ledger/contacts/${c.id}`)).body.data.rows[0];
        expect(row).toMatchObject({ type: k.type, referenceNo: doc.referenceNo, description: 'Rice' });
        expect(k.type === 'sale' ? row.debit : row.credit).toBe('1000.00');
      });

      it('summarises the lines for lists and the ledger', async () => {
        const c = await newContact();
        const doc = await created(c.id, { lines: [line({ description: 'Basmati rice 25kg' }), line({ description: 'Oil' }), line({ description: 'Sugar' })] });
        expect(doc.description).toBe('Basmati rice 25kg +2 more');
      });

      it('works out discounts: per line, and for the whole document spread over the lines', async () => {
        const c = await newContact();
        const doc = await created(c.id, {
          lines: [line({ quantity: '1', unitPrice: '600', discount: '50' }), line({ description: 'Oil', quantity: '1', unitPrice: '400' })],
          invoiceDiscount: '100',
        });
        expect(doc.totals).toMatchObject({ subtotal: '1000.00', discount: '150.00', total: '850.00' });
        expect(doc.lines.map((l) => l.invoiceDiscountShare)).toEqual(['57.89', '42.11']); // 100 in proportion to 550 : 400
        expect(doc.lines.map((l) => l.lineTotal)).toEqual(['492.11', '357.89']);
        expect(doc.lines.reduce((sum, l) => sum + Number(l.invoiceDiscountShare), 0).toFixed(2)).toBe('100.00');
      });

      it('accepts quantities and prices as numbers or text, and keeps three decimals of quantity', async () => {
        const c = await newContact();
        const doc = await created(c.id, { lines: [line({ quantity: 0.125, unitPrice: 80 })] });
        expect(doc.lines[0]).toMatchObject({ quantity: '0.125', grossAmount: '10.00' });
      });

      it('stores many lines in order', async () => {
        const c = await newContact();
        const lines = Array.from({ length: 60 }, (_, i) => line({ description: `Item ${i + 1}`, unitPrice: '1' }));
        const doc = await created(c.id, { lines });
        expect(doc.lines).toHaveLength(60);
        expect(doc.lines.map((l) => l.lineNo)).toEqual(Array.from({ length: 60 }, (_, i) => i + 1));
        expect(doc.lines[59].description).toBe('Item 60');
        expect(doc.totals.total).toBe('120.00');
      });

      it('accepts exactly what the screens send: blank optional fields as empty text, no VAT fields on plain lines', async () => {
      const c = await newContact();
      const res = await owner.post(k.path, {
        contactId: c.id, txnDate: '2025-08-01', externalRef: '', notes: '', post: false,
        lines: [{ description: 'Rice', quantity: '2', unit: '', unitPrice: '100', taxable: false }],
      });
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ externalRef: null, notes: null, dueDate: null });
      expect(res.body.data.lines[0]).toMatchObject({ unit: null, discount: '0.00' });
      // and the edit the screens send for a draft: dueDate null means "no due date"
      const edit = await owner.patch(`${k.path}/${res.body.data.id}`, {
        contactId: c.id, txnDate: '2025-08-02', dueDate: null, externalRef: 'REF-1', notes: 'n',
        lines: [{ description: 'Rice', quantity: '3', unit: 'kg', unitPrice: '100', taxable: false }],
      });
      expect(edit.status).toBe(200);
      expect(edit.body.data).toMatchObject({ txnDate: '2025-08-02', dueDate: null, externalRef: 'REF-1' });
      expect(edit.body.data.totals.total).toBe('300.00');
    });

    it('shows up on the main Ledger list once posted (not as a draft), labelled as what it is, and can be filtered by kind', async () => {
      const c = await newContact();
      const draft = await created(c.id);
      const doc = await created(c.id, { post: true, lines: [line({ description: 'Ledger visible goods' })] });
      await owner.post('/api/ledger/entries', { contactId: c.id, txnDate: '2025-08-02', direction: 'you_gave', amount: '10' });
      const list = async (qs = '') => (await owner.get(`/api/ledger/entries?contactId=${c.id}&${qs}`)).body.data;

      const all = await list();
      expect(all.map((e) => e.id)).toContain(doc.id);
      expect(all.map((e) => e.id)).not.toContain(draft.id); // a draft is not in the books yet
      const row = all.find((e) => e.id === doc.id);
      expect(row).toMatchObject({ type: k.type, status: 'posted', referenceNo: doc.referenceNo, amount: '200.00', description: 'Ledger visible goods', direction: null, effect: k.type === 'sale' ? 'debit' : 'credit' });

      expect((await list(`type=${k.type}`)).map((e) => e.id)).toEqual([doc.id]);
      expect((await list('type=ledger_entry')).map((e) => e.type)).toEqual(['ledger_entry']);
      expect((await list(`type=${k.type === 'sale' ? 'purchase' : 'sale'}`))).toEqual([]);

      await owner.post(`${k.path}/${doc.id}/void`, { reason: 'ledger list void test' });
      expect((await list(`type=${k.type}`)).map((e) => e.id)).toEqual([]); // voided are hidden by default
      expect((await list(`type=${k.type}&status=voided`)).map((e) => e.id)).toEqual([doc.id]);
    });

    it('records who made it and an audit entry', async () => {
        const c = await newContact();
        const doc = await created(c.id, { post: true });
        expect(doc.createdBy).toMatchObject({ id: owner.user.id });
        expect(await auditActions(doc.id)).toEqual([`${k.type}.create_draft`, `${k.type}.post`]);
      });
    });

    describe('due dates', () => {
      it('are empty unless set: such a document is never overdue', async () => {
        const c = await newContact();
        expect((await created(c.id)).dueDate).toBeNull();
      });

      it('follow the business’s credit days when it has set them, and an explicit date wins', async () => {
        const c = await newContact(creditOwner);
        expect((await created(c.id, { txnDate: '2025-08-01' }, creditOwner)).dueDate).toBe('2025-08-31');
        expect((await created(c.id, { txnDate: '2025-08-01', dueDate: '2025-08-10' }, creditOwner)).dueDate).toBe('2025-08-10');
        expect((await created(c.id, { txnDate: '2025-08-01', dueDate: null }, creditOwner)).dueDate).toBeNull();
      });

      it('cannot be before the document date', async () => {
        const c = await newContact();
        const res = await make(c.id, { txnDate: '2025-08-10', dueDate: '2025-08-09' });
        expect(res.status).toBe(400);
        expect(res.body.error.details[0]).toMatchObject({ field: 'dueDate' });
      });
    });

    describe('VAT', () => {
      const vatLine = (o = {}) => line({ quantity: '2.5', unitPrice: '199.99', discount: '50', taxable: true, ...o });

      it('is charged at the business’s default rate on lines marked taxable, and shown apart from the rest', async () => {
        const c = await newContact(vatOwner);
        const doc = await created(c.id, { lines: [vatLine(), line({ description: 'Exempt item', quantity: '1', unitPrice: '100' })] }, vatOwner);
        expect(doc.lines[0]).toMatchObject({ grossAmount: '499.98', taxable: true, taxRate: '13.00', taxableAmount: '449.98', taxAmount: '58.50', lineTotal: '508.48' });
        expect(doc.lines[1]).toMatchObject({ taxable: false, taxRate: null, taxAmount: '0.00', lineTotal: '100.00' });
        expect(doc.totals).toEqual({ subtotal: '599.98', discount: '50.00', taxable: '449.98', nonTaxable: '100.00', tax: '58.50', total: '608.48' });
      });

      it('can use a different rate on a line, including 0%', async () => {
        const c = await newContact(vatOwner);
        const doc = await created(c.id, { lines: [line({ taxable: true, taxRate: '5' }), line({ taxable: true, taxRate: 0 })] }, vatOwner);
        expect(doc.lines.map((l) => [l.taxRate, l.taxAmount])).toEqual([['5.00', '10.00'], ['0.00', '0.00']]);
        expect(doc.totals.taxable).toBe('400.00'); // a 0% line is still "taxable at zero"
      });

      it('is charged on the price AFTER the invoice discount', async () => {
        const c = await newContact(vatOwner);
        const doc = await created(c.id, { lines: [line({ quantity: '1', unitPrice: '1000', taxable: true })], invoiceDiscount: '200' }, vatOwner);
        expect(doc.totals).toMatchObject({ taxable: '800.00', tax: '104.00', total: '904.00' });
      });

      it('keeps the rate it was written with when the business changes its rate later', async () => {
        const c = await newContact(vatOwner);
        const doc = await created(c.id, { post: true, lines: [line({ taxable: true })] }, vatOwner);
        await vatOwner.patch('/api/settings', { defaultVatRate: '15' });
        const later = await created(c.id, { lines: [line({ taxable: true })] }, vatOwner);
        await vatOwner.patch('/api/settings', { defaultVatRate: '13' });
        expect((await vatOwner.get(`${k.path}/${doc.id}`)).body.data.lines[0].taxRate).toBe('13.00');
        expect(later.lines[0].taxRate).toBe('15.00');
      });

      it('is refused when the business is not registered for VAT, saying where to fix it', async () => {
        const c = await newContact();
        const res = await make(c.id, { lines: [line(), line({ taxable: true })] });
        expect(res.status).toBe(400);
        expect(res.body.error.details[0]).toMatchObject({ field: 'lines.1.taxable' });
        expect(res.body.error.details[0].message).toMatch(/not set up for VAT/);
      });

      it('needs a rate: a registered business with no default must say which rate each taxable line uses', async () => {
        const c = await newContact(vatOwner);
        await vatOwner.patch('/api/settings', { defaultVatRate: null });
        try {
          const res = await make(c.id, { lines: [line({ taxable: true })] }, vatOwner);
          expect(res.status).toBe(400);
          expect(res.body.error.details[0]).toMatchObject({ field: 'lines.0.taxRate' });
          expect((await make(c.id, { lines: [line({ taxable: true, taxRate: '13' })] }, vatOwner)).status).toBe(201);
        } finally {
          await vatOwner.patch('/api/settings', { defaultVatRate: '13' });
        }
      });

      it('is not accepted as a rate on a line that is not taxable', async () => {
        const c = await newContact(vatOwner);
        const res = await make(c.id, { lines: [line({ taxable: false, taxRate: '13' })] }, vatOwner);
        expect(res.status).toBe(400);
        expect(res.body.error.details[0]).toMatchObject({ field: 'lines.0.taxRate' });
      });
    });

    describe('refuses bad input with a message that names the problem', () => {
      const bad = async (override, field, message) => {
        const c = await newContact();
        const res = await make(c.id, override);
        expect(res.status).toBe(400);
        const detail = res.body.error.details.find((d) => d.field === field);
        expect(detail, JSON.stringify(res.body.error.details)).toBeDefined();
        expect(detail.message).toMatch(message);
      };

      it('no lines', () => bad({ lines: [] }, 'lines', /at least one line/i));
      it('more than 200 lines', () => bad({ lines: Array.from({ length: 201 }, () => line()) }, 'lines', /at most 200/));
      it('a blank description', () => bad({ lines: [line({ description: '  ' })] }, 'lines.0.description', /Describe the item/));
      it('a zero quantity', () => bad({ lines: [line({ quantity: '0' })] }, 'lines.0.quantity', /above zero/));
      it('a quantity with four decimals', () => bad({ lines: [line({ quantity: '1.2345' })] }, 'lines.0.quantity', /3 decimal places/));
      it('a negative price', () => bad({ lines: [line({ unitPrice: '-5' })] }, 'lines.0.unitPrice', /negative|Enter an amount/));
      it('a price with three decimals', () => bad({ lines: [line({ unitPrice: '1.234' })] }, 'lines.0.unitPrice', /2 decimal places/));
      it('a line discount larger than the line', () => bad({ lines: [line({ discount: '201' })] }, 'lines', /Line 1: discount cannot be more/));
      it('an invoice discount larger than the document', () => bad({ invoiceDiscount: '201' }, 'invoiceDiscount', /more than the total/));
      it('a negative invoice discount', () => bad({ invoiceDiscount: '-1' }, 'invoiceDiscount', /negative|Enter an amount/));
      it('an impossible date', () => bad({ txnDate: '2025-02-30' }, 'txnDate', /real date/));
      it('a total too large for the books', () => bad({ lines: [line({ quantity: '2', unitPrice: '999999999999.99' })] }, 'lines', /too large/i));

      it('fields the client must not set', async () => {
        const c = await newContact();
        for (const extra of [{ status: 'posted' }, { referenceNo: 'X-1' }, { total: '1' }, { effect: 'credit' }, { businessId: owner.businessId }, { createdBy: owner.user.id }, { type: 'sale' }]) {
          expect((await make(c.id, extra)).status, JSON.stringify(extra)).toBe(400);
        }
        expect((await make(c.id, { lines: [line({ lineTotal: '1' })] })).status).toBe(400);
      });

      it('nothing is saved when a document is refused', async () => {
        const c = await newContact();
        await make(c.id, { lines: [line(), line({ discount: '999' })] });
        expect((await owner.get(`${k.path}?contactId=${c.id}`)).body.data).toEqual([]);
      });
    });

    describe('contacts', () => {
      it('an unknown contact, or a contact id from another business, is 404', async () => {
        expect((await make('00000000-0000-4000-8000-000000000000')).status).toBe(404);
        const foreign = await newContact(vatOwner);
        expect((await make(foreign.id)).status).toBe(404);
      });

      it('an archived contact cannot be used', async () => {
        const c = await newContact();
        await owner.post(`/api/contacts/${c.id}/archive`);
        const res = await make(c.id);
        expect(res.status).toBe(409);
        expect(res.body.error.message).toMatch(/archived/);
      });
    });

    describe('reading', () => {
      it('gets one document with its lines, and 404s for an unknown id', async () => {
        const c = await newContact();
        const doc = await created(c.id, { lines: [line(), line({ description: 'Oil' })] });
        const res = await owner.get(`${k.path}/${doc.id}`);
        expect(res.body.data.lines.map((l) => l.description)).toEqual(['Rice', 'Oil']);
        expect((await owner.get(`${k.path}/00000000-0000-4000-8000-000000000000`)).status).toBe(404);
        expect((await owner.get(`${k.path}/not-a-uuid`)).status).toBe(400);
      });

      it('keeps sales and purchases apart: one kind’s id is a 404 on the other kind’s endpoint', async () => {
        const c = await newContact();
        const doc = await created(c.id);
        const otherPath = k.type === 'sale' ? '/api/purchases' : '/api/sales';
        expect((await owner.get(`${otherPath}/${doc.id}`)).status).toBe(404);
        expect((await owner.post(`${otherPath}/${doc.id}/post`)).status).toBe(404);
        expect((await owner.delete(`${otherPath}/${doc.id}`)).status).toBe(404);
      });

      it('lists with filters for status, contact, dates and search text, and honest totals for paging', async () => {
        const c = await newContact(owner, 'Filter Subject');
        const d1 = await created(c.id, { txnDate: '2025-08-02', lines: [line({ description: 'alpha goods' })] });
        const d2 = await created(c.id, { txnDate: '2025-08-12', post: true, lines: [line({ description: 'beta goods' })] });
        await created(c.id, { txnDate: '2025-08-20', post: true, lines: [line({ description: 'gamma goods' })] });
        const ids = async (qs) => (await owner.get(`${k.path}?contactId=${c.id}&${qs}`)).body.data.map((x) => x.id);

        expect((await ids('status=all')).length).toBe(3);
        expect(await ids('status=draft')).toEqual([d1.id]);
        expect((await ids('status=posted')).length).toBe(2);
        expect(await ids('from=2025-08-10&to=2025-08-15')).toEqual([d2.id]);
        expect(await ids('q=ALPHA')).toEqual([d1.id]);
        expect(await ids(`q=${encodeURIComponent('%')}`)).toEqual([]);

        const page = (await owner.get(`${k.path}?contactId=${c.id}&pageSize=2&page=2`)).body;
        expect(page.meta).toEqual({ page: 2, pageSize: 2, total: 3 });
        expect(page.data).toHaveLength(1);
        expect((await owner.get(`${k.path}?status=bogus`)).status).toBe(400);
      });

      it('a list row carries what a list needs and no lines', async () => {
        const c = await newContact();
        const doc = await created(c.id, { post: true, lines: [line({ description: 'Listed' })] });
        const row = (await owner.get(`${k.path}?contactId=${c.id}`)).body.data[0];
        expect(row).toMatchObject({ id: doc.id, referenceNo: doc.referenceNo, status: 'posted', total: '200.00', description: 'Listed', contact: { id: c.id } });
        expect(row).not.toHaveProperty('lines');
      });
    });

    describe('changing a draft', () => {
      it('replaces the lines and recalculates; the balance is untouched until it is posted', async () => {
        const c = await newContact();
        const doc = await created(c.id, { lines: [line(), line({ description: 'Oil' })] });
        const res = await owner.patch(`${k.path}/${doc.id}`, { lines: [line({ quantity: '10', unitPrice: '30' })], invoiceDiscount: '50' });
        expect(res.status).toBe(200);
        expect(res.body.data.lines).toHaveLength(1);
        expect(res.body.data.totals).toMatchObject({ subtotal: '300.00', discount: '50.00', total: '250.00' });
        expect(await balanceOf(c.id)).toBe('0.00');
        expect(await auditActions(doc.id)).toContain(`${k.type}.update_draft`);
      });

      it('can change the contact, date, due date, notes and reference without touching the lines', async () => {
        const a = await newContact(owner, 'Contact A');
        const b = await newContact(owner, 'Contact B');
        const doc = await created(a.id, { lines: [line()] });
        const res = await owner.patch(`${k.path}/${doc.id}`, { contactId: b.id, txnDate: '2025-09-01', dueDate: '2025-09-30', notes: 'moved', externalRef: 'REF-9' });
        expect(res.body.data).toMatchObject({ contact: { id: b.id }, txnDate: '2025-09-01', dueDate: '2025-09-30', notes: 'moved', externalRef: 'REF-9' });
        expect(res.body.data.totals.total).toBe('200.00');
        expect(res.body.data.lines).toHaveLength(1);
      });

      it('needs the lines whenever the invoice discount changes, and refuses an empty change', async () => {
        const c = await newContact();
        const doc = await created(c.id);
        expect((await owner.patch(`${k.path}/${doc.id}`, { invoiceDiscount: '10' })).status).toBe(400);
        expect((await owner.patch(`${k.path}/${doc.id}`, {})).status).toBe(400);
        expect((await owner.patch(`${k.path}/${doc.id}`, { lines: [] })).status).toBe(400);
      });

      it('refuses a contact from another business', async () => {
        const c = await newContact();
        const foreign = await newContact(vatOwner);
        const doc = await created(c.id);
        expect((await owner.patch(`${k.path}/${doc.id}`, { contactId: foreign.id })).status).toBe(404);
      });

      it('can be deleted, and then it is gone', async () => {
        const c = await newContact();
        const doc = await created(c.id);
        expect((await owner.delete(`${k.path}/${doc.id}`)).status).toBe(200);
        expect((await owner.get(`${k.path}/${doc.id}`)).status).toBe(404);
        expect((await pool.query('SELECT 1 FROM transaction_lines WHERE transaction_id = $1', [doc.id])).rowCount).toBe(0);
      });
    });

    describe('posting', () => {
      it('numbers it, counts it, and cannot be done twice', async () => {
        const c = await newContact();
        const draft = await created(c.id, { lines: [line({ quantity: '5', unitPrice: '100' })] });
        const res = await owner.post(`${k.path}/${draft.id}/post`);
        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ status: 'posted' });
        expect(res.body.data.referenceNo).toMatch(new RegExp(`^${k.prefix}-`));
        expect(await balanceOf(c.id)).toBe(`${k.sign}500.00`);
        expect((await owner.post(`${k.path}/${draft.id}/post`)).status).toBe(409);
        expect(await balanceOf(c.id)).toBe(`${k.sign}500.00`); // not counted twice
      });

      it('takes its number from the fiscal year of the DOCUMENT date', async () => {
        const c = await newContact();
        const next = fiscalYear(2083);
        const a = await created(c.id, { post: true, txnDate: next.start });
        const b = await created(c.id, { post: true, txnDate: fiscalYear(2081).end });
        expect(a.referenceNo).toMatch(new RegExp(`^${k.prefix}-2083/84-`));
        expect(b.referenceNo).toMatch(new RegExp(`^${k.prefix}-2081/82-`));
      });

      it('gives different numbers to documents posted at the same moment', async () => {
        const c = await newContact();
        const drafts = await Promise.all(Array.from({ length: 6 }, () => created(c.id, { txnDate: fiscalYear(2084).start })));
        const results = await Promise.all(drafts.map((d) => owner.post(`${k.path}/${d.id}/post`)));
        expect(results.every((r) => r.status === 200)).toBe(true);
        const refs = results.map((r) => r.body.data.referenceNo);
        expect(new Set(refs).size).toBe(6);
        expect(await balanceOf(c.id)).toBe(`${k.sign}1200.00`);
      });

      it('is refused when the total is zero (everything discounted away)', async () => {
        const c = await newContact();
        const draft = await created(c.id, { invoiceDiscount: '200' });
        expect(draft.totals.total).toBe('0.00');
        const res = await owner.post(`${k.path}/${draft.id}/post`);
        expect(res.status).toBe(400);
        expect(res.body.error.details[0].message).toMatch(/greater than zero/);
        expect((await owner.get(`${k.path}/${draft.id}`)).body.data.status).toBe('draft');
      });

      it('is refused when the contact was archived after the draft was saved', async () => {
        const c = await newContact();
        const draft = await created(c.id);
        await owner.post(`/api/contacts/${c.id}/archive`);
        expect((await owner.post(`${k.path}/${draft.id}/post`)).status).toBe(409);
      });

      it('uses the business prefix, and a changed prefix applies only to new documents', async () => {
        const c = await newContact(prefixOwner);
        const before = await created(c.id, { post: true }, prefixOwner);
        expect((await prefixOwner.patch('/api/settings', { prefixes: { [k.type]: 'inv' } })).status).toBe(200);
        const after = await created(c.id, { post: true }, prefixOwner);
        expect(before.referenceNo.startsWith(`${k.prefix}-`)).toBe(true);
        expect(after.referenceNo.startsWith('INV-')).toBe(true);
        expect((await prefixOwner.get(`${k.path}/${before.id}`)).body.data.referenceNo).toBe(before.referenceNo);
        await prefixOwner.patch('/api/settings', { prefixes: { [k.type]: k.prefix } });
      });
    });

    describe('a posted document is history', () => {
      it('only its notes and reference can be edited, and that is audited', async () => {
        const c = await newContact();
        const doc = await created(c.id, { post: true, notes: 'first' });
        const res = await owner.patch(`${k.path}/${doc.id}`, { notes: 'second', externalRef: 'BILL-1' });
        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ notes: 'second', externalRef: 'BILL-1', totals: doc.totals, referenceNo: doc.referenceNo });
        const { rows } = await pool.query("SELECT before, after FROM audit_logs WHERE entity_id = $1 AND action = $2", [doc.id, `${k.type}.update_text`]);
        expect(rows[0].before.notes).toBe('first');
        expect(rows[0].after.notes).toBe('second');
      });

      it('refuses to change the amounts, lines, date or contact, and explains what to do instead', async () => {
        const c = await newContact();
        const doc = await created(c.id, { post: true });
        for (const body of [{ lines: [line({ unitPrice: '1' })] }, { txnDate: '2025-09-09' }, { contactId: c.id }, { invoiceDiscount: '5' }, { dueDate: '2025-12-01' }]) {
          const res = await owner.patch(`${k.path}/${doc.id}`, body);
          expect(res.status, JSON.stringify(body)).toBe(409);
          expect(res.body.error.message).toMatch(/Void it and enter a new one/);
        }
        expect(await balanceOf(c.id)).toBe(`${k.sign}200.00`);
      });

      it('cannot be deleted', async () => {
        const c = await newContact();
        const doc = await created(c.id, { post: true });
        const res = await owner.delete(`${k.path}/${doc.id}`);
        expect(res.status).toBe(409);
        expect(res.body.error.message).toMatch(/Void it instead/);
      });

      it('is protected in the database too: no direct SQL can rewrite it', async () => {
        const c = await newContact();
        const doc = await created(c.id, { post: true });
        await expect(pool.query('UPDATE transactions SET total = 1 WHERE id = $1', [doc.id])).rejects.toThrow(/cannot be changed/);
        await expect(pool.query('DELETE FROM transactions WHERE id = $1', [doc.id])).rejects.toThrow(/cannot be deleted/);
        await expect(pool.query("UPDATE transaction_lines SET quantity = 99 WHERE transaction_id = $1", [doc.id])).rejects.toThrow(/cannot be changed/);
        await expect(pool.query('DELETE FROM transaction_lines WHERE transaction_id = $1', [doc.id])).rejects.toThrow(/cannot be changed/);
        expect((await owner.get(`${k.path}/${doc.id}`)).body.data.totals.total).toBe('200.00');
      });
    });

    describe('voiding', () => {
      it('cancels the effect, keeps everything on record, and needs a reason', async () => {
        const c = await newContact();
        const doc = await created(c.id, { post: true });
        expect(await balanceOf(c.id)).toBe(`${k.sign}200.00`);
        expect((await owner.post(`${k.path}/${doc.id}/void`, {})).status).toBe(400);
        expect((await owner.post(`${k.path}/${doc.id}/void`, { reason: 'x' })).status).toBe(400);

        const res = await owner.post(`${k.path}/${doc.id}/void`, { reason: 'Customer returned everything' });
        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ status: 'voided', voidReason: 'Customer returned everything', referenceNo: doc.referenceNo });
        expect(res.body.data.lines).toHaveLength(1);
        expect(await balanceOf(c.id)).toBe('0.00');
        expect((await owner.get(`/api/ledger/contacts/${c.id}`)).body.data.rows).toEqual([]); // no longer a line in the account
        expect(await auditActions(doc.id)).toContain(`${k.type}.void`);
      });

      it('is not possible twice, for a draft, or to undo', async () => {
        const c = await newContact();
        const doc = await created(c.id, { post: true });
        await owner.post(`${k.path}/${doc.id}/void`, { reason: 'first time' });
        expect((await owner.post(`${k.path}/${doc.id}/void`, { reason: 'second time' })).status).toBe(409);
        expect((await owner.post(`${k.path}/${doc.id}/post`)).status).toBe(409);
        expect((await owner.patch(`${k.path}/${doc.id}`, { notes: 'late' })).status).toBe(409);
        expect((await owner.delete(`${k.path}/${doc.id}`)).status).toBe(409);

        const draft = await created(c.id);
        const res = await owner.post(`${k.path}/${draft.id}/void`, { reason: 'drafts are deleted' });
        expect(res.status).toBe(409);
        expect(res.body.error.message).toMatch(/deleted, not voided/);
      });
    });

    describe('who may do what', () => {
      const roleSession = (roleKey) => createMemberSession(app, pool, { businessId: owner.businessId, roleKey, label: `${k.type}-${roleKey}` });

      it('a viewer can read but not create, change, post, delete or void', async () => {
        const c = await newContact();
        const draft = await created(c.id);
        const posted = await created(c.id, { post: true });
        const viewer = await roleSession('viewer');
        expect((await viewer.get(`${k.path}/${posted.id}`)).status).toBe(200);
        expect((await viewer.get(k.path)).status).toBe(200);
        expect((await make(c.id, {}, viewer)).status).toBe(403);
        expect((await viewer.patch(`${k.path}/${draft.id}`, { notes: 'x' })).status).toBe(403);
        expect((await viewer.delete(`${k.path}/${draft.id}`)).status).toBe(403);
        expect((await viewer.post(`${k.path}/${draft.id}/post`)).status).toBe(403);
        expect((await viewer.post(`${k.path}/${posted.id}/void`, { reason: 'not allowed' })).status).toBe(403);
      });

      it('staff can create and post but not void (only the owner and accountant can)', async () => {
        const c = await newContact();
        const staff = await roleSession('staff');
        const posted = (await make(c.id, { post: true }, staff)).body.data;
        expect(posted.status).toBe('posted');
        expect((await staff.post(`${k.path}/${posted.id}/void`, { reason: 'not allowed' })).status).toBe(403);
        const accountant = await roleSession('accountant');
        expect((await accountant.post(`${k.path}/${posted.id}/void`, { reason: 'accountant may void' })).status).toBe(200);
      });
    });
  });
}
