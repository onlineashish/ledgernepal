// SQL for direct ledger entries, opening balances and the contact ledger. Every query is scoped by
// business_id (first argument). Amounts are NUMERIC and come back as exact decimal strings.

const SIGNED = "CASE t.effect WHEN 'debit' THEN t.total ELSE -t.total END";
// Opening balance first within a date, then the order they were posted: always the same order.
const LEDGER_ORDER = "t.txn_date, (t.type <> 'opening_balance'), t.posted_at, t.id";
const escapeLike = (text) => text.replace(/[\\%_]/g, '\\$&');
const likePattern = (q) => (q ? `%${escapeLike(q)}%` : null);

const ENTRY_SELECT = `
  SELECT t.id, t.type, t.status, t.effect, t.txn_date, t.total AS amount, t.reference_no, t.external_ref,
         t.description, t.notes, t.contact_id, c.name AS contact_name, t.corrects_transaction_id,
         t.created_at, t.posted_at, t.voided_at, t.void_reason, t.created_by, u.full_name AS created_by_name
    FROM transactions t
    JOIN contacts c ON c.business_id = t.business_id AND c.id = t.contact_id
    LEFT JOIN users u ON u.id = t.created_by`;

export async function insertPosted(db, { businessId, userId, contactId, type, effect, txnDate, amount, referenceNo, externalRef, description, correctsId }) {
  const { rows } = await db.query(
    `INSERT INTO transactions
       (business_id, contact_id, type, status, effect, txn_date, total, reference_no, external_ref,
        description, corrects_transaction_id, posted_at, posted_by, created_by)
     VALUES ($1, $2, $3, 'posted', $4, $5, $6, $7, $8, $9, $10, now(), $11, $11)
     RETURNING id`,
    [businessId, contactId, type, effect, txnDate, amount, referenceNo, externalRef ?? null, description ?? null, correctsId ?? null, userId],
  );
  return rows[0].id;
}

/** One entry by id (posted or voided), ledger types only. */
export async function findEntry(db, businessId, id, { forUpdate = false } = {}) {
  const { rows } = await db.query(
    `${ENTRY_SELECT}
      WHERE t.business_id = $1 AND t.id = $2 AND t.type IN ('ledger_entry', 'opening_balance')
      ${forUpdate ? 'FOR UPDATE OF t' : ''}`,
    [businessId, id],
  );
  return rows[0] ?? null;
}

export async function findActiveOpeningBalance(db, businessId, contactId, { forUpdate = false } = {}) {
  const { rows } = await db.query(
    `${ENTRY_SELECT}
      WHERE t.business_id = $1 AND t.contact_id = $2 AND t.type = 'opening_balance' AND t.status = 'posted'
      ${forUpdate ? 'FOR UPDATE OF t' : ''}`,
    [businessId, contactId],
  );
  return rows[0] ?? null;
}

export async function voidPosted(db, { businessId, userId, id, reason }) {
  const { rowCount } = await db.query(
    `UPDATE transactions
        SET status = 'voided', voided_at = now(), voided_by = $3, void_reason = $4, updated_by = $3
      WHERE business_id = $1 AND id = $2 AND status = 'posted'`,
    [businessId, id, userId, reason],
  );
  return rowCount > 0;
}

// Only these columns of a posted entry can be edited; the database trigger refuses everything else.
const EDITABLE = { description: 'description', notes: 'notes', externalRef: 'external_ref' };

export async function updateText(db, { businessId, userId, id, changes }) {
  const sets = [];
  const values = [businessId, id, userId];
  for (const [field, column] of Object.entries(EDITABLE)) {
    if (changes[field] !== undefined) {
      values.push(changes[field]);
      sets.push(`${column} = $${values.length}`);
    }
  }
  await db.query(`UPDATE transactions SET ${sets.join(', ')}, updated_by = $3 WHERE business_id = $1 AND id = $2`, values);
}

