import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { cleanup, createBusiness, createTestPool, createUser } from '../helpers/db.js';

// Rules about the lines of an invoice or bill, checked directly against the database.

const db = createTestPool();
const created = { businessIds: [], userIds: [] };
let user;
let biz;
let otherBiz;
let contact;
const PG = { check: '23514', foreignKey: '23503', unique: '23505' };
const expectPg = (promise, code) => expect(promise).rejects.toMatchObject({ code });
const unique = () => randomUUID().slice(0, 8);

async function newContact(businessId) {
  const { rows } = await db.query('INSERT INTO contacts (business_id, name, is_customer, created_by) VALUES ($1, $2, true, $3) RETURNING id', [businessId, `C ${unique()}`, user.id]);
  return rows[0].id;
}

/** A draft sale (no number, nothing posted yet). */
async function draft(businessId = biz.id, contactId = contact) {
  const { rows } = await db.query(
    `INSERT INTO transactions (business_id, contact_id, type, status, effect, txn_date, total, created_by)
     VALUES ($1, $2, 'sale', 'draft', 'debit', '2025-08-01', 0, $3) RETURNING id`,
    [businessId, contactId, user.id],
  );
  return rows[0].id;
}

const GOOD_LINE = { lineNo: 1, desc: 'Rice', qty: '2', price: '100.00', gross: '200.00', disc: '0', share: '0', taxable: false, rate: null, taxableAmt: '0', tax: '0', total: '200.00' };
function insertLine(businessId, txId, o = {}) {
  const l = { ...GOOD_LINE, ...o };
  return db.query(
    `INSERT INTO transaction_lines (business_id, transaction_id, line_no, description, quantity, unit_price, gross_amount,
        discount_amount, invoice_discount_share, is_taxable, tax_rate, taxable_amount, tax_amount, line_total)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`,
    [businessId, txId, l.lineNo, l.desc, l.qty, l.price, l.gross, l.disc, l.share, l.taxable, l.rate, l.taxableAmt, l.tax, l.total],
  );
}
/** Posts a draft the way the application does. */
const post = (id) =>
  db.query("UPDATE transactions SET status = 'posted', reference_no = $2, total = 200, posted_at = now(), posted_by = $3 WHERE id = $1", [id, `SI-${unique()}`, user.id]);

beforeAll(async () => {
  user = await createUser(db);
  created.userIds.push(user.id);
  biz = await createBusiness(db, user.id, 'Lines Co');
  otherBiz = await createBusiness(db, user.id, 'Other Lines Co');
  created.businessIds.push(biz.id, otherBiz.id);
  contact = await newContact(biz.id);
});
afterAll(async () => {
  await cleanup(db, created);
  await db.end();
});

describe('what a line must look like', () => {
  it('accepts a normal line', async () => {
    await expect(insertLine(biz.id, await draft())).resolves.toBeTruthy();
  });

  it.each([
    ['quantity zero', { qty: '0' }],
    ['negative quantity', { qty: '-1' }],
    ['negative price', { price: '-1.00' }],
    ['blank description', { desc: '   ' }],
    ['line number 0', { lineNo: 0 }],
    ['negative discount', { disc: '-1' }],
    ['discounts more than the line is worth', { disc: '150', share: '60', total: '0' }],
    ['a total that does not add up', { total: '199.99' }],
    ['VAT without a rate', { taxable: true, rate: null, taxableAmt: '200', tax: '26', total: '226' }],
    ['a rate on a line that is not taxable', { taxable: false, rate: '13' }],
    ['a rate over 100%', { taxable: true, rate: '101', taxableAmt: '200', tax: '202', total: '402' }],
    ['more taxable than the line is worth', { taxable: true, rate: '13', taxableAmt: '300', tax: '39', total: '239' }],
  ])('refuses %s', async (_label, override) => {
    await expectPg(insertLine(biz.id, await draft(), override), PG.check);
  });

  it('treats 0% as taxable-at-zero: allowed, and distinct from not taxable', async () => {
    await expect(insertLine(biz.id, await draft(), { taxable: true, rate: '0', taxableAmt: '200', tax: '0', total: '200' })).resolves.toBeTruthy();
  });

  it('adds VAT on top: a 13% taxable line totals gross + tax', async () => {
    await expect(insertLine(biz.id, await draft(), { taxable: true, rate: '13', taxableAmt: '200', tax: '26', total: '226' })).resolves.toBeTruthy();
  });

  it('numbers lines uniquely within a document', async () => {
    const id = await draft();
    await insertLine(biz.id, id);
    await expectPg(insertLine(biz.id, id), PG.unique);
    await expect(insertLine(biz.id, id, { lineNo: 2 })).resolves.toBeTruthy();
  });

  it('cannot belong to a document of another business', async () => {
    const id = await draft();
    await expectPg(insertLine(otherBiz.id, id), PG.foreignKey);
  });
});

