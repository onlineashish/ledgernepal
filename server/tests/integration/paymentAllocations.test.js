import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { cleanup, createBusiness, createTestPool, createUser } from '../helpers/db.js';

// The rules for matching receipts/payments to invoices/bills, checked straight against the database
// so they hold whatever the application code does.

const db = createTestPool();
const created = { businessIds: [], userIds: [] };
let user;
let biz;
let otherBiz;
let ram; // contact
let sita; // another contact of the same business
let foreignContact;
const PG = { check: '23514', foreignKey: '23503', unique: '23505', raise: 'P0001' };
const unique = () => randomUUID().slice(0, 8);

async function newContact(businessId) {
  const { rows } = await db.query('INSERT INTO contacts (business_id, name, is_customer, is_supplier, created_by) VALUES ($1, $2, true, true, $3) RETURNING id', [businessId, `C ${unique()}`, user.id]);
  return rows[0].id;
}

/** A posted transaction of any type (receipts and payments get a cash method). */
async function post({ type, contactId = ram, total = '1000.00', businessId = biz.id, status = 'posted' }) {
  const effect = { sale: 'debit', purchase: 'credit', receipt: 'credit', payment: 'debit' }[type];
  const draft = status === 'draft';
  const { rows } = await db.query(
    `INSERT INTO transactions (business_id, contact_id, type, status, effect, txn_date, total, reference_no, payment_method, posted_at, posted_by, created_by)
     VALUES ($1, $2, $3, $4, $5, '2025-08-01', $6, $7, $8, CASE WHEN $9 THEN NULL ELSE now() END, CASE WHEN $9 THEN NULL ELSE $10::uuid END, $10)
     RETURNING id`,
    [businessId, contactId, type, draft ? 'draft' : 'posted', effect, total, draft ? null : `T-${unique()}`, ['receipt', 'payment'].includes(type) ? 'cash' : null, draft, user.id],
  );
  return rows[0].id;
}
const allocate = (paymentId, invoiceId, amount, businessId = biz.id) =>
  db.query(
    'INSERT INTO payment_allocations (business_id, payment_txn_id, invoice_txn_id, amount, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [businessId, paymentId, invoiceId, amount, user.id],
  );
const voidTxn = (id) =>
  db.query("UPDATE transactions SET status = 'voided', voided_at = now(), voided_by = $2, void_reason = 'test' WHERE id = $1", [id, user.id]);
const cancel = (allocationId) =>
  db.query("UPDATE payment_allocations SET status = 'voided', voided_at = now(), voided_by = $2 WHERE id = $1", [allocationId, user.id]);

beforeAll(async () => {
  user = await createUser(db);
  created.userIds.push(user.id);
  biz = await createBusiness(db, user.id, 'Allocation Co');
  otherBiz = await createBusiness(db, user.id, 'Other Allocation Co');
  created.businessIds.push(biz.id, otherBiz.id);
  ram = await newContact(biz.id);
  sita = await newContact(biz.id);
  foreignContact = await newContact(otherBiz.id);
});
afterAll(async () => {
  await cleanup(db, created);
  await db.end();
});

