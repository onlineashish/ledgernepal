import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fiscalYear } from '@ledgernepal/shared/dates';
import { withTransaction } from '../../src/db/pool.js';
import { nextReference } from '../../src/lib/sequences.js';
import { cleanup, createBusiness, createTestPool, createUser } from '../helpers/db.js';

// The rules in docs/accounting-conventions.md, checked directly against the database so they hold
// no matter what the application code does.

const db = createTestPool();
const created = { businessIds: [], userIds: [] };
let user;
let biz;
let otherBiz;
let contact;
let otherContact;

const PG = { unique: '23505', check: '23514', foreignKey: '23503', raise: 'P0001' };
const expectPg = (promise, code) => expect(promise).rejects.toMatchObject({ code });
const unique = () => randomUUID().slice(0, 8);

async function newContact(businessId) {
  const { rows } = await db.query(
    'INSERT INTO contacts (business_id, name, is_customer, created_by) VALUES ($1, $2, true, $3) RETURNING id',
    [businessId, `Contact ${unique()}`, user.id],
  );
  return rows[0].id;
}

/** Inserts a transaction with sensible defaults; override any column. */
async function insertTxn(overrides = {}) {
  const t = {
    businessId: biz.id, contactId: contact, type: 'ledger_entry', status: 'posted', effect: 'debit',
    date: '2025-05-01', total: '100.00', ref: `T-${unique()}`, method: null, dueDate: null, ...overrides,
  };
  const draft = t.status === 'draft';
  const { rows } = await db.query(
    `INSERT INTO transactions (business_id, contact_id, type, status, effect, txn_date, due_date, total, reference_no,
                               payment_method, posted_at, posted_by, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CASE WHEN $11 THEN NULL ELSE now() END, CASE WHEN $11 THEN NULL ELSE $12::uuid END, $12)
     RETURNING *`,
    [t.businessId, t.contactId, t.type, t.status, t.effect, t.date, t.dueDate, t.total, draft ? null : t.ref, t.method, draft, user.id],
  );
  return rows[0];
}

beforeAll(async () => {
  user = await createUser(db);
  created.userIds.push(user.id);
  biz = await createBusiness(db, user.id, 'Txn Co');
  otherBiz = await createBusiness(db, user.id, 'Other Txn Co');
  created.businessIds.push(biz.id, otherBiz.id);
  contact = await newContact(biz.id);
  otherContact = await newContact(otherBiz.id);
});
afterAll(async () => {
  await cleanup(db, created);
  await db.end();
});

describe('debit and credit are fixed by type', () => {
  it.each([
    ['sale', 'debit', true], ['sale', 'credit', false],
    ['purchase', 'credit', true], ['purchase', 'debit', false],
  ])('%s as %s', async (type, effect, allowed) => {
    const attempt = insertTxn({ type, effect, status: 'draft', total: '0' });
    await (allowed ? expect(attempt).resolves.toBeTruthy() : expectPg(attempt, PG.check));
  });

  it.each([
    ['receipt', 'credit', true], ['receipt', 'debit', false],
    ['payment', 'debit', true], ['payment', 'credit', false],
  ])('%s as %s', async (type, effect, allowed) => {
    const attempt = insertTxn({ type, effect, method: 'cash' });
    await (allowed ? expect(attempt).resolves.toBeTruthy() : expectPg(attempt, PG.check));
  });

  it('lets direct entries and opening balances go either way', async () => {
    for (const type of ['ledger_entry', 'opening_balance']) {
      for (const effect of ['debit', 'credit']) {
        const contactId = await newContact(biz.id);
        await expect(insertTxn({ type, effect, contactId })).resolves.toBeTruthy();
      }
    }
  });
});

