import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fiscalYear } from '@ledgernepal/shared/dates';
import { createTestApp } from '../helpers/testApp.js';
import { cleanupApiTestData, createMemberSession, registerUser } from '../helpers/api.js';

const { app, pool, close } = createTestApp();
let owner;

beforeAll(async () => {
  await cleanupApiTestData(pool);
  owner = await registerUser(app, { businessName: 'Ledger Co' });
});
afterAll(async () => {
  await cleanupApiTestData(pool);
  await close();
});

const newContact = async (name = 'Ram Bahadur', extra = {}) =>
  (await owner.post('/api/contacts', { name, types: ['customer'], ...extra })).body.data;
const entry = (contactId, overrides = {}) =>
  owner.post('/api/ledger/entries', { contactId, txnDate: '2025-08-01', direction: 'you_gave', amount: '1000.00', ...overrides });
const balanceOf = async (contactId) => (await owner.get(`/api/contacts/${contactId}`)).body.data.balance;
const auditActions = async (entityId) =>
  (await pool.query('SELECT action FROM audit_logs WHERE entity_id = $1 ORDER BY id', [entityId])).rows.map((r) => r.action);

describe('adding a direct ledger entry', () => {
  it('"You gave" raises what the contact owes; "You got" lowers it', async () => {
    const c = await newContact();
    expect(await balanceOf(c.id)).toEqual({ amount: '0.00', side: 'settled' });

    const gave = await entry(c.id, { direction: 'you_gave', amount: '5000' });
    expect(gave.status).toBe(201);
    expect(gave.body.data).toMatchObject({ type: 'ledger_entry', status: 'posted', direction: 'you_gave', effect: 'debit', amount: '5000.00', contact: { id: c.id, name: 'Ram Bahadur' } });
    expect(await balanceOf(c.id)).toEqual({ amount: '5000.00', side: 'receivable' });

    await entry(c.id, { direction: 'you_got', amount: '1250.50' });
    expect(await balanceOf(c.id)).toEqual({ amount: '3749.50', side: 'receivable' });

    await entry(c.id, { direction: 'you_got', amount: '4000' }); // more than they owed: now you owe them
    expect(await balanceOf(c.id)).toEqual({ amount: '-250.50', side: 'payable' });
  });

  it('gets a reference number like LE-<fiscal year>-0001, counting up, and records who made it', async () => {
    const c = await newContact();
    const fy = fiscalYear(2082);
    const first = (await entry(c.id, { txnDate: fy.start })).body.data;
    const second = (await entry(c.id, { txnDate: fy.start })).body.data;
    expect(first.referenceNo).toMatch(/^LE-2082\/83-\d{4}$/);
    expect(Number(second.referenceNo.slice(-4))).toBe(Number(first.referenceNo.slice(-4)) + 1);
    expect(first.createdBy).toMatchObject({ id: owner.user.id, fullName: 'Test User' });
    expect(first.createdAt).toBeTruthy();
  });

  it('keeps a person-supplied reference separate from the system number', async () => {
    const c = await newContact();
    const res = (await entry(c.id, { externalRef: 'CHQ-0042', description: 'Cheque for goods' })).body.data;
    expect(res).toMatchObject({ externalRef: 'CHQ-0042', description: 'Cheque for goods' });
    expect(res.referenceNo).not.toBe('CHQ-0042');
  });

  it('writes an audit entry with the details', async () => {
    const c = await newContact();
    const e = (await entry(c.id, { amount: '77.70' })).body.data;
    expect(await auditActions(e.id)).toEqual(['ledger.entry_create']);
    const { rows } = await pool.query("SELECT business_id, actor_user_id, after FROM audit_logs WHERE entity_id = $1", [e.id]);
    expect(rows[0]).toMatchObject({ business_id: owner.businessId, actor_user_id: owner.user.id });
    expect(rows[0].after).toMatchObject({ amount: '77.70', effect: 'debit', contactId: c.id });
  });

  it.each([
    ['zero', { amount: '0' }, 'amount', /greater than zero/],
    ['negative', { amount: '-5' }, 'amount', /negative|greater than zero|Enter an amount/],
    ['three decimals', { amount: '10.123' }, 'amount', /2 decimal places/],
    ['text', { amount: 'abc' }, 'amount', /Enter an amount/],
    ['missing amount', { amount: undefined }, 'amount', /required/],
    ['unknown direction', { direction: 'credit' }, 'direction', /You gave/],
    ['impossible date', { txnDate: '2025-02-30' }, 'txnDate', /real date/],
    ['date out of range', { txnDate: '2100-01-01' }, 'txnDate', /between/],
    ['missing date', { txnDate: undefined }, 'txnDate', /required/],
    ['description too long', { description: 'x'.repeat(501) }, 'description', /at most 500/],
  ])('rejects %s with a clear message', async (_label, override, field, message) => {
    const c = await newContact();
    const res = await entry(c.id, override);
    expect(res.status).toBe(400);
    const detail = res.body.error.details.find((d) => d.field === field);
    expect(detail, JSON.stringify(res.body.error.details)).toBeDefined();
    expect(detail.message).toMatch(message);
  });

  it('accepts amounts as numbers and trims, and never rounds silently', async () => {
    const c = await newContact();
    expect((await entry(c.id, { amount: 99.5 })).body.data.amount).toBe('99.50');
    expect((await entry(c.id, { amount: ' 12.3 ' })).body.data.amount).toBe('12.30');
    expect((await entry(c.id, { amount: 0.1 + 0.2 })).status).toBe(400); // 0.30000000000000004 is refused, not rounded
  });

  it('rejects fields the client must not set', async () => {
    const c = await newContact();
    for (const extra of [{ status: 'voided' }, { createdBy: owner.user.id }, { referenceNo: 'LE-1' }, { businessId: owner.businessId }, { effect: 'credit' }]) {
      expect((await entry(c.id, extra)).status, JSON.stringify(extra)).toBe(400);
    }
  });

  it('refuses an unknown contact and an archived contact', async () => {
    expect((await entry('00000000-0000-4000-8000-000000000000')).status).toBe(404);
    const c = await newContact();
    await owner.post(`/api/contacts/${c.id}/archive`);
    const res = await entry(c.id);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/archived/);
  });
});