describe('what can be matched to what', () => {
  it('a receipt to a sales invoice, and a payment to a purchase bill, of the same contact', async () => {
    await expect(allocate(await post({ type: 'receipt' }), await post({ type: 'sale' }), '400')).resolves.toBeTruthy();
    await expect(allocate(await post({ type: 'payment' }), await post({ type: 'purchase' }), '400')).resolves.toBeTruthy();
  });

  it('not a receipt to a purchase bill, nor a payment to a sales invoice', async () => {
    await expect(allocate(await post({ type: 'receipt' }), await post({ type: 'purchase' }), '10')).rejects.toThrow(/receipt applies to a sales invoice/);
    await expect(allocate(await post({ type: 'payment' }), await post({ type: 'sale' }), '10')).rejects.toThrow(/receipt applies to a sales invoice/);
  });

  it('not a direct ledger entry or an opening balance on either side', async () => {
    const entry = await post({ type: 'receipt' });
    const { rows } = await db.query(
      `INSERT INTO transactions (business_id, contact_id, type, status, effect, txn_date, total, reference_no, posted_at, posted_by, created_by)
       VALUES ($1, $2, 'ledger_entry', 'posted', 'debit', '2025-08-01', 100, $3, now(), $4, $4) RETURNING id`,
      [biz.id, ram, `LE-${unique()}`, user.id],
    );
    await expect(allocate(entry, rows[0].id, '10')).rejects.toThrow(/receipt applies to a sales invoice/);
  });

  it('not across two different contacts', async () => {
    await expect(allocate(await post({ type: 'receipt', contactId: ram }), await post({ type: 'sale', contactId: sita }), '10')).rejects.toThrow(/same contact/);
  });

  it('only when both are posted: not a draft invoice, not a voided receipt or invoice', async () => {
    await expect(allocate(await post({ type: 'receipt' }), await post({ type: 'sale', status: 'draft', total: '0' }), '10')).rejects.toThrow(/Only posted documents/);
    const voidedReceipt = await post({ type: 'receipt' });
    await voidTxn(voidedReceipt);
    await expect(allocate(voidedReceipt, await post({ type: 'sale' }), '10')).rejects.toThrow(/Only posted documents/);
    const voidedSale = await post({ type: 'sale' });
    await voidTxn(voidedSale);
    await expect(allocate(await post({ type: 'receipt' }), voidedSale, '10')).rejects.toThrow(/Only posted documents/);
  });

  it('never across two businesses (composite foreign keys)', async () => {
    const mine = await post({ type: 'receipt' });
    const theirs = await post({ type: 'sale', businessId: otherBiz.id, contactId: foreignContact });
    await expect(allocate(mine, theirs, '10', biz.id)).rejects.toMatchObject({ code: PG.foreignKey });
    await expect(allocate(mine, theirs, '10', otherBiz.id)).rejects.toMatchObject({ code: PG.foreignKey });
  });

  it('not a document to itself', async () => {
    const receipt = await post({ type: 'receipt' });
    await expect(allocate(receipt, receipt, '10')).rejects.toThrow(); // refused by the type rule and, behind it, by a CHECK
  });
});

describe('how much', () => {
  it('must be above zero', async () => {
    const [r, s] = [await post({ type: 'receipt' }), await post({ type: 'sale' })];
    await expect(allocate(r, s, '0')).rejects.toMatchObject({ code: PG.check });
    await expect(allocate(r, s, '-5')).rejects.toMatchObject({ code: PG.check });
  });

  it('a receipt cannot be allocated more than its amount, in one go or across several invoices', async () => {
    const receipt = await post({ type: 'receipt', total: '500.00' });
    const [a, b] = [await post({ type: 'sale', total: '1000' }), await post({ type: 'sale', total: '1000' })];
    await expect(allocate(receipt, a, '500.01')).rejects.toThrow(/more than the amount received or paid/);
    await allocate(receipt, a, '300');
    await expect(allocate(receipt, b, '200.01')).rejects.toThrow(/more than the amount received or paid/);
    await expect(allocate(receipt, b, '200')).resolves.toBeTruthy(); // exactly all of it is fine
  });

  it('an invoice cannot be paid more than its total, however many receipts pay it', async () => {
    const sale = await post({ type: 'sale', total: '1000.00' });
    const [r1, r2, r3] = [await post({ type: 'receipt' }), await post({ type: 'receipt' }), await post({ type: 'receipt' })];
    await allocate(r1, sale, '600');
    await allocate(r2, sale, '300');
    await expect(allocate(r3, sale, '100.01')).rejects.toThrow(/more than the total of the invoice/);
    await expect(allocate(r3, sale, '100')).resolves.toBeTruthy();
  });

  it('cancelling an allocation frees the money again', async () => {
    const [receipt, sale] = [await post({ type: 'receipt', total: '100' }), await post({ type: 'sale', total: '100' })];
    const first = (await allocate(receipt, sale, '100')).rows[0].id;
    await expect(allocate(receipt, await post({ type: 'sale', total: '100' }), '1')).rejects.toThrow(/more than the amount/);
    await cancel(first);
    await expect(allocate(receipt, await post({ type: 'sale', total: '100' }), '100')).resolves.toBeTruthy();
    await expect(allocate(await post({ type: 'receipt', total: '100' }), sale, '100')).resolves.toBeTruthy(); // and the invoice is free again too
  });

  it('only one live allocation per receipt/invoice pair, but a new one is allowed after cancelling', async () => {
    const [receipt, sale] = [await post({ type: 'receipt' }), await post({ type: 'sale' })];
    const first = (await allocate(receipt, sale, '100')).rows[0].id;
    await expect(allocate(receipt, sale, '50')).rejects.toMatchObject({ code: PG.unique });
    await cancel(first);
    await expect(allocate(receipt, sale, '50')).resolves.toBeTruthy();
  });

  it('two simultaneous requests cannot both squeeze past the limit', async () => {
    const sale = await post({ type: 'sale', total: '1000.00' });
    const [r1, r2] = [await post({ type: 'receipt' }), await post({ type: 'receipt' })];
    const results = await Promise.allSettled([allocate(r1, sale, '600'), allocate(r2, sale, '600')]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')[0].reason.message).toMatch(/more than the total of the invoice/);
    const { rows } = await db.query("SELECT COALESCE(SUM(amount), 0) AS s FROM payment_allocations WHERE invoice_txn_id = $1 AND status = 'active'", [sale]);
    expect(rows[0].s).toBe('600.00');
  });

  it('many simultaneous allocations from one receipt never add up to more than it', async () => {
    const receipt = await post({ type: 'receipt', total: '500.00' });
    const sales = await Promise.all(Array.from({ length: 6 }, () => post({ type: 'sale', total: '200.00' })));
    const results = await Promise.allSettled(sales.map((s) => allocate(receipt, s, '200')));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2); // 200 + 200 fits, a third would be 600
    const { rows } = await db.query("SELECT SUM(amount) AS s FROM payment_allocations WHERE payment_txn_id = $1 AND status = 'active'", [receipt]);
    expect(Number(rows[0].s)).toBeLessThanOrEqual(500);
  });
});