describe('a draft’s lines are free to change', () => {
  it('can be edited, replaced and removed', async () => {
    const id = await draft();
    const { rows } = await insertLine(biz.id, id);
    await db.query('UPDATE transaction_lines SET description = $2 WHERE id = $1', [rows[0].id, 'Changed']);
    await db.query('DELETE FROM transaction_lines WHERE id = $1', [rows[0].id]);
    expect((await db.query('SELECT 1 FROM transaction_lines WHERE transaction_id = $1', [id])).rowCount).toBe(0);
  });

  it('go away with the draft', async () => {
    const id = await draft();
    await insertLine(biz.id, id);
    await insertLine(biz.id, id, { lineNo: 2 });
    await db.query('DELETE FROM transactions WHERE id = $1', [id]);
    expect((await db.query('SELECT 1 FROM transaction_lines WHERE transaction_id = $1', [id])).rowCount).toBe(0);
  });
});

describe('a posted document’s lines are history', () => {
  let postedId;
  let lineId;
  beforeAll(async () => {
    postedId = await draft();
    lineId = (await insertLine(biz.id, postedId)).rows[0].id;
    await post(postedId);
  });

  it('cannot be changed, added to or removed, even with direct SQL', async () => {
    await expect(db.query("UPDATE transaction_lines SET description = 'Altered' WHERE id = $1", [lineId])).rejects.toThrow(/cannot be changed/);
    await expect(db.query('UPDATE transaction_lines SET quantity = 99 WHERE id = $1', [lineId])).rejects.toThrow(/cannot be changed/);
    await expect(db.query('DELETE FROM transaction_lines WHERE id = $1', [lineId])).rejects.toThrow(/cannot be changed/);
    await expect(insertLine(biz.id, postedId, { lineNo: 2 })).rejects.toThrow(/cannot be changed/);
    const { rows } = await db.query('SELECT description, quantity FROM transaction_lines WHERE id = $1', [lineId]);
    expect(rows[0]).toEqual({ description: 'Rice', quantity: '2.000' });
  });

  it('stay frozen after the document is voided', async () => {
    const id = await draft();
    const line = (await insertLine(biz.id, id)).rows[0].id;
    await post(id);
    await db.query("UPDATE transactions SET status = 'voided', voided_at = now(), voided_by = $2, void_reason = 'test' WHERE id = $1", [id, user.id]);
    await expect(db.query("UPDATE transaction_lines SET description = 'x' WHERE id = $1", [line])).rejects.toThrow(/cannot be changed/);
  });

  it('are removed together with a whole business, which is the only way a posted document disappears', async () => {
    const temp = await createBusiness(db, user.id, 'Doomed Lines Co');
    const tempContact = await newContact(temp.id);
    const id = await draft(temp.id, tempContact);
    await insertLine(temp.id, id);
    await post(id);
    await db.query('DELETE FROM businesses WHERE id = $1', [temp.id]);
    expect((await db.query('SELECT 1 FROM transaction_lines WHERE transaction_id = $1', [id])).rowCount).toBe(0);
  });
});