describe('what a posted row must look like', () => {
  it('has a positive amount; zero and negative are refused', async () => {
    await expectPg(insertTxn({ total: '0' }), PG.check);
    await expectPg(insertTxn({ total: '-5.00' }), PG.check);
  });

  it('needs a reference number, a posting time and who posted it', async () => {
    const insert = (sql) => db.query(sql, [biz.id, contact, user.id]);
    const cols = '(business_id, contact_id, type, status, effect, txn_date, total, created_by, posted_at, posted_by, reference_no)';
    await expectPg(insert(`INSERT INTO transactions ${cols} VALUES ($1, $2, 'ledger_entry', 'posted', 'debit', '2025-05-01', 10, $3, now(), $3, NULL)`), PG.check);
    await expectPg(insert(`INSERT INTO transactions ${cols} VALUES ($1, $2, 'ledger_entry', 'posted', 'debit', '2025-05-01', 10, $3, NULL, $3, 'X-1')`), PG.check);
    await expectPg(insert(`INSERT INTO transactions ${cols} VALUES ($1, $2, 'ledger_entry', 'posted', 'debit', '2025-05-01', 10, $3, now(), NULL, 'X-2')`), PG.check);
  });

  it('allows drafts only for sales and purchases, and a draft may have no number or amount yet', async () => {
    await expectPg(insertTxn({ status: 'draft', total: '0' }), PG.check); // a draft direct entry makes no sense
    const draft = await insertTxn({ type: 'sale', status: 'draft', total: '0' });
    expect(draft.reference_no).toBeNull();
  });

  it('ties payment method to receipts and payments only', async () => {
    await expectPg(insertTxn({ type: 'receipt', effect: 'credit', method: null }), PG.check);
    await expectPg(insertTxn({ type: 'ledger_entry', method: 'cash' }), PG.check);
    await expectPg(insertTxn({ type: 'receipt', effect: 'credit', method: 'bitcoin' }), PG.check);
    for (const method of ['cash', 'bank_transfer', 'cheque', 'esewa', 'khalti', 'other']) {
      await expect(insertTxn({ type: 'receipt', effect: 'credit', method })).resolves.toBeTruthy();
    }
  });

  it('refuses a due date before the transaction date', async () => {
    await expectPg(insertTxn({ type: 'sale', status: 'draft', total: '0', date: '2025-05-10', dueDate: '2025-05-09' }), PG.check);
  });
});

describe('contacts and numbers stay inside their business', () => {
  it('cannot point at a contact of another business (composite foreign key)', async () => {
    await expectPg(insertTxn({ businessId: biz.id, contactId: otherContact }), PG.foreignKey);
    await expectPg(insertTxn({ businessId: otherBiz.id, contactId: contact }), PG.foreignKey);
  });

  it('reference numbers are unique per business and type, but may repeat elsewhere', async () => {
    const ref = `U-${unique()}`;
    await insertTxn({ ref });
    await expectPg(insertTxn({ ref, contactId: await newContact(biz.id) }), PG.unique);
    await expect(insertTxn({ ref, businessId: otherBiz.id, contactId: otherContact })).resolves.toBeTruthy(); // other business
    await expect(insertTxn({ ref, type: 'receipt', effect: 'credit', method: 'cash' })).resolves.toBeTruthy(); // other type
  });

  it('allows one active opening balance per contact, and a new one after voiding', async () => {
    const contactId = await newContact(biz.id);
    const first = await insertTxn({ type: 'opening_balance', contactId });
    await expectPg(insertTxn({ type: 'opening_balance', contactId }), PG.unique);
    await db.query("UPDATE transactions SET status = 'voided', voided_at = now(), voided_by = $2, void_reason = 'redo' WHERE id = $1", [first.id, user.id]);
    await expect(insertTxn({ type: 'opening_balance', contactId })).resolves.toBeTruthy();
  });

  it('a correction can only point at a transaction of the same business', async () => {
    const original = await insertTxn({ businessId: otherBiz.id, contactId: otherContact });
    await expectPg(
      db.query(
        `INSERT INTO transactions (business_id, contact_id, type, status, effect, txn_date, total, reference_no, posted_at, posted_by, created_by, corrects_transaction_id)
         VALUES ($1, $2, 'ledger_entry', 'posted', 'debit', '2025-05-01', 5, $3, now(), $4, $4, $5)`,
        [biz.id, contact, `C-${unique()}`, user.id, original.id],
      ),
      PG.foreignKey,
    );
  });
});