describe('an allocation is history', () => {
  it('can be cancelled but not edited, brought back, or deleted', async () => {
    const [receipt, sale] = [await post({ type: 'receipt' }), await post({ type: 'sale' })];
    const id = (await allocate(receipt, sale, '100')).rows[0].id;
    await expect(db.query('UPDATE payment_allocations SET amount = 999 WHERE id = $1', [id])).rejects.toThrow(/cannot be changed, only cancelled/);
    await expect(db.query('UPDATE payment_allocations SET invoice_txn_id = $2 WHERE id = $1', [id, await post({ type: 'sale' })])).rejects.toThrow(/cannot be changed/);
    await expect(db.query('DELETE FROM payment_allocations WHERE id = $1', [id])).rejects.toThrow(/cannot be deleted, only cancelled/);
    await cancel(id);
    await expect(db.query("UPDATE payment_allocations SET status = 'active', voided_at = NULL, voided_by = NULL WHERE id = $1", [id])).rejects.toThrow(/cannot be brought back/);
    await expect(db.query('DELETE FROM payment_allocations WHERE id = $1', [id])).rejects.toThrow(/cannot be deleted/);
  });

  it('a cancelled allocation must say when it was cancelled', async () => {
    const [receipt, sale] = [await post({ type: 'receipt' }), await post({ type: 'sale' })];
    const id = (await allocate(receipt, sale, '100')).rows[0].id;
    await expect(db.query("UPDATE payment_allocations SET status = 'voided' WHERE id = $1", [id])).rejects.toMatchObject({ code: PG.check });
  });
});

describe('voiding a document that still has live allocations', () => {
  it('is refused for the receipt and for the invoice, until the allocation is cancelled', async () => {
    const [receipt, sale] = [await post({ type: 'receipt' }), await post({ type: 'sale' })];
    const id = (await allocate(receipt, sale, '100')).rows[0].id;
    await expect(voidTxn(receipt)).rejects.toThrow(/Cancel the allocations/);
    await expect(voidTxn(sale)).rejects.toThrow(/Cancel the allocations/);
    await cancel(id);
    await expect(voidTxn(receipt)).resolves.toBeTruthy();
    await expect(voidTxn(sale)).resolves.toBeTruthy();
  });

  it('documents without allocations void as before', async () => {
    await expect(voidTxn(await post({ type: 'sale' }))).resolves.toBeTruthy();
  });
});

describe('removing a whole business', () => {
  it('takes its allocations with it, which is the only way they disappear', async () => {
    const temp = await createBusiness(db, user.id, 'Doomed Allocation Co');
    const tempContact = await newContact(temp.id);
    const [receipt, sale] = [await post({ type: 'receipt', businessId: temp.id, contactId: tempContact }), await post({ type: 'sale', businessId: temp.id, contactId: tempContact })];
    await allocate(receipt, sale, '100', temp.id);
    await db.query('DELETE FROM businesses WHERE id = $1', [temp.id]);
    expect((await db.query('SELECT 1 FROM payment_allocations WHERE business_id = $1', [temp.id])).rowCount).toBe(0);
  });
});
