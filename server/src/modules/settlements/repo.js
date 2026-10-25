// Receipts, payments and the allocations that match them to invoices and bills.
// Every query is scoped by business_id and by type, so /api/receipts can never reach a payment.

const escapeLike = (text) => text.replace(/[\\%_]/g, '\\$&');

// How much of a receipt/payment is matched to documents. Voided payments report 0 unallocated.
const ALLOCATED_LATERAL = `
  LEFT JOIN LATERAL (
    SELECT SUM(a.amount) AS allocated FROM payment_allocations a
     WHERE a.business_id = t.business_id AND a.payment_txn_id = t.id AND a.status = 'active') al ON true`;

const SELECT = `
  SELECT t.id, t.type, t.status, t.txn_date, t.total, t.payment_method, t.reference_no, t.external_ref, t.description, t.notes,
         t.contact_id, c.name AS contact_name, t.created_by, u.full_name AS created_by_name,
         t.created_at, t.posted_at, t.voided_at, t.void_reason,
         COALESCE(al.allocated, 0)::numeric(16, 2) AS allocated,
         (CASE WHEN t.status = 'posted' THEN t.total - COALESCE(al.allocated, 0) ELSE 0 END)::numeric(16, 2) AS unallocated
    FROM transactions t
    JOIN contacts c ON c.business_id = t.business_id AND c.id = t.contact_id
    LEFT JOIN users u ON u.id = t.created_by
    ${ALLOCATED_LATERAL}`;

export async function insertPayment(db, { businessId, userId, type, effect, contactId, txnDate, amount, method, referenceNo, externalRef, description, notes }) {
  const { rows } = await db.query(
    `INSERT INTO transactions
       (business_id, contact_id, type, status, effect, txn_date, total, reference_no, payment_method, external_ref,
        description, notes, posted_at, posted_by, created_by)
     VALUES ($1, $2, $3, 'posted', $4, $5, $6, $7, $8, $9, $10, $11, now(), $12, $12)
     RETURNING id`,
    [businessId, contactId, type, effect, txnDate, amount, referenceNo, method, externalRef ?? null, description ?? null, notes ?? null, userId],
  );
  return rows[0].id;
}

export async function findPayment(db, businessId, type, id, { forUpdate = false } = {}) {
  const { rows } = await db.query(
    `${SELECT} WHERE t.business_id = $1 AND t.type = $2 AND t.id = $3 ${forUpdate ? 'FOR UPDATE OF t' : ''}`,
    [businessId, type, id],
  );
  return rows[0] ?? null;
}

export async function listPayments(db, businessId, type, { contactId, from, to, method, status, allocation, q, page, pageSize }) {
  const filter = `
    t.business_id = $1 AND t.type = $2
    AND ($3::uuid IS NULL OR t.contact_id = $3)
    AND ($4::date IS NULL OR t.txn_date >= $4) AND ($5::date IS NULL OR t.txn_date <= $5)
    AND ($6::text IS NULL OR t.payment_method = $6)
    AND ($7::text = 'all' OR t.status = $7)
    AND ($8::text = 'all' OR (t.status = 'posted' AND t.total - COALESCE(al.allocated, 0) > 0))
    AND ($9::text IS NULL OR t.reference_no ILIKE $9 ESCAPE '\\' OR t.external_ref ILIKE $9 ESCAPE '\\'
         OR t.description ILIKE $9 ESCAPE '\\' OR c.name ILIKE $9 ESCAPE '\\')`;
  const params = [businessId, type, contactId ?? null, from ?? null, to ?? null, method ?? null, status, allocation, q ? `%${escapeLike(q)}%` : null];
  const [list, count] = await Promise.all([
    db.query(`${SELECT} WHERE ${filter} ORDER BY t.txn_date DESC, t.posted_at DESC, t.id LIMIT $10 OFFSET $11`, [...params, pageSize, (page - 1) * pageSize]),
    db.query(
      `SELECT count(*)::int AS total FROM transactions t
         JOIN contacts c ON c.business_id = t.business_id AND c.id = t.contact_id
         ${ALLOCATED_LATERAL} WHERE ${filter}`,
      params,
    ),
  ]);
  return { rows: list.rows, total: count.rows[0].total };
}