describe('numbers stay exact', () => {
  it('adds up many awkward amounts without drifting', async () => {
    const c = await newContact();
    for (let i = 0; i < 10; i += 1) await entry(c.id, { amount: '0.10' });
    await entry(c.id, { amount: '33.33' });
    await entry(c.id, { amount: '66.67', direction: 'you_got' });
    // 10 x 0.10 + 33.33 = 34.33 owed, minus 66.67 received = exactly -32.34 (you now owe them). Floats would give noise.
    expect(await balanceOf(c.id)).toEqual({ amount: '-32.34', side: 'payable' });
  });

  it('handles the largest amount the database allows, and refuses one more digit', async () => {
    const c = await newContact();
    expect((await entry(c.id, { amount: '999999999999.99' })).status).toBe(201);
    expect((await entry(c.id, { amount: '1000000000000.00' })).status).toBe(400);
  });
});

describe('voiding', () => {
  it('cancels the effect, keeps the record, and needs a reason', async () => {
    const c = await newContact();
    const e = (await entry(c.id, { amount: '800' })).body.data;
    expect(await balanceOf(c.id)).toEqual({ amount: '800.00', side: 'receivable' });

    expect((await owner.post(`/api/ledger/entries/${e.id}/void`, {})).status).toBe(400); // reason required
    const res = await owner.post(`/api/ledger/entries/${e.id}/void`, { reason: 'Entered for the wrong customer' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'voided', voidReason: 'Entered for the wrong customer' });
    expect(res.body.data.voidedAt).toBeTruthy();
    expect(await balanceOf(c.id)).toEqual({ amount: '0.00', side: 'settled' });

    const still = await owner.get(`/api/ledger/entries/${e.id}`); // still readable, nothing deleted
    expect(still.body.data.status).toBe('voided');
    expect(await auditActions(e.id)).toEqual(['ledger.entry_create', 'ledger.entry_void']);
  });

  it('cannot be done twice', async () => {
    const c = await newContact();
    const e = (await entry(c.id)).body.data;
    await owner.post(`/api/ledger/entries/${e.id}/void`, { reason: 'first time' });
    expect((await owner.post(`/api/ledger/entries/${e.id}/void`, { reason: 'second time' })).status).toBe(409);
  });

  it('rejects an empty, too-short or unexpected request', async () => {
    const c = await newContact();
    const e = (await entry(c.id)).body.data;
    expect((await owner.post(`/api/ledger/entries/${e.id}/void`, { reason: 'x' })).status).toBe(400);
    expect((await owner.post(`/api/ledger/entries/${e.id}/void`, { reason: 'valid reason', status: 'posted' })).status).toBe(400);
    expect((await owner.post('/api/ledger/entries/not-a-uuid/void', { reason: 'valid reason' })).status).toBe(400);
    expect((await owner.post('/api/ledger/entries/00000000-0000-4000-8000-000000000000/void', { reason: 'valid reason' })).status).toBe(404);
  });
});

