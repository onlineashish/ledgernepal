import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fiscalYear } from '@ledgernepal/shared/dates';
import { createTestApp } from './testApp.js';
import { cleanupApiTestData, createMemberSession, registerUser } from './api.js';

/**
 * The whole test suite for one kind of settlement. tests/integration/receipts.test.js and payments.test.js each
 * call it, so the two are tested identically but run in parallel.
 *   receipt: money IN, applied to sales invoices   (a credit; the customer owes less)
 *   payment: money OUT, applied to purchase bills  (a debit; you owe less)
 */
export function defineSettlementsSuite(k) {
  const { app, pool, close } = createTestApp();
  let owner;
  let other; // a second business, to prove nothing crosses over
  const docSign = k.kind === 'receipt' ? 1 : -1; // a sale raises the balance, a purchase lowers it
  const settleSign = -docSign; // and the settlement does the opposite

  beforeAll(async () => {
    await cleanupApiTestData(pool);
    owner = await registerUser(app, { businessName: 'Settlements Co' });
    other = await registerUser(app, { businessName: 'Other Settlements Co' });
  });
  afterAll(async () => {
    await cleanupApiTestData(pool);
    await close();
  });

  const newContact = async (session = owner, name = 'Ram Traders') => (await session.post('/api/contacts', { name, types: ['customer', 'supplier'] })).body.data;
  const balance = async (contactId, session = owner) => Number((await session.get(`/api/contacts/${contactId}`)).body.data.balance.amount);
  const money = (n) => Number(n);

  const makeDoc = async (contactId, { amount = '1000', date = '2025-08-01', dueDate, session = owner, post = true } = {}) =>
    (await session.post(k.docPath, {
      contactId, txnDate: date, ...(dueDate !== undefined && { dueDate }), post,
      lines: [{ description: 'Goods', quantity: '1', unitPrice: amount }],
    })).body.data;
  const settle = (contactId, amount, extra = {}, session = owner) =>
    session.post(k.path, { contactId, txnDate: '2025-08-10', amount, method: 'cash', ...extra });
  const settled = async (contactId, amount, extra, session) => (await settle(contactId, amount, extra, session)).body.data;
  const getDoc = async (id, session = owner) => (await session.get(`${k.docPath}/${id}`)).body.data;
  const auditActions = async (id) => (await pool.query('SELECT action FROM audit_logs WHERE entity_id = $1 ORDER BY id', [id])).rows.map((r) => r.action);

  describe(`${k.kind}s (${k.path})`, () => {
    describe('recording one', () => {
      it('is posted straight away, numbered, and moves the balance the right way; with nothing applied it is an advance', async () => {
        const c = await newContact();
        const res = await settle(c.id, '400', { externalRef: 'ESEWA-77', description: 'Part payment', notes: 'rang to confirm' });
        expect(res.status).toBe(201);
        expect(res.body.data).toMatchObject({
          type: k.kind, status: 'posted', method: 'cash', amount: '400.00', externalRef: 'ESEWA-77', description: 'Part payment',
          allocated: '0.00', unallocated: '400.00', allocations: [], contact: { id: c.id, name: 'Ram Traders' },
        });
        expect(res.body.data.referenceNo).toMatch(new RegExp(`^${k.prefix}-2082/83-\\d{4}$`));
        expect(await balance(c.id)).toBe(settleSign * 400); // an advance still counts
      });

      it('shows up in the contact’s account and on the Ledger page as its own kind of line', async () => {
        const c = await newContact();
        const s = await settled(c.id, '250');
        const row = (await owner.get(`/api/ledger/contacts/${c.id}`)).body.data.rows[0];
        expect(row).toMatchObject({ type: k.kind, referenceNo: s.referenceNo });
        expect(k.kind === 'receipt' ? row.credit : row.debit).toBe('250.00');
        const entry = (await owner.get(`/api/ledger/entries?contactId=${c.id}&type=${k.kind}`)).body.data[0];
        expect(entry).toMatchObject({ id: s.id, type: k.kind, direction: null, effect: k.effect });
      });

      it.each(['cash', 'bank_transfer', 'cheque', 'esewa', 'khalti', 'other'])('accepts the method "%s"', async (method) => {
        const c = await newContact();
        expect((await settle(c.id, '10', { method })).body.data.method).toBe(method);
      });

      it('numbers receipts and payments separately from each other and from invoices', async () => {
        const solo = await registerUser(app, { businessName: 'Numbering Settlements Co' });
        const c = await newContact(solo);
        await makeDoc(c.id, { session: solo });
        expect((await settled(c.id, '1', {}, solo)).referenceNo).toBe(`${k.prefix}-2082/83-0001`);
        expect((await settled(c.id, '1', {}, solo)).referenceNo).toBe(`${k.prefix}-2082/83-0002`);
      });

      it('writes an audit entry', async () => {
        const c = await newContact();
        const s = await settled(c.id, '5');
        expect(await auditActions(s.id)).toEqual([`${k.kind}.create`]);
      });

      it.each([
        ['zero amount', { amount: '0' }, 'amount', /greater than zero/],
        ['negative amount', { amount: '-5' }, 'amount', /negative|greater than zero|Enter an amount/],
        ['amount with 3 decimals', { amount: '1.234' }, 'amount', /2 decimal places/],
        ['no method', { method: undefined }, 'method', /Choose how/],
        ['unknown method', { method: 'bitcoin' }, 'method', /Choose how/],
        ['impossible date', { txnDate: '2025-02-30' }, 'txnDate', /real date/],
        ['reference too long', { externalRef: 'x'.repeat(61) }, 'externalRef', /at most 60/],
      ])('rejects %s with a clear message', async (_label, override, field, message) => {
        const c = await newContact();
        const res = await settle(c.id, '100', override);
        expect(res.status).toBe(400);
        const detail = res.body.error.details.find((d) => d.field === field);
        expect(detail, JSON.stringify(res.body.error.details)).toBeDefined();
        expect(detail.message).toMatch(message);
      });

      it('rejects fields the client must not set', async () => {
        const c = await newContact();
        for (const extra of [{ status: 'voided' }, { effect: 'debit' }, { referenceNo: 'X-1' }, { total: '1' }, { businessId: owner.businessId }, { type: 'sale' }]) {
          expect((await settle(c.id, '10', extra)).status, JSON.stringify(extra)).toBe(400);
        }
      });

      it('an unknown contact, another business’s contact, or an archived contact', async () => {
        expect((await settle('00000000-0000-4000-8000-000000000000', '10')).status).toBe(404);
        expect((await settle((await newContact(other)).id, '10')).status).toBe(404);
        const c = await newContact();
        await owner.post(`/api/contacts/${c.id}/archive`);
        expect((await settle(c.id, '10')).status).toBe(409);
      });
    });

    describe('applying it to invoices or bills', () => {
      it('part-pays one document: it becomes partly paid, with the payment listed on it', async () => {
        const c = await newContact();
        const doc = await makeDoc(c.id, { amount: '1000' });
        expect(doc).toMatchObject({ paymentStatus: 'unpaid', paid: '0.00', outstanding: '1000.00' });

        const s = await settled(c.id, '400', { allocations: [{ invoiceId: doc.id, amount: '400' }] });
        expect(s).toMatchObject({ allocated: '400.00', unallocated: '0.00' });
        expect(s.allocations[0]).toMatchObject({ amount: '400.00', document: { id: doc.id, referenceNo: doc.referenceNo, total: '1000.00' } });

        const after = await getDoc(doc.id);
        expect(after).toMatchObject({ paymentStatus: 'partially_paid', paid: '400.00', outstanding: '600.00' });
        expect(after.payments).toEqual([{ id: expect.any(String), amount: '400.00', payment: { id: s.id, type: k.kind, referenceNo: s.referenceNo, txnDate: '2025-08-10', method: 'cash' } }]);
        expect(await balance(c.id)).toBe(docSign * 600); // 1000 owed, 400 settled
      });

      it('several settlements pay one document off, one after another', async () => {
        const c = await newContact();
        const doc = await makeDoc(c.id, { amount: '1000' });
        await settled(c.id, '300', { allocations: [{ invoiceId: doc.id, amount: '300' }] });
        await settled(c.id, '300', { allocations: [{ invoiceId: doc.id, amount: '300' }] });
        expect(await getDoc(doc.id)).toMatchObject({ paymentStatus: 'partially_paid', outstanding: '400.00' });
        await settled(c.id, '400', { allocations: [{ invoiceId: doc.id, amount: '400' }] });
        const done = await getDoc(doc.id);
        expect(done).toMatchObject({ paymentStatus: 'paid', paid: '1000.00', outstanding: '0.00' });
        expect(done.payments).toHaveLength(3);
        expect(await balance(c.id)).toBe(0);
      });

      it('one settlement can be spread over several documents, leaving the rest as an advance', async () => {
        const c = await newContact();
        const [a, b] = [await makeDoc(c.id, { amount: '300' }), await makeDoc(c.id, { amount: '300', date: '2025-08-02' })];
        const s = await settled(c.id, '700', { allocations: [{ invoiceId: a.id, amount: '300' }, { invoiceId: b.id, amount: '250' }] });
        expect(s).toMatchObject({ allocated: '550.00', unallocated: '150.00' });
        expect(s.allocations).toHaveLength(2);
        expect((await getDoc(a.id)).paymentStatus).toBe('paid');
        expect((await getDoc(b.id))).toMatchObject({ paymentStatus: 'partially_paid', outstanding: '50.00' });
        expect(await balance(c.id)).toBe(docSign * 600 + settleSign * 700); // applying does not change the balance; only the postings do
      });

      it('applying never changes the balance: the same money applied or not gives the same balance', async () => {
        const c1 = await newContact();
        const c2 = await newContact();
        const d1 = await makeDoc(c1.id, { amount: '500' });
        await makeDoc(c2.id, { amount: '500' });
        await settled(c1.id, '200', { allocations: [{ invoiceId: d1.id, amount: '200' }] });
        await settled(c2.id, '200');
        expect(await balance(c1.id)).toBe(await balance(c2.id));
      });

      it('is refused, saving nothing, when it is more than is outstanding on a document', async () => {
        const c = await newContact();
        const doc = await makeDoc(c.id, { amount: '100' });
        const res = await settle(c.id, '500', { allocations: [{ invoiceId: doc.id, amount: '100.01' }] });
        expect(res.status).toBe(400);
        expect(res.body.error.details[0]).toMatchObject({ field: 'allocations.0.amount' });
        expect(res.body.error.details[0].message).toMatch(/Only 100.00 is still outstanding/);
        expect((await owner.get(`${k.path}?contactId=${c.id}`)).body.data).toEqual([]); // the whole request rolled back
        expect(await balance(c.id)).toBe(docSign * 100);
      });

      it('is refused when the amounts add up to more than the money, or name a document twice', async () => {
        const c = await newContact();
        const [a, b] = [await makeDoc(c.id, { amount: '500' }), await makeDoc(c.id, { amount: '500' })];
        const over = await settle(c.id, '100', { allocations: [{ invoiceId: a.id, amount: '60' }, { invoiceId: b.id, amount: '60' }] });
        expect(over.status).toBe(400);
        expect(over.body.error.details[0].message).toMatch(/add up to 120.00, but only 100.00/);
        const twice = await settle(c.id, '100', { allocations: [{ invoiceId: a.id, amount: '10' }, { invoiceId: a.id, amount: '10' }] });
        expect(twice.status).toBe(400);
        expect(twice.body.error.details[0].message).toMatch(/only once/);
      });

      it('is refused for a document of a different contact', async () => {
        const [c1, c2] = [await newContact(owner, 'First'), await newContact(owner, 'Second')];
        const theirs = await makeDoc(c2.id);
        const res = await settle(c1.id, '100', { allocations: [{ invoiceId: theirs.id, amount: '100' }] });
        expect(res.status).toBe(400);
        expect(res.body.error.details[0].message).toMatch(/different contact/);
      });

      it('is refused for the wrong kind of document, another business’s document, and one that does not exist', async () => {
        const c = await newContact();
        const wrongKindPath = k.kind === 'receipt' ? '/api/purchases' : '/api/sales';
        const wrongKind = (await owner.post(wrongKindPath, { contactId: c.id, txnDate: '2025-08-01', post: true, lines: [{ description: 'x', quantity: '1', unitPrice: '100' }] })).body.data;
        const foreignContact = await newContact(other);
        const foreignDoc = (await other.post(k.docPath, { contactId: foreignContact.id, txnDate: '2025-08-01', post: true, lines: [{ description: 'x', quantity: '1', unitPrice: '100' }] })).body.data;
        for (const invoiceId of [wrongKind.id, foreignDoc.id, '00000000-0000-4000-8000-000000000000']) {
          const res = await settle(c.id, '100', { allocations: [{ invoiceId, amount: '10' }] });
          expect(res.status, invoiceId).toBe(404);
        }
        expect((await owner.get(`${k.path}?contactId=${c.id}`)).body.data).toEqual([]);
      });

      it('is refused for a draft or voided document', async () => {
        const c = await newContact();
        const draft = await makeDoc(c.id, { post: false });
        const voided = await makeDoc(c.id);
        await owner.post(`${k.docPath}/${voided.id}/void`, { reason: 'cancelled for test' });
        for (const doc of [draft, voided]) {
          const res = await settle(c.id, '10', { allocations: [{ invoiceId: doc.id, amount: '10' }] });
          expect(res.status).toBe(409);
          expect(res.body.error.message).toMatch(/Only posted documents can be paid/);
        }
      });

      it('rejects a malformed allocation list, and asking for both kinds at once', async () => {
        const c = await newContact();
        const doc = await makeDoc(c.id);
        expect((await settle(c.id, '10', { allocations: [{ invoiceId: 'nope', amount: '10' }] })).status).toBe(400);
        expect((await settle(c.id, '10', { allocations: [{ invoiceId: doc.id, amount: '0' }] })).status).toBe(400);
        expect((await settle(c.id, '10', { allocations: [{ invoiceId: doc.id, amount: '5', extra: 1 }] })).status).toBe(400);
        const both = await settle(c.id, '10', { autoAllocate: true, allocations: [{ invoiceId: doc.id, amount: '5' }] });
        expect(both.status).toBe(400);
        expect(both.body.error.details[0].message).toMatch(/either specific documents or "apply oldest first"/);
      });
    });

    describe('"apply oldest first"', () => {
      it('settles the earliest documents first, and keeps any surplus as an advance', async () => {
        const c = await newContact();
        const newest = await makeDoc(c.id, { amount: '300', date: '2025-08-09' });
        const oldest = await makeDoc(c.id, { amount: '300', date: '2025-08-01' });
        const middle = await makeDoc(c.id, { amount: '300', date: '2025-08-05' });
        const s = await settled(c.id, '700', { autoAllocate: true });
        expect(s).toMatchObject({ allocated: '700.00', unallocated: '0.00' });
        expect((await getDoc(oldest.id)).paymentStatus).toBe('paid');
        expect((await getDoc(middle.id)).paymentStatus).toBe('paid');
        expect(await getDoc(newest.id)).toMatchObject({ paymentStatus: 'partially_paid', paid: '100.00' });

        const more = await settled(c.id, '1000', { autoAllocate: true });
        expect(more).toMatchObject({ allocated: '200.00', unallocated: '800.00' }); // only 200 was left outstanding
      });

      it('with nothing to apply to, it is simply an advance', async () => {
        const c = await newContact();
        const s = await settled(c.id, '100', { autoAllocate: true });
        expect(s).toMatchObject({ allocated: '0.00', unallocated: '100.00', allocations: [] });
      });

      it('can be done later for an advance, and doing it again changes nothing', async () => {
        const c = await newContact();
        const s = await settled(c.id, '500');
        const doc = await makeDoc(c.id, { amount: '300' });
        const applied = await owner.post(`${k.path}/${s.id}/auto-allocate`);
        expect(applied.status).toBe(200);
        expect(applied.body.data).toMatchObject({ allocated: '300.00', unallocated: '200.00' });
        expect((await getDoc(doc.id)).paymentStatus).toBe('paid');
        const again = await owner.post(`${k.path}/${s.id}/auto-allocate`);
        expect(again.body.data).toMatchObject({ allocated: '300.00', unallocated: '200.00' });
        expect(await auditActions(s.id)).toEqual([`${k.kind}.create`, `${k.kind}.auto_allocate`]);
      });
    });

    describe('topping up a partly applied one', () => {
      // Found by the randomized consistency test: applying the rest of a receipt that already pays PART of an
      // invoice tried to add a second allocation for the same pair and failed with a 500.
      it('adds to the document it already pays instead of failing, and still fills the next ones', async () => {
        const c = await newContact();
        const first = await makeDoc(c.id, { amount: '500', date: '2025-08-01' });
        const second = await makeDoc(c.id, { amount: '300', date: '2025-08-05' });
        const s = await settled(c.id, '600', { allocations: [{ invoiceId: first.id, amount: '200' }] });
        expect(s).toMatchObject({ allocated: '200.00', unallocated: '400.00' });

        const res = await owner.post(`${k.path}/${s.id}/auto-allocate`);
        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ allocated: '600.00', unallocated: '0.00' });
        expect(res.body.data.allocations.map((a) => [a.document.id, a.amount])).toEqual([[first.id, '500.00'], [second.id, '100.00']]);
        expect(await getDoc(first.id)).toMatchObject({ paymentStatus: 'paid', paid: '500.00' });
        expect(await getDoc(second.id)).toMatchObject({ paymentStatus: 'partially_paid', paid: '100.00' });
        const live = await pool.query("SELECT count(*)::int AS n FROM payment_allocations WHERE payment_txn_id = $1 AND invoice_txn_id = $2 AND status = 'active'", [s.id, first.id]);
        expect(live.rows[0].n).toBe(1);
        expect(await balance(c.id)).toBe(docSign * 800 + settleSign * 600);
      });
    });

    describe('changing what it is applied to', () => {
      it('moves the money from one document to another', async () => {
        const c = await newContact();
        const [a, b] = [await makeDoc(c.id, { amount: '400' }), await makeDoc(c.id, { amount: '400' })];
        const s = await settled(c.id, '400', { allocations: [{ invoiceId: a.id, amount: '400' }] });
        const moved = await owner.put(`${k.path}/${s.id}/allocations`, { allocations: [{ invoiceId: b.id, amount: '400' }] });
        expect(moved.status).toBe(200);
        expect(moved.body.data.allocations.map((x) => x.document.id)).toEqual([b.id]);
        expect((await getDoc(a.id)).paymentStatus).toBe('unpaid');
        expect((await getDoc(b.id)).paymentStatus).toBe('paid');
        expect(await balance(c.id)).toBe(docSign * 400); // 800 owed, 400 settled; unchanged by the move
        expect(await auditActions(s.id)).toContain(`${k.kind}.reallocate`);
      });

      it('an empty list turns it back into an advance', async () => {
        const c = await newContact();
        const doc = await makeDoc(c.id, { amount: '400' });
        const s = await settled(c.id, '400', { allocations: [{ invoiceId: doc.id, amount: '400' }] });
        const res = await owner.put(`${k.path}/${s.id}/allocations`, { allocations: [] });
        expect(res.body.data).toMatchObject({ allocated: '0.00', unallocated: '400.00', allocations: [] });
        expect((await getDoc(doc.id)).paymentStatus).toBe('unpaid');
      });

      it('a refused change keeps the old allocations exactly as they were', async () => {
        const c = await newContact();
        const [a, b] = [await makeDoc(c.id, { amount: '400' }), await makeDoc(c.id, { amount: '50' })];
        const s = await settled(c.id, '400', { allocations: [{ invoiceId: a.id, amount: '400' }] });
        const bad = await owner.put(`${k.path}/${s.id}/allocations`, { allocations: [{ invoiceId: b.id, amount: '60' }] });
        expect(bad.status).toBe(400);
        const still = (await owner.get(`${k.path}/${s.id}`)).body.data;
        expect(still.allocations.map((x) => [x.document.id, x.amount])).toEqual([[a.id, '400.00']]);
        expect((await getDoc(a.id)).paymentStatus).toBe('paid');
      });

      it('can be fixed for the notes only: description, notes and reference, never the amount', async () => {
        const c = await newContact();
        const s = await settled(c.id, '100', { description: 'Rcvd' });
        const res = await owner.patch(`${k.path}/${s.id}`, { description: 'Received in cash', notes: 'counted twice', externalRef: 'RCPT-9' });
        expect(res.body.data).toMatchObject({ description: 'Received in cash', notes: 'counted twice', externalRef: 'RCPT-9', amount: '100.00', referenceNo: s.referenceNo });
        for (const body of [{ amount: '5' }, { txnDate: '2025-09-09' }, { method: 'cheque' }, { contactId: c.id }, {}]) {
          expect((await owner.patch(`${k.path}/${s.id}`, body)).status, JSON.stringify(body)).toBe(400);
        }
        expect(await balance(c.id)).toBe(settleSign * 100);
      });
    });

    describe('voiding', () => {
      it('releases what it paid: the documents become unpaid again and the balance goes back', async () => {
        const c = await newContact();
        const doc = await makeDoc(c.id, { amount: '1000' });
        const s = await settled(c.id, '1000', { allocations: [{ invoiceId: doc.id, amount: '1000' }] });
        expect((await getDoc(doc.id)).paymentStatus).toBe('paid');

        expect((await owner.post(`${k.path}/${s.id}/void`, {})).status).toBe(400); // a reason is needed
        const res = await owner.post(`${k.path}/${s.id}/void`, { reason: 'Cheque bounced' });
        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ status: 'voided', voidReason: 'Cheque bounced', allocated: '0.00', unallocated: '0.00', allocations: [] });
        expect(await getDoc(doc.id)).toMatchObject({ paymentStatus: 'unpaid', outstanding: '1000.00', payments: [] });
        expect(await balance(c.id)).toBe(docSign * 1000);
        const { rows } = await pool.query("SELECT metadata FROM audit_logs WHERE entity_id = $1 AND action = $2", [s.id, `${k.kind}.void`]);
        expect(rows[0].metadata).toMatchObject({ reason: 'Cheque bounced', releasedAllocations: 1 });
      });

      it('cannot be done twice, and a voided one cannot be changed or applied', async () => {
        const c = await newContact();
        const s = await settled(c.id, '100');
        await owner.post(`${k.path}/${s.id}/void`, { reason: 'entered twice by mistake' });
        expect((await owner.post(`${k.path}/${s.id}/void`, { reason: 'again please' })).status).toBe(409);
        expect((await owner.patch(`${k.path}/${s.id}`, { notes: 'late' })).status).toBe(409);
        expect((await owner.put(`${k.path}/${s.id}/allocations`, { allocations: [] })).status).toBe(409);
        expect((await owner.post(`${k.path}/${s.id}/auto-allocate`)).status).toBe(409);
        expect(await balance(c.id)).toBe(0);
      });

      it('voiding an invoice or bill that was paid releases the payments, which go back to being advances', async () => {
        const c = await newContact();
        const doc = await makeDoc(c.id, { amount: '600' });
        const s = await settled(c.id, '600', { allocations: [{ invoiceId: doc.id, amount: '600' }] });
        const res = await owner.post(`${k.docPath}/${doc.id}/void`, { reason: 'Goods returned' });
        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ status: 'voided', payments: [], paymentStatus: null });
        const after = (await owner.get(`${k.path}/${s.id}`)).body.data;
        expect(after).toMatchObject({ status: 'posted', allocated: '0.00', unallocated: '600.00' });
        expect(await balance(c.id)).toBe(settleSign * 600); // the invoice no longer counts; the money received still does
        const { rows } = await pool.query("SELECT metadata FROM audit_logs WHERE entity_id = $1 AND action = $2", [doc.id, `${k.docType}.void`]);
        expect(rows[0].metadata).toMatchObject({ releasedPayments: 1, releasedAmount: '600.00' });
      });

      it('the database refuses to void a document that still has live allocations behind the application’s back', async () => {
        const c = await newContact();
        const doc = await makeDoc(c.id);
        await settled(c.id, '100', { allocations: [{ invoiceId: doc.id, amount: '100' }] });
        await expect(
          pool.query("UPDATE transactions SET status = 'voided', voided_at = now(), voided_by = $2, void_reason = 'sneaky' WHERE id = $1", [doc.id, owner.user.id]),
        ).rejects.toThrow(/Cancel the allocations/);
      });
    });

    describe('open documents (the "apply to…" picker)', () => {
      it('lists the contact’s unpaid and part-paid documents, oldest first, with what is outstanding', async () => {
        const c = await newContact();
        const late = await makeDoc(c.id, { amount: '500', date: '2025-08-05', dueDate: '2025-08-06' });
        const early = await makeDoc(c.id, { amount: '300', date: '2025-08-01' });
        const done = await makeDoc(c.id, { amount: '100', date: '2025-08-02' });
        await settled(c.id, '100', { allocations: [{ invoiceId: done.id, amount: '100' }] });
        await settled(c.id, '50', { allocations: [{ invoiceId: late.id, amount: '50' }] });
        await makeDoc(c.id, { post: false }); // a draft is not open yet
        const res = await owner.get(`${k.path}/open-documents?contactId=${c.id}`);
        expect(res.status).toBe(200);
        expect(res.body.data.map((d) => [d.id, d.total, d.paid, d.outstanding, d.overdue])).toEqual([
          [early.id, '300.00', '0.00', '300.00', false],
          [late.id, '500.00', '50.00', '450.00', true],
        ]);
      });

      it('needs a contact, finds only this business’s, and respects who may record money', async () => {
        expect((await owner.get(`${k.path}/open-documents`)).status).toBe(400);
        expect((await owner.get(`${k.path}/open-documents?contactId=${(await newContact(other)).id}`)).status).toBe(404);
        const viewer = await createMemberSession(app, pool, { businessId: owner.businessId, roleKey: 'viewer', label: `${k.kind}-viewer` });
        expect((await viewer.get(`${k.path}/open-documents?contactId=${(await newContact()).id}`)).status).toBe(403);
      });
    });

    describe('reading and listing', () => {
      it('gets one with what it is applied to, and 404s for an unknown id or the other kind', async () => {
        const c = await newContact();
        const doc = await makeDoc(c.id);
        const s = await settled(c.id, '100', { allocations: [{ invoiceId: doc.id, amount: '100' }] });
        expect((await owner.get(`${k.path}/${s.id}`)).body.data.allocations).toHaveLength(1);
        expect((await owner.get(`${k.path}/00000000-0000-4000-8000-000000000000`)).status).toBe(404);
        expect((await owner.get(`${k.path}/not-a-uuid`)).status).toBe(400);
        expect((await owner.get(`${k.otherPath}/${s.id}`)).status).toBe(404);
      });

      it('filters by contact, method, date, status, advances only, and search text', async () => {
        const c = await newContact(owner, 'List Subject');
        const doc = await makeDoc(c.id, { amount: '1000' });
        const a = await settled(c.id, '100', { method: 'cheque', txnDate: '2025-08-02', externalRef: 'CHQ-0042' });
        const b = await settled(c.id, '200', { method: 'esewa', txnDate: '2025-08-12', allocations: [{ invoiceId: doc.id, amount: '200' }] });
        const gone = await settled(c.id, '300', { txnDate: '2025-08-20' });
        await owner.post(`${k.path}/${gone.id}/void`, { reason: 'list test void' });
        const ids = async (qs) => (await owner.get(`${k.path}?contactId=${c.id}&${qs}`)).body.data.map((x) => x.id);

        expect((await ids('')).sort()).toEqual([a.id, b.id].sort()); // posted by default
        expect(await ids('status=voided')).toEqual([gone.id]);
        expect((await ids('status=all')).length).toBe(3);
        expect(await ids('method=cheque')).toEqual([a.id]);
        expect(await ids('from=2025-08-10&to=2025-08-15')).toEqual([b.id]);
        expect(await ids('allocation=unallocated')).toEqual([a.id]); // only the advance
        expect(await ids('q=CHQ-0042')).toEqual([a.id]);
        expect(await ids(`q=${encodeURIComponent('%')}`)).toEqual([]);
        expect((await owner.get(`${k.path}?method=bitcoin`)).status).toBe(400);
        const page = (await owner.get(`${k.path}?contactId=${c.id}&status=all&pageSize=2&page=2`)).body;
        expect(page.meta).toEqual({ page: 2, pageSize: 2, total: 3 });
      });
    });

    describe('paid and overdue on the invoices or bills', () => {
      it('lists documents by how much has been paid', async () => {
        const c = await newContact(owner, 'Paid Filter');
        const unpaid = await makeDoc(c.id, { amount: '100' });
        const partial = await makeDoc(c.id, { amount: '100' });
        const paid = await makeDoc(c.id, { amount: '100' });
        const draft = await makeDoc(c.id, { post: false });
        await settled(c.id, '40', { allocations: [{ invoiceId: partial.id, amount: '40' }] });
        await settled(c.id, '100', { allocations: [{ invoiceId: paid.id, amount: '100' }] });
        const ids = async (payment) => (await owner.get(`${k.docPath}?contactId=${c.id}&payment=${payment}`)).body.data.map((d) => d.id).sort();

        expect(await ids('unpaid')).toEqual([unpaid.id]);
        expect(await ids('partial')).toEqual([partial.id]);
        expect(await ids('paid')).toEqual([paid.id]);
        expect(await ids('open')).toEqual([unpaid.id, partial.id].sort());
        expect((await ids('all')).length).toBe(4); // including the draft
        expect(await ids('all')).toContain(draft.id);
        expect((await owner.get(`${k.docPath}?payment=bogus`)).status).toBe(400);
      });

      it('overdue means past the due date AND still owing something; a draft or a paid document never is', async () => {
        const c = await newContact(owner, 'Overdue Filter');
        const late = await makeDoc(c.id, { amount: '100', date: '2025-08-01', dueDate: '2025-08-10' });
        const latePaid = await makeDoc(c.id, { amount: '100', date: '2025-08-01', dueDate: '2025-08-10' });
        const future = await makeDoc(c.id, { amount: '100', date: '2025-08-01', dueDate: '2039-01-01' });
        const noDue = await makeDoc(c.id, { amount: '100', date: '2025-08-01' });
        const draft = await makeDoc(c.id, { post: false, dueDate: '2025-08-10' });
        await settled(c.id, '100', { allocations: [{ invoiceId: latePaid.id, amount: '100' }] });

        const overdue = (await owner.get(`${k.docPath}?contactId=${c.id}&payment=overdue`)).body.data.map((d) => d.id);
        expect(overdue).toEqual([late.id]);
        expect((await getDoc(late.id)).overdue).toBe(true);
        for (const doc of [latePaid, future, noDue]) expect((await getDoc(doc.id)).overdue, doc.id).toBe(false);
        expect(await getDoc(draft.id)).toMatchObject({ overdue: false, paymentStatus: null, paid: null, outstanding: null });
      });

      it('shows paid, outstanding and status on every row of the list', async () => {
        const c = await newContact(owner, 'Row Info');
        const doc = await makeDoc(c.id, { amount: '250' });
        await settled(c.id, '100', { allocations: [{ invoiceId: doc.id, amount: '100' }] });
        const row = (await owner.get(`${k.docPath}?contactId=${c.id}`)).body.data[0];
        expect(row).toMatchObject({ id: doc.id, total: '250.00', paid: '100.00', outstanding: '150.00', paymentStatus: 'partially_paid', overdue: false });
      });
    });

    describe('under pressure', () => {
      it('two settlements racing to pay the same document cannot both succeed beyond what is owed', async () => {
        const c = await newContact();
        const doc = await makeDoc(c.id, { amount: '1000' });
        const results = await Promise.all([
          settle(c.id, '600', { allocations: [{ invoiceId: doc.id, amount: '600' }] }),
          settle(c.id, '600', { allocations: [{ invoiceId: doc.id, amount: '600' }] }),
        ]);
        expect(results.map((r) => r.status).sort()).toEqual([201, 400]);
        const after = await getDoc(doc.id);
        expect(after).toMatchObject({ paid: '600.00', outstanding: '400.00' });
        expect((await owner.get(`${k.path}?contactId=${c.id}`)).body.data).toHaveLength(1); // the loser rolled back completely
      });

      it('many settlements at once get different numbers and the books stay consistent', async () => {
        const c = await newContact();
        const results = await Promise.all(Array.from({ length: 6 }, () => settle(c.id, '10', { txnDate: fiscalYear(2085).start })));
        expect(results.every((r) => r.status === 201)).toBe(true);
        expect(new Set(results.map((r) => r.body.data.referenceNo)).size).toBe(6);
        expect(await balance(c.id)).toBe(settleSign * 60);
      });
    });

    describe('who may do what', () => {
      const roleSession = (roleKey) => createMemberSession(app, pool, { businessId: owner.businessId, roleKey, label: `${k.kind}-${roleKey}` });

      it('a viewer can read but not record, change, apply or void', async () => {
        const c = await newContact();
        const s = await settled(c.id, '10');
        const viewer = await roleSession('viewer');
        expect((await viewer.get(`${k.path}/${s.id}`)).status).toBe(200);
        expect((await settle(c.id, '10', {}, viewer)).status).toBe(403);
        expect((await viewer.patch(`${k.path}/${s.id}`, { notes: 'x' })).status).toBe(403);
        expect((await viewer.put(`${k.path}/${s.id}/allocations`, { allocations: [] })).status).toBe(403);
        expect((await viewer.post(`${k.path}/${s.id}/auto-allocate`)).status).toBe(403);
        expect((await viewer.post(`${k.path}/${s.id}/void`, { reason: 'not allowed' })).status).toBe(403);
      });

      it('an accountant can void; and money out is hidden from staff', async () => {
        const c = await newContact();
        const s = await settled(c.id, '10');
        const accountant = await roleSession('accountant');
        expect((await accountant.post(`${k.path}/${s.id}/void`, { reason: 'accountant may void' })).status).toBe(200);
        const staff = await roleSession('staff');
        if (k.kind === 'receipt') {
          expect((await settle(c.id, '5', {}, staff)).status).toBe(201); // staff record receipts...
          expect((await staff.post(`${k.path}/${s.id}/void`, { reason: 'staff may not void' })).status).toBe(403); // ...but cannot void
        } else {
          expect((await settle(c.id, '5', {}, staff)).status).toBe(403); // staff do not handle payments out at all
          expect((await staff.get(k.path)).status).toBe(403);
        }
      });
    });

    describe('the books stay consistent through all of this', () => {
      it('every contact’s balance equals the sum of its posted transactions, and nothing is over-applied', async () => {
        const wrongBalances = await pool.query(
          `SELECT c.id FROM contacts c
            WHERE c.business_id = $1
              AND (SELECT COALESCE(SUM(CASE t.effect WHEN 'debit' THEN t.total ELSE -t.total END), 0) FROM transactions t
                    WHERE t.business_id = c.business_id AND t.contact_id = c.id AND t.status = 'posted')
                  <> (SELECT COALESCE(SUM(CASE t.effect WHEN 'debit' THEN t.total ELSE -t.total END), 0) FROM transactions t
                       WHERE t.business_id = c.business_id AND t.contact_id = c.id AND t.status = 'posted' AND t.type IN ('sale','purchase','receipt','payment','ledger_entry','opening_balance'))`,
          [owner.businessId],
        );
        expect(wrongBalances.rowCount).toBe(0);

        const overPaidDocuments = await pool.query(
          `SELECT i.id FROM transactions i JOIN payment_allocations a ON a.invoice_txn_id = i.id AND a.status = 'active'
            WHERE i.business_id = $1 GROUP BY i.id, i.total HAVING SUM(a.amount) > i.total`,
          [owner.businessId],
        );
        const overAppliedPayments = await pool.query(
          `SELECT p.id FROM transactions p JOIN payment_allocations a ON a.payment_txn_id = p.id AND a.status = 'active'
            WHERE p.business_id = $1 GROUP BY p.id, p.total HAVING SUM(a.amount) > p.total`,
          [owner.businessId],
        );
        const onVoided = await pool.query(
          `SELECT a.id FROM payment_allocations a JOIN transactions t ON t.id IN (a.payment_txn_id, a.invoice_txn_id)
            WHERE a.business_id = $1 AND a.status = 'active' AND t.status <> 'posted'`,
          [owner.businessId],
        );
        expect(overPaidDocuments.rowCount).toBe(0);
        expect(overAppliedPayments.rowCount).toBe(0);
        expect(onVoided.rowCount).toBe(0);
      });
    });
  });
}