describe('posted history cannot be rewritten', () => {
  const change = (id, set, params = []) => db.query(`UPDATE transactions SET ${set} WHERE id = $1`, [id, ...params]);

  it.each([
    ['the amount', 'total = 999'],
    ['the date', "txn_date = '2024-01-01'"],
    ['the direction', "effect = 'credit'"],
    ['the type', "type = 'opening_balance'"],
    ['the reference number', "reference_no = 'HACKED'"],
    ['who created it', 'created_by = created_by'], // unchanged value: allowed (see next test)
  ])('refuses to change %s', async (label, set) => {
    const row = await insertTxn();
    if (label === 'who created it') {
      await expect(change(row.id, set)).resolves.toBeTruthy();
      return;
    }
    await expect(change(row.id, set)).rejects.toThrow(/cannot be changed|can only be voided/);
    const after = (await db.query('SELECT total, txn_date, effect, type, reference_no FROM transactions WHERE id = $1', [row.id])).rows[0];
    expect(after).toEqual({ total: row.total, txn_date: row.txn_date, effect: row.effect, type: row.type, reference_no: row.reference_no });
  });

  it('refuses to move a posted entry to another contact or another business', async () => {
    const row = await insertTxn();
    const another = await newContact(biz.id);
    await expect(db.query('UPDATE transactions SET contact_id = $2 WHERE id = $1', [row.id, another])).rejects.toThrow(/cannot be changed/);
    await expect(db.query('UPDATE transactions SET business_id = $2, contact_id = $3 WHERE id = $1', [row.id, otherBiz.id, otherContact])).rejects.toThrow();
  });

  it('still lets description, notes and the external reference be edited', async () => {
    const row = await insertTxn();
    const { rows } = await db.query(
      "UPDATE transactions SET description = 'fixed typo', notes = 'n', external_ref = 'CHQ-1' WHERE id = $1 RETURNING description, notes, external_ref",
      [row.id],
    );
    expect(rows[0]).toEqual({ description: 'fixed typo', notes: 'n', external_ref: 'CHQ-1' });
  });

  it('cannot be deleted', async () => {
    const row = await insertTxn();
    await expect(db.query('DELETE FROM transactions WHERE id = $1', [row.id])).rejects.toThrow(/cannot be deleted/);
    expect((await db.query('SELECT 1 FROM transactions WHERE id = $1', [row.id])).rowCount).toBe(1);
  });

  it('cannot go back to draft', async () => {
    const row = await insertTxn();
    await expect(change(row.id, "status = 'draft'")).rejects.toThrow(/can only be voided/);
  });
});

describe('voiding', () => {
  const voidIt = (id, reason = 'entered by mistake') =>
    db.query("UPDATE transactions SET status = 'voided', voided_at = now(), voided_by = $2, void_reason = $3 WHERE id = $1", [id, user.id, reason]);

  it('works, and then the row is frozen for good', async () => {
    const row = await insertTxn();
    await voidIt(row.id);
    await expect(db.query("UPDATE transactions SET description = 'x' WHERE id = $1", [row.id])).rejects.toThrow(/voided transaction cannot be changed/);
    await expect(db.query("UPDATE transactions SET status = 'posted', voided_at = NULL, voided_by = NULL, void_reason = NULL WHERE id = $1", [row.id])).rejects.toThrow(/voided transaction cannot be changed/);
    await expect(db.query('DELETE FROM transactions WHERE id = $1', [row.id])).rejects.toThrow(/cannot be deleted/);
  });

  it('must say who and why', async () => {
    const row = await insertTxn();
    await expectPg(voidIt(row.id, '   '), PG.check);
    await expectPg(db.query("UPDATE transactions SET status = 'voided', voided_at = now(), void_reason = 'x' WHERE id = $1", [row.id]), PG.check);
    await expectPg(db.query("UPDATE transactions SET status = 'voided', void_reason = 'x', voided_by = $2 WHERE id = $1", [row.id, user.id]), PG.check); // no voided_at
  });
});

describe('drafts', () => {
  it('can be edited and deleted freely', async () => {
    const draft = await insertTxn({ type: 'sale', status: 'draft', total: '0' });
    await db.query("UPDATE transactions SET total = 500, txn_date = '2025-06-01' WHERE id = $1", [draft.id]);
    await db.query('DELETE FROM transactions WHERE id = $1', [draft.id]);
    expect((await db.query('SELECT 1 FROM transactions WHERE id = $1', [draft.id])).rowCount).toBe(0);
  });
});