/** The documents a receipt/payment currently settles (live allocations only). */
export async function findAllocations(db, businessId, paymentId) {
  const { rows } = await db.query(
    `SELECT a.id, a.amount, i.id AS document_id, i.type AS document_type, i.reference_no, i.txn_date, i.total AS document_total
       FROM payment_allocations a JOIN transactions i ON i.business_id = a.business_id AND i.id = a.invoice_txn_id
      WHERE a.business_id = $1 AND a.payment_txn_id = $2 AND a.status = 'active'
      ORDER BY i.txn_date, i.reference_no`,
    [businessId, paymentId],
  );
  return rows;
}

/**
 * Locks the named invoices/bills (in id order, so two requests cannot deadlock) and reports how much of
 * each is already paid. Only documents of this business and of the right kind are found.
 */
export async function lockDocuments(db, businessId, documentType, ids) {
  const { rows } = await db.query(
    `SELECT t.id, t.contact_id, t.status, t.total, t.txn_date, t.reference_no,
            COALESCE((SELECT SUM(a.amount) FROM payment_allocations a
                       WHERE a.business_id = t.business_id AND a.invoice_txn_id = t.id AND a.status = 'active'), 0)::numeric(16, 2) AS paid
       FROM transactions t
      WHERE t.business_id = $1 AND t.type = $2 AND t.id = ANY($3::uuid[])
      ORDER BY t.id FOR UPDATE OF t`,
    [businessId, documentType, ids],
  );
  return rows;
}

/** Posted invoices/bills of one contact that still have something outstanding. Locked when `forUpdate`. */
export async function listOpenDocuments(db, businessId, documentType, contactId, { forUpdate = false } = {}) {
  const { rows } = await db.query(
    `SELECT t.id, t.reference_no, t.txn_date, t.due_date, t.total, t.description,
            p.paid, (t.total - p.paid)::numeric(16, 2) AS outstanding
       FROM transactions t
       CROSS JOIN LATERAL (SELECT COALESCE(SUM(a.amount), 0)::numeric(16, 2) AS paid FROM payment_allocations a
                            WHERE a.business_id = t.business_id AND a.invoice_txn_id = t.id AND a.status = 'active') p
      WHERE t.business_id = $1 AND t.type = $2 AND t.contact_id = $3 AND t.status = 'posted' AND t.total > p.paid
      ORDER BY t.txn_date, t.reference_no, t.id
      ${forUpdate ? 'FOR UPDATE OF t' : ''}`,
    [businessId, documentType, contactId],
  );
  return rows;
}

export async function insertAllocations(db, businessId, paymentId, userId, items) {
  await db.query(
    `INSERT INTO payment_allocations (business_id, payment_txn_id, invoice_txn_id, amount, created_by)
     SELECT $1, $2, x.invoice_id, x.amount, $3 FROM unnest($4::uuid[], $5::numeric[]) AS x(invoice_id, amount)`,
    [businessId, paymentId, userId, items.map((i) => i.invoiceId), items.map((i) => i.amount)],
  );
}

const cancel = (column) => `
  UPDATE payment_allocations SET status = 'voided', voided_at = now(), voided_by = $3
   WHERE business_id = $1 AND ${column} = $2 AND status = 'active'
   RETURNING payment_txn_id, invoice_txn_id, amount`;

/** Cancels every live allocation of a receipt/payment. Returns what was released. */
export async function cancelAllocationsOfPayment(db, businessId, paymentId, userId) {
  return (await db.query(cancel('payment_txn_id'), [businessId, paymentId, userId])).rows;
}

/** Cancels every live allocation to an invoice/bill (used when it is voided). Returns what was released. */
export async function cancelAllocationsOfDocument(db, businessId, documentId, userId) {
  return (await db.query(cancel('invoice_txn_id'), [businessId, documentId, userId])).rows;
}