describe('correcting', () => {
  it('voids the old entry and posts the new one together, linked to each other', async () => {
    const c = await newContact();
    const wrong = (await entry(c.id, { amount: '500', description: 'Rice' })).body.data;
    const res = await owner.post(`/api/ledger/entries/${wrong.id}/correct`, { amount: '5000', reason: 'Extra zero was missing' });
    expect(res.status).toBe(201);
    const { voided, replacement } = res.body.data;
    expect(voided).toMatchObject({ id: wrong.id, status: 'voided' });
    expect(voided.voidReason).toBe('Corrected: Extra zero was missing');
    expect(replacement).toMatchObject({ status: 'posted', amount: '5000.00', description: 'Rice', direction: 'you_gave', correctsId: wrong.id, txnDate: wrong.txnDate });
    expect(replacement.referenceNo).not.toBe(wrong.referenceNo);
    expect(await balanceOf(c.id)).toEqual({ amount: '5000.00', side: 'receivable' }); // not 5500
    expect(await auditActions(replacement.id)).toEqual(['ledger.entry_correct']);
  });

  it('can change the direction and the date, keeping the rest', async () => {
    const c = await newContact();
    const e = (await entry(c.id, { amount: '300', externalRef: 'B-9' })).body.data;
    const res = await owner.post(`/api/ledger/entries/${e.id}/correct`, { direction: 'you_got', txnDate: '2025-09-09', reason: 'Wrong way round' });
    expect(res.body.data.replacement).toMatchObject({ direction: 'you_got', txnDate: '2025-09-09', amount: '300.00', externalRef: 'B-9' });
    expect(await balanceOf(c.id)).toEqual({ amount: '-300.00', side: 'payable' });
  });

  it('can be chained, and each step stays in the history', async () => {
    const c = await newContact();
    const a = (await entry(c.id, { amount: '100' })).body.data;
    const b = (await owner.post(`/api/ledger/entries/${a.id}/correct`, { amount: '200', reason: 'first fix' })).body.data.replacement;
    const d = (await owner.post(`/api/ledger/entries/${b.id}/correct`, { amount: '300', reason: 'second fix' })).body.data.replacement;
    expect(d.correctsId).toBe(b.id);
    expect(await balanceOf(c.id)).toEqual({ amount: '300.00', side: 'receivable' });
    const all = (await owner.get(`/api/ledger/entries?contactId=${c.id}&status=all`)).body.data;
    expect(all.map((x) => x.status).sort()).toEqual(['posted', 'voided', 'voided']);
  });

  it('refuses to correct a voided entry, and needs a reason', async () => {
    const c = await newContact();
    const e = (await entry(c.id)).body.data;
    expect((await owner.post(`/api/ledger/entries/${e.id}/correct`, { amount: '5' })).status).toBe(400);
    await owner.post(`/api/ledger/entries/${e.id}/void`, { reason: 'cancelled it' });
    expect((await owner.post(`/api/ledger/entries/${e.id}/correct`, { amount: '5', reason: 'too late' })).status).toBe(409);
  });

  it('is all-or-nothing: an invalid replacement leaves the original untouched', async () => {
    const c = await newContact();
    const e = (await entry(c.id, { amount: '250' })).body.data;
    const bad = await owner.post(`/api/ledger/entries/${e.id}/correct`, { amount: '-1', reason: 'invalid on purpose' });
    expect(bad.status).toBe(400);
    expect((await owner.get(`/api/ledger/entries/${e.id}`)).body.data.status).toBe('posted');
    expect(await balanceOf(c.id)).toEqual({ amount: '250.00', side: 'receivable' });
  });

  it('cannot correct into an archived contact’s books', async () => {
    const c = await newContact();
    const e = (await entry(c.id)).body.data;
    await owner.post(`/api/contacts/${c.id}/archive`);
    expect((await owner.post(`/api/ledger/entries/${e.id}/correct`, { amount: '5', reason: 'archived now' })).status).toBe(409);
  });
});

