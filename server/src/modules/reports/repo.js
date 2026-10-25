// Read-only queries for the dashboard and reports. Every query is scoped by business_id (first argument) and
// counts POSTED transactions only; voided ones and drafts never appear in a total.

const SIGNED = "CASE t.effect WHEN 'debit' THEN t.total ELSE -t.total END";
const KINDS = "('sale', 'purchase', 'receipt', 'payment')";

/** Totals per kind inside a period. */
export async function totalsByType(db, businessId, from, to) {
  const { rows } = await db.query(
    `SELECT t.type, count(*)::int AS count, COALESCE(SUM(t.total), 0)::numeric(16, 2) AS total, COALESCE(SUM(t.tax_total), 0)::numeric(16, 2) AS tax
       FROM transactions t
      WHERE t.business_id = $1 AND t.status = 'posted' AND t.type IN ${KINDS} AND t.txn_date BETWEEN $2 AND $3
      GROUP BY t.type`,
    [businessId, from, to],
  );
  return rows;
}

/** Per day and kind: the building block of the daily and monthly reports. */
export async function dailyByType(db, businessId, from, to) {
  const { rows } = await db.query(
    `SELECT t.txn_date, t.type, count(*)::int AS count, SUM(t.total)::numeric(16, 2) AS total, SUM(t.tax_total)::numeric(16, 2) AS tax
       FROM transactions t
      WHERE t.business_id = $1 AND t.status = 'posted' AND t.type IN ${KINDS} AND t.txn_date BETWEEN $2 AND $3
      GROUP BY t.txn_date, t.type ORDER BY t.txn_date`,
    [businessId, from, to],
  );
  return rows;
}

/** What contacts owe (positive) and what is owed to them, today. Voided and draft rows never count. */
export async function receivablesAndPayables(db, businessId) {
  const { rows } = await db.query(
    `WITH balances AS (
       SELECT t.contact_id, SUM(${SIGNED}) AS balance
         FROM transactions t WHERE t.business_id = $1 AND t.status = 'posted' GROUP BY t.contact_id)
     SELECT COALESCE(SUM(balance) FILTER (WHERE balance > 0), 0)::numeric(16, 2) AS receivable,
            COALESCE(-SUM(balance) FILTER (WHERE balance < 0), 0)::numeric(16, 2) AS payable,
            count(*) FILTER (WHERE balance > 0)::int AS receivable_contacts,
            count(*) FILTER (WHERE balance < 0)::int AS payable_contacts
       FROM balances`,
    [businessId],
  );
  return rows[0];
}

const OVERDUE_BASE = `
  FROM transactions t
  JOIN contacts c ON c.business_id = t.business_id AND c.id = t.contact_id
  LEFT JOIN LATERAL (SELECT COALESCE(SUM(a.amount), 0) AS paid FROM payment_allocations a
                      WHERE a.business_id = t.business_id AND a.invoice_txn_id = t.id AND a.status = 'active') al ON true
 WHERE t.business_id = $1 AND t.status = 'posted' AND t.type = $2 AND t.due_date IS NOT NULL AND t.due_date < $3
   AND t.total - al.paid > 0`;

/** Sum still owed on documents past their due date (sales for receivables, purchases for payables). */
export async function overdueTotal(db, businessId, documentType, today) {
  const { rows } = await db.query(
    `SELECT COALESCE(SUM(t.total - al.paid), 0)::numeric(16, 2) AS amount, count(*)::int AS count ${OVERDUE_BASE}`,
    [businessId, documentType, today],
  );
  return rows[0];
}

export async function overdueDocuments(db, businessId, documentType, today) {
  const { rows } = await db.query(
    `SELECT t.id, t.reference_no, t.txn_date, t.due_date, t.total, al.paid::numeric(16, 2) AS paid,
            (t.total - al.paid)::numeric(16, 2) AS outstanding, ($3::date - t.due_date)::int AS days_overdue,
            t.contact_id, c.name AS contact_name, c.phone AS contact_phone
       ${OVERDUE_BASE} ORDER BY t.due_date, t.reference_no, t.id`,
    [businessId, documentType, today],
  );
  return rows;
}

/** Contacts with a balance on one side, biggest first; includes how much of it is past due. */
export async function outstandingByContact(db, businessId, side, today, pattern) {
  const documentType = side === 'receivable' ? 'sale' : 'purchase';
  const { rows } = await db.query(
    `WITH balances AS (
       SELECT t.contact_id, SUM(${SIGNED}) AS balance
         FROM transactions t WHERE t.business_id = $1 AND t.status = 'posted' GROUP BY t.contact_id),
     overdue AS (
       SELECT t.contact_id, SUM(t.total - al.paid) AS amount ${OVERDUE_BASE} GROUP BY t.contact_id)
     SELECT c.id AS contact_id, c.name, c.phone, abs(b.balance)::numeric(16, 2) AS balance,
            COALESCE(o.amount, 0)::numeric(16, 2) AS overdue
       FROM balances b
       JOIN contacts c ON c.business_id = $1 AND c.id = b.contact_id
       LEFT JOIN overdue o ON o.contact_id = b.contact_id
      WHERE ${side === 'receivable' ? 'b.balance > 0' : 'b.balance < 0'}
        AND ($4::text IS NULL OR c.name ILIKE $4 ESCAPE '\\' OR c.phone ILIKE $4 ESCAPE '\\')
      ORDER BY abs(b.balance) DESC, c.name, c.id`,
    [businessId, documentType, today, pattern],
  );
  return rows;
}

export async function recentTransactions(db, businessId, limit) {
  const { rows } = await db.query(
    `SELECT t.id, t.type, t.effect, t.txn_date, t.reference_no, t.description, t.total, t.contact_id, c.name AS contact_name
       FROM transactions t JOIN contacts c ON c.business_id = t.business_id AND c.id = t.contact_id
      WHERE t.business_id = $1 AND t.status = 'posted'
      ORDER BY t.posted_at DESC, t.id LIMIT $2`,
    [businessId, limit],
  );
  return rows;
}