describe('removing a whole business', () => {
  it('is the one way posted rows disappear, and it works cleanly', async () => {
    const tempBiz = await createBusiness(db, user.id, 'Doomed Co');
    const tempContact = await newContact(tempBiz.id);
    await insertTxn({ businessId: tempBiz.id, contactId: tempContact });
    await insertTxn({ businessId: tempBiz.id, contactId: tempContact, type: 'opening_balance' });
    await db.query('DELETE FROM businesses WHERE id = $1', [tempBiz.id]);
    expect((await db.query('SELECT 1 FROM transactions WHERE business_id = $1', [tempBiz.id])).rowCount).toBe(0);
  });
});

describe('document_sequences', () => {
  it('only knows the real kinds of document and starts at 1', async () => {
    const insert = (kind, next = 1) => db.query('INSERT INTO document_sequences (business_id, doc_kind, fiscal_year, next_value) VALUES ($1, $2, $3, $4)', [biz.id, kind, `s${unique()}`, next]);
    await expect(insert('sale')).resolves.toBeTruthy();
    await expectPg(insert('invoice'), PG.check);
    await expectPg(insert('sale', 0), PG.check);
  });
});

describe('reference numbers', () => {
  const inTx = (fn) => withTransaction(db, fn);
  const fy = fiscalYear(2082);

  it('use the business prefix, the fiscal year of the date, and a four-digit counter', async () => {
    const b = await createBusiness(db, user.id, 'Numbering Co');
    created.businessIds.push(b.id);
    await db.query("UPDATE business_settings SET ledger_prefix = 'KH', opening_prefix = 'OP' WHERE business_id = $1", [b.id]);
    expect(await inTx((tx) => nextReference(tx, b.id, 'ledger_entry', fy.start))).toBe('KH-2082/83-0001');
    expect(await inTx((tx) => nextReference(tx, b.id, 'ledger_entry', fy.start))).toBe('KH-2082/83-0002');
    expect(await inTx((tx) => nextReference(tx, b.id, 'opening_balance', fy.start))).toBe('OP-2082/83-0001'); // own counter per kind
  });

  it('restart in a new fiscal year, decided by the date of the transaction (Shrawan 1)', async () => {
    const b = await createBusiness(db, user.id, 'Fiscal Co');
    created.businessIds.push(b.id);
    const lastDayOfOld = fiscalYear(2081).end;
    expect(await inTx((tx) => nextReference(tx, b.id, 'ledger_entry', lastDayOfOld))).toBe('LE-2081/82-0001');
    expect(await inTx((tx) => nextReference(tx, b.id, 'ledger_entry', fy.start))).toBe('LE-2082/83-0001');
    expect(await inTx((tx) => nextReference(tx, b.id, 'ledger_entry', lastDayOfOld))).toBe('LE-2081/82-0002'); // a back-dated entry continues the old year
  });

  it('are never repeated when many people save at the same moment', async () => {
    const b = await createBusiness(db, user.id, 'Busy Co');
    created.businessIds.push(b.id);
    const numbers = await Promise.all(Array.from({ length: 12 }, () => inTx((tx) => nextReference(tx, b.id, 'ledger_entry', fy.start))));
    expect(new Set(numbers).size).toBe(12);
    expect(numbers.map((n) => Number(n.slice(-4))).sort((a, c) => a - c)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1)); // 1..12, no gaps
  });

  it('are not used up by a save that fails and rolls back', async () => {
    const b = await createBusiness(db, user.id, 'Rollback Co');
    created.businessIds.push(b.id);
    await inTx((tx) => nextReference(tx, b.id, 'ledger_entry', fy.start)); // LE-…-0001
    await expect(
      inTx(async (tx) => {
        await nextReference(tx, b.id, 'ledger_entry', fy.start); // would be 0002
        throw new Error('save failed');
      }),
    ).rejects.toThrow('save failed');
    expect(await inTx((tx) => nextReference(tx, b.id, 'ledger_entry', fy.start))).toBe('LE-2082/83-0002'); // 0002 is still free
  });

  it('refuses an unknown kind of document', async () => {
    await expect(inTx((tx) => nextReference(tx, biz.id, 'invoice', fy.start))).rejects.toThrow(/Unknown document kind/);
  });
});