describe('editing text on a posted entry', () => {
  it('allows description, notes and the external reference, and nothing financial', async () => {
    const c = await newContact();
    const e = (await entry(c.id, { description: 'Ricee' })).body.data;
    const res = await owner.patch(`/api/ledger/entries/${e.id}`, { description: 'Rice', notes: 'sack of 50kg', externalRef: 'INV-7' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ description: 'Rice', notes: 'sack of 50kg', externalRef: 'INV-7', amount: e.amount, txnDate: e.txnDate, referenceNo: e.referenceNo });
    const { rows } = await pool.query("SELECT before, after FROM audit_logs WHERE entity_id = $1 AND action = 'ledger.entry_update'", [e.id]);
    expect(rows[0].before.description).toBe('Ricee');
    expect(rows[0].after.description).toBe('Rice');
    expect(await balanceOf(c.id)).toEqual({ amount: '1000.00', side: 'receivable' });
  });

  it('refuses to touch amounts, dates, direction or the contact, and edits to voided entries', async () => {
    const c = await newContact();
    const e = (await entry(c.id)).body.data;
    for (const body of [{ amount: '1' }, { txnDate: '2025-01-01' }, { direction: 'you_got' }, { contactId: c.id }, {}]) {
      expect((await owner.patch(`/api/ledger/entries/${e.id}`, body)).status, JSON.stringify(body)).toBe(400);
    }
    await owner.post(`/api/ledger/entries/${e.id}/void`, { reason: 'voided for test' });
    expect((await owner.patch(`/api/ledger/entries/${e.id}`, { description: 'late edit' })).status).toBe(409);
  });
});

