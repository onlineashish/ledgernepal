import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../helpers/testApp.js';
import { cleanupApiTestData, registerUser } from '../helpers/api.js';

// Business A's user attacks Business B's invoices and bills: ids in URLs, B's contact in a request,
// and direct database writes. Nothing may be read or changed, and B's books must not move.

const { app, pool, close } = createTestApp();
let a;
let b;
let aContact;
let bContact;
const docs = { sale: {}, purchase: {} }; // B's documents: { draft, posted }
const PATH = { sale: '/api/sales', purchase: '/api/purchases' };
const NIL = '00000000-0000-4000-8000-000000000000';
const line = (o = {}) => ({ description: 'Zorblax secret goods', quantity: '3', unitPrice: '777', ...o });

const bBooks = async () =>
  (await pool.query('SELECT id, type, status, total, txn_date, contact_id, reference_no, notes FROM transactions WHERE business_id = $1 ORDER BY id', [b.businessId])).rows;
const bLines = async () =>
  (await pool.query('SELECT transaction_id, line_no, description, quantity, line_total FROM transaction_lines WHERE business_id = $1 ORDER BY transaction_id, line_no', [b.businessId])).rows;

beforeAll(async () => {
  await cleanupApiTestData(pool);
  a = await registerUser(app, { businessName: 'Docs A' });
  b = await registerUser(app, { businessName: 'Docs B' });
  aContact = (await a.post('/api/contacts', { name: 'A Customer', types: ['customer'] })).body.data;
  bContact = (await b.post('/api/contacts', { name: 'Zorblax Client', types: ['customer', 'supplier'] })).body.data;
  for (const type of ['sale', 'purchase']) {
    const base = { contactId: bContact.id, txnDate: '2025-08-01', lines: [line()], notes: `B private ${type}` };
    docs[type].draft = (await b.post(PATH[type], base)).body.data;
    docs[type].posted = (await b.post(PATH[type], { ...base, post: true })).body.data;
  }
});
afterAll(async () => {
  await cleanupApiTestData(pool);
  await close();
});

describe.each(['sale', 'purchase'])('A cannot touch B’s %s documents by using their ids', (type) => {
  const path = PATH[type];

  it('reads nothing: the answer is identical to an id that does not exist', async () => {
    for (const kind of ['draft', 'posted']) {
      const real = await a.get(`${path}/${docs[type][kind].id}`);
      const fake = await a.get(`${path}/${NIL}`);
      expect(real.status).toBe(404);
      expect(real.body.error.message).toBe(fake.body.error.message);
      expect(JSON.stringify(real.body)).not.toMatch(/Zorblax|777|B private/);
    }
  });

  it('changes nothing: edit, delete, post, void and text edits are all 404, and B’s books and lines are untouched', async () => {
    const [books, lines] = [await bBooks(), await bLines()];
    const { draft, posted } = docs[type];
    const attempts = [
      await a.patch(`${path}/${draft.id}`, { lines: [line({ unitPrice: '1' })] }),
      await a.patch(`${path}/${draft.id}`, { notes: 'defaced' }),
      await a.patch(`${path}/${posted.id}`, { notes: 'defaced' }),
      await a.delete(`${path}/${draft.id}`),
      await a.delete(`${path}/${posted.id}`),
      await a.post(`${path}/${draft.id}/post`),
      await a.post(`${path}/${posted.id}/void`, { reason: 'attack on another business' }),
    ];
    expect(attempts.map((r) => r.status)).toEqual([404, 404, 404, 404, 404, 404, 404]);
    expect(await bBooks()).toEqual(books);
    expect(await bLines()).toEqual(lines);
  });

  it('cannot create one for B’s contact (404), however it is phrased, and nothing is written anywhere', async () => {
    const [books, aCount] = [await bBooks(), (await pool.query('SELECT count(*)::int AS n FROM transactions WHERE business_id = $1', [a.businessId])).rows[0].n];
    const body = { contactId: bContact.id, txnDate: '2025-08-01', lines: [line()] };
    expect((await a.post(path, body)).status).toBe(404);
    expect((await a.post(path, { ...body, post: true })).status).toBe(404);
    expect((await a.post(path, { ...body, businessId: b.businessId })).status).toBe(400);
    expect((await a.post(path, { ...body, business_id: b.businessId })).status).toBe(400);
    expect(await bBooks()).toEqual(books);
    expect((await pool.query('SELECT count(*)::int AS n FROM transactions WHERE business_id = $1', [a.businessId])).rows[0].n).toBe(aCount);
  });

  it('cannot attach one of its own documents to B’s contact', async () => {
    const own = (await a.post(path, { contactId: aContact.id, txnDate: '2025-08-01', lines: [line({ description: 'A goods' })] })).body.data;
    expect((await a.patch(`${path}/${own.id}`, { contactId: bContact.id })).status).toBe(404);
    expect((await a.get(`${path}/${own.id}`)).body.data.contact.id).toBe(aContact.id);
  });

  it('never lists B’s documents, whatever the filter', async () => {
    const mine = await a.post(path, { contactId: aContact.id, txnDate: '2025-08-01', lines: [line({ description: 'A goods' })], post: true });
    const all = await a.get(`${path}?status=all&pageSize=100`);
    expect(all.body.data.every((d) => d.contact.id === aContact.id)).toBe(true);
    expect(all.body.data.map((d) => d.id)).toContain(mine.body.data.id);
    expect(JSON.stringify(all.body)).not.toMatch(/Zorblax|B private/);
    expect((await a.get(`${path}?contactId=${bContact.id}`)).body.data).toEqual([]);
    expect((await a.get(`${path}?q=Zorblax`)).body.data).toEqual([]);
    expect((await a.get(`${path}?business_id=${b.businessId}`)).status).toBe(400);
  });

  it('B is unaffected by all of the above', async () => {
    const { draft, posted } = docs[type];
    expect((await b.get(`${path}/${draft.id}`)).body.data).toMatchObject({ status: 'draft', notes: `B private ${type}` });
    expect((await b.get(`${path}/${posted.id}`)).body.data).toMatchObject({ status: 'posted', notes: `B private ${type}` });
  });
});