export async function listEntries(db, businessId, { contactId, from, to, status, type, q, page, pageSize }) {
  const filter = `
    t.business_id = $1 AND t.type IN ('ledger_entry', 'opening_balance')
    AND ($2::uuid IS NULL OR t.contact_id = $2)
    AND ($3::date IS NULL OR t.txn_date >= $3) AND ($4::date IS NULL OR t.txn_date <= $4)
    AND ($5::text = 'all' OR t.status = $5)
    AND ($6::text = 'all' OR t.type = $6)
    AND ($7::text IS NULL OR t.description ILIKE $7 ESCAPE '\\' OR t.reference_no ILIKE $7 ESCAPE '\\'
         OR t.external_ref ILIKE $7 ESCAPE '\\' OR c.name ILIKE $7 ESCAPE '\\')`;
  const params = [businessId, contactId ?? null, from ?? null, to ?? null, status, type, likePattern(q)];

  const [list, count] = await Promise.all([
    db.query(`${ENTRY_SELECT} WHERE ${filter} ORDER BY t.txn_date DESC, t.posted_at DESC, t.id LIMIT $8 OFFSET $9`, [...params, pageSize, (page - 1) * pageSize]),
    db.query(
      `SELECT count(*)::int AS total FROM transactions t
         JOIN contacts c ON c.business_id = t.business_id AND c.id = t.contact_id WHERE ${filter}`,
      params,
    ),
  ]);
  return { rows: list.rows, total: count.rows[0].total };
}

// ------------------------------------------------------------------ the contact ledger

/**
 * One page of a contact's ledger with the running balance after each line.
 * The running balance is calculated over EVERY posted line up to `to`, and only then are the date
 * range, the search text and the paging applied, so a line's balance never depends on how it was found.
 */
export async function ledgerRows(db, businessId, contactId, { from, to, q, page, pageSize }) {
  const params = [businessId, contactId, from ?? null, to ?? null, likePattern(q)];
  const [rows, summary, count] = await Promise.all([
    db.query(
      `WITH ordered AS (
         SELECT t.id, t.reference_no, t.txn_date, t.type, t.effect, t.total, t.description, t.external_ref,
                t.posted_at, t.created_by,
                SUM(${SIGNED}) OVER (ORDER BY ${LEDGER_ORDER}) AS running
           FROM transactions t
          WHERE t.business_id = $1 AND t.contact_id = $2 AND t.status = 'posted'
            AND ($4::date IS NULL OR t.txn_date <= $4)
       )
       SELECT t.*, u.full_name AS created_by_name
         FROM ordered t LEFT JOIN users u ON u.id = t.created_by
        WHERE ($3::date IS NULL OR t.txn_date >= $3)
          AND ($5::text IS NULL OR t.description ILIKE $5 ESCAPE '\\' OR t.reference_no ILIKE $5 ESCAPE '\\' OR t.external_ref ILIKE $5 ESCAPE '\\')
        ORDER BY ${LEDGER_ORDER}
        LIMIT $6 OFFSET $7`,
      [...params, pageSize, (page - 1) * pageSize],
    ),
    db.query(
      `SELECT COALESCE(SUM(${SIGNED}) FILTER (WHERE $3::date IS NOT NULL AND t.txn_date < $3), 0)::numeric(16, 2) AS brought_forward,
              COALESCE(SUM(t.total) FILTER (WHERE t.effect = 'debit'  AND ($3::date IS NULL OR t.txn_date >= $3) AND ($4::date IS NULL OR t.txn_date <= $4)), 0)::numeric(16, 2) AS debit_total,
              COALESCE(SUM(t.total) FILTER (WHERE t.effect = 'credit' AND ($3::date IS NULL OR t.txn_date >= $3) AND ($4::date IS NULL OR t.txn_date <= $4)), 0)::numeric(16, 2) AS credit_total,
              COALESCE(SUM(${SIGNED}) FILTER (WHERE $4::date IS NULL OR t.txn_date <= $4), 0)::numeric(16, 2) AS closing
         FROM transactions t
        WHERE t.business_id = $1 AND t.contact_id = $2 AND t.status = 'posted'`,
      params.slice(0, 4),
    ),
    db.query(
      `SELECT count(*)::int AS total FROM transactions t
        WHERE t.business_id = $1 AND t.contact_id = $2 AND t.status = 'posted'
          AND ($3::date IS NULL OR t.txn_date >= $3) AND ($4::date IS NULL OR t.txn_date <= $4)
          AND ($5::text IS NULL OR t.description ILIKE $5 ESCAPE '\\' OR t.reference_no ILIKE $5 ESCAPE '\\' OR t.external_ref ILIKE $5 ESCAPE '\\')`,
      params,
    ),
  ]);
  return { rows: rows.rows, summary: summary.rows[0], total: count.rows[0].total };
}