describe('opening balances', () => {
  const put = (contactId, body) => owner.put(`/api/contacts/${contactId}/opening-balance`, body);

  it('can be entered together with a new contact', async () => {
    const res = await owner.post('/api/contacts', { name: 'With Opening', types: ['customer'], openingBalance: { amount: '12500', side: 'they_owe_me', asOfDate: '2025-07-17' } });
    expect(res.status).toBe(201);
    expect(res.body.data.balance).toEqual({ amount: '12500.00', side: 'receivable' });
    const detail = (await owner.get(`/api/contacts/${res.body.data.id}`)).body.data;
    expect(detail.openingBalance).toMatchObject({ amount: '12500.00', side: 'they_owe_me', asOfDate: '2025-07-17' });
    expect(detail.openingBalance.referenceNo).toMatch(/^OB-/);
  });

  it('"I owe them" makes the balance negative (payable)', async () => {
    const c = await newContact('Supplier Opening', { types: ['supplier'] });
    const res = await put(c.id, { amount: '3000', side: 'i_owe_them' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ type: 'opening_balance', effect: 'credit', direction: 'i_owe_them' });
    expect(await balanceOf(c.id)).toEqual({ amount: '-3000.00', side: 'payable' });
  });

  it('defaults the as-of date to today in Nepal', async () => {
    const c = await newContact();
    const res = await put(c.id, { amount: '10', side: 'they_owe_me' });
    expect(res.body.data.txnDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('replacing it voids the old one: there is never more than one active', async () => {
    const c = await newContact();
    await put(c.id, { amount: '1000', side: 'they_owe_me', asOfDate: '2025-07-17' });
    const second = await put(c.id, { amount: '1500', side: 'they_owe_me', asOfDate: '2025-07-17' });
    expect(second.status).toBe(200);
    expect(await balanceOf(c.id)).toEqual({ amount: '1500.00', side: 'receivable' });
    const all = (await owner.get(`/api/ledger/entries?contactId=${c.id}&type=opening_balance&status=all`)).body.data;
    expect(all.map((x) => x.status).sort()).toEqual(['posted', 'voided']);
  });

  it('can be removed, after which the balance returns to zero', async () => {
    const c = await newContact();
    await put(c.id, { amount: '999', side: 'they_owe_me' });
    expect((await owner.delete(`/api/contacts/${c.id}/opening-balance`)).status).toBe(200);
    expect(await balanceOf(c.id)).toEqual({ amount: '0.00', side: 'settled' });
    expect((await owner.delete(`/api/contacts/${c.id}/opening-balance`)).status).toBe(404); // nothing left to remove
    expect((await owner.get(`/api/contacts/${c.id}`)).body.data.openingBalance).toBeNull();
  });

  it('is validated like any amount, and the side must be stated', async () => {
    const c = await newContact();
    expect((await put(c.id, { amount: '0', side: 'they_owe_me' })).status).toBe(400);
    expect((await put(c.id, { amount: '5' })).status).toBe(400);
    expect((await put(c.id, { amount: '5', side: 'credit' })).status).toBe(400);
    expect((await put(c.id, { amount: '5', side: 'they_owe_me', status: 'posted' })).status).toBe(400);
  });

  it('a creation that fails on the opening balance creates no contact at all', async () => {
    const name = `Atomic ${Date.now()}`;
    const res = await owner.post('/api/contacts', { name, types: ['customer'], openingBalance: { amount: '0', side: 'they_owe_me' } });
    expect(res.status).toBe(400);
    expect((await pool.query('SELECT 1 FROM contacts WHERE name = $1', [name])).rowCount).toBe(0);
  });
});

describe('the contact ledger', () => {
  let c;
  const ledger = async (qs = '') => (await owner.get(`/api/ledger/contacts/${c.id}${qs}`)).body;

  beforeAll(async () => {
    c = await newContact('Ledger Subject');
    await owner.put(`/api/contacts/${c.id}/opening-balance`, { amount: '1000', side: 'they_owe_me', asOfDate: '2025-08-01' });
    await entry(c.id, { txnDate: '2025-08-01', direction: 'you_gave', amount: '500', description: 'Sugar, same day as opening' });
    await entry(c.id, { txnDate: '2025-08-10', direction: 'you_got', amount: '300', description: 'Part payment', externalRef: 'ESEWA-1' });
    await entry(c.id, { txnDate: '2025-08-20', direction: 'you_gave', amount: '200.50', description: 'Oil' });
    await entry(c.id, { txnDate: '2025-09-05', direction: 'you_got', amount: '1400.50', description: 'Settled in full' });
    const voided = (await entry(c.id, { txnDate: '2025-08-15', amount: '9999' })).body.data;
    await owner.post(`/api/ledger/entries/${voided.id}/void`, { reason: 'wrong customer' });
  });

  it('lists lines oldest first with debit, credit and a running balance; opening balance leads its day', async () => {
    const { data, meta } = await ledger();
    expect(data.rows.map((r) => [r.txnDate, r.type, r.debit, r.credit, r.balance])).toEqual([
      ['2025-08-01', 'opening_balance', '1000.00', null, '1000.00'],
      ['2025-08-01', 'ledger_entry', '500.00', null, '1500.00'],
      ['2025-08-10', 'ledger_entry', null, '300.00', '1200.00'],
      ['2025-08-20', 'ledger_entry', '200.50', null, '1400.50'],
      ['2025-09-05', 'ledger_entry', null, '1400.50', '0.00'],
    ]);
    expect(meta.total).toBe(5);
    expect(data.openingBalance).toBe('0.00');
    expect(data.totals).toEqual({ debit: '1700.50', credit: '1700.50' });
    expect(data.closingBalance).toBe('0.00');
    expect(data.contact).toEqual({ id: c.id, name: 'Ledger Subject' });
    expect(data.rows[0].referenceNo).toMatch(/^OB-/);
  });

  it('leaves voided entries out (they have no effect) and the closing balance equals the contact balance', async () => {
    const { data } = await ledger();
    expect(data.rows.some((r) => r.description === null && r.debit === '9999.00')).toBe(false);
    expect(data.closingBalance).toBe((await balanceOf(c.id)).amount);
  });

  it('shows the balance brought forward when a start date is given, and keeps running balances correct', async () => {
    const { data, meta } = await ledger('?from=2025-08-10&to=2025-08-31');
    expect(data.openingBalance).toBe('1500.00'); // 1000 + 500 before 10 Aug
    expect(data.rows.map((r) => r.balance)).toEqual(['1200.00', '1400.50']);
    expect(data.totals).toEqual({ debit: '200.50', credit: '300.00' });
    expect(data.closingBalance).toBe('1400.50');
    expect(meta.total).toBe(2);
  });

  it('opening + debits - credits = closing, for any range', async () => {
    for (const qs of ['', '?from=2025-08-02', '?to=2025-08-19', '?from=2025-08-05&to=2025-08-25', '?from=2026-01-01']) {
      const { data } = await ledger(qs);
      const cents = (s) => Math.round(Number(s) * 100);
      expect(cents(data.openingBalance) + cents(data.totals.debit) - cents(data.totals.credit), qs).toBe(cents(data.closingBalance));
    }
  });

  it('searching or paging never changes a line’s running balance', async () => {
    const searched = (await ledger('?q=part%20payment')).data;
    expect(searched.rows).toHaveLength(1);
    expect(searched.rows[0].balance).toBe('1200.00'); // the real balance after that line, not 0 - 300
    expect((await ledger('?q=ESEWA-1')).data.rows[0].description).toBe('Part payment');

    const page1 = await ledger('?pageSize=2&page=1');
    const page2 = await ledger('?pageSize=2&page=2');
    const page3 = await ledger('?pageSize=2&page=3');
    expect(page1.meta).toEqual({ page: 1, pageSize: 2, total: 5 });
    expect([...page1.data.rows, ...page2.data.rows, ...page3.data.rows].map((r) => r.balance)).toEqual(['1000.00', '1500.00', '1200.00', '1400.50', '0.00']);
    expect(page3.data.rows).toHaveLength(1);
  });

  it('a contact with no history has an empty ledger and zero balances', async () => {
    const empty = await newContact('No History');
    const { data, meta } = (await owner.get(`/api/ledger/contacts/${empty.id}`)).body;
    expect(data).toMatchObject({ rows: [], openingBalance: '0.00', closingBalance: '0.00', totals: { debit: '0.00', credit: '0.00' } });
    expect(meta.total).toBe(0);
  });

  it('validates the filters', async () => {
    for (const qs of ['?from=2025-13-01', '?from=2025-09-01&to=2025-08-01', '?pageSize=0', '?pageSize=201', '?sort=desc', '?business_id=x']) {
      expect((await owner.get(`/api/ledger/contacts/${c.id}${qs}`)).status, qs).toBe(400);
    }
    expect((await owner.get('/api/ledger/contacts/00000000-0000-4000-8000-000000000000')).status).toBe(404);
  });

  it('shows who created each line only to people who can see the team', async () => {
    const viewer = await createMemberSession(app, pool, { businessId: owner.businessId, roleKey: 'viewer' });
    expect((await owner.get(`/api/ledger/contacts/${c.id}`)).body.data.rows[0].createdBy).toMatchObject({ fullName: 'Test User' });
    expect((await viewer.get(`/api/ledger/contacts/${c.id}`)).body.data.rows[0].createdBy).toBeNull();
  });
});

describe('listing entries', () => {
  it('filters by contact, status, type, dates and search text', async () => {
    const c = await newContact('List Subject');
    await owner.put(`/api/contacts/${c.id}/opening-balance`, { amount: '10', side: 'they_owe_me' });
    const a = (await entry(c.id, { txnDate: '2025-08-02', description: 'alpha thing' })).body.data;
    const b = (await entry(c.id, { txnDate: '2025-08-12', description: 'beta thing' })).body.data;
    await owner.post(`/api/ledger/entries/${b.id}/void`, { reason: 'list test void' });

    const ids = async (qs) => (await owner.get(`/api/ledger/entries?contactId=${c.id}&${qs}`)).body.data.map((x) => x.id);
    expect(await ids('type=ledger_entry')).toEqual([a.id]);
    expect(await ids('type=ledger_entry&status=voided')).toEqual([b.id]);
    expect((await ids('status=all')).length).toBe(3);
    expect(await ids('type=ledger_entry&from=2025-08-05&status=all')).toEqual([b.id]);
    expect(await ids('type=ledger_entry&q=ALPHA')).toEqual([a.id]);
    expect(await ids(`type=ledger_entry&q=${encodeURIComponent('%')}`)).toEqual([]); // literal percent sign
    expect((await owner.get('/api/ledger/entries?status=bogus')).status).toBe(400);
  });

  it('shows newest first with accurate totals for paging', async () => {
    const c = await newContact('Paged');
    for (let i = 1; i <= 5; i += 1) await entry(c.id, { txnDate: `2025-08-0${i}` });
    const res = (await owner.get(`/api/ledger/entries?contactId=${c.id}&pageSize=2&page=3`)).body;
    expect(res.meta).toEqual({ page: 3, pageSize: 2, total: 5 });
    expect(res.data.map((x) => x.txnDate)).toEqual(['2025-08-01']);
  });
});

describe('the database refuses what the API never tries', () => {
  it('a posted entry cannot be rewritten even by a direct SQL update', async () => {
    const c = await newContact();
    const e = (await entry(c.id)).body.data;
    await expect(pool.query('UPDATE transactions SET total = 1 WHERE id = $1', [e.id])).rejects.toThrow(/cannot be changed/);
    await expect(pool.query('DELETE FROM transactions WHERE id = $1', [e.id])).rejects.toThrow(/cannot be deleted/);
    expect(await balanceOf(c.id)).toEqual({ amount: '1000.00', side: 'receivable' });
  });
});

describe('many people saving at once', () => {
  it('get different reference numbers and the balance is the exact sum', async () => {
    const c = await newContact('Concurrent');
    const fy = fiscalYear(2083);
    const results = await Promise.all(Array.from({ length: 8 }, () => entry(c.id, { txnDate: fy.start, amount: '10.10' })));
    expect(results.every((r) => r.status === 201)).toBe(true);
    const refs = results.map((r) => r.body.data.referenceNo);
    expect(new Set(refs).size).toBe(8);
    expect(await balanceOf(c.id)).toEqual({ amount: '80.80', side: 'receivable' });
  });
});