describe('kinds and businesses do not leak into each other’s numbering or balances', () => {
  it('A’s balances and ledgers never include B’s documents', async () => {
    const contacts = (await a.get('/api/contacts?archived=all&pageSize=100')).body.data;
    expect(contacts.map((c) => c.id)).not.toContain(bContact.id);
    expect((await a.get(`/api/ledger/contacts/${bContact.id}`)).status).toBe(404);
    expect((await a.get(`/api/contacts/${bContact.id}`)).status).toBe(404);
  });

  it('each business counts its own documents from 0001', async () => {
    const solo = await registerUser(app, { businessName: 'Docs Counter Co' });
    const c = (await solo.post('/api/contacts', { name: 'C', types: ['customer'] })).body.data;
    const ref = (await solo.post('/api/sales', { contactId: c.id, txnDate: '2025-08-01', lines: [line()], post: true })).body.data.referenceNo;
    expect(ref).toBe('SI-2082/83-0001'); // B has already posted a sale in the same fiscal year; that is invisible here
  });
});

describe('the database itself refuses cross-business lines', () => {
  it('a line cannot point at a document of another business', async () => {
    const bDraft = docs.sale.draft.id;
    await expect(
      pool.query(
        `INSERT INTO transaction_lines (business_id, transaction_id, line_no, description, quantity, unit_price, gross_amount,
            taxable_amount, tax_amount, line_total)
         VALUES ($1, $2, 99, 'planted', 1, 1, 1, 0, 0, 1)`,
        [a.businessId, bDraft],
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });
});

describe('audit entries for documents stay with the business that acted', () => {
  it('everything A did to documents is logged under A only', async () => {
    const { rows } = await pool.query(
      "SELECT DISTINCT business_id FROM audit_logs WHERE actor_user_id = $1 AND (action LIKE 'sale.%' OR action LIKE 'purchase.%')",
      [a.user.id],
    );
    expect(rows.every((r) => r.business_id === a.businessId)).toBe(true);
    const leaked = await pool.query("SELECT 1 FROM audit_logs WHERE business_id = $1 AND actor_user_id = $2", [b.businessId, a.user.id]);
    expect(leaked.rowCount).toBe(0);
  });
});
