// Sales invoices and purchase bills (transactions of type 'sale' / 'purchase') and their lines.
// Every query is scoped by business_id and by type, so /api/sales can never reach a purchase.

const escapeLike = (text) => text.replace(/[\\%_]/g, '\\$&');

// How much of a document has been paid: the live allocations of receipts/payments to it.
const PAID_LATERAL = `
  LEFT JOIN LATERAL (
    SELECT SUM(a.amount) AS paid FROM payment_allocations a
     WHERE a.business_id = t.business_id AND a.invoice_txn_id = t.id AND a.status = 'active') al ON true`;

const HEADER_SELECT = `
  SELECT t.id, t.type, t.status, t.effect, t.txn_date, t.due_date, t.reference_no, t.external_ref, t.description, t.notes,
         t.subtotal, t.discount_total, t.taxable_total, t.non_taxable_total, t.tax_total, t.total,
         t.contact_id, c.name AS contact_name,
         t.created_at, t.created_by, cu.full_name AS created_by_name,
         t.posted_at, t.voided_at, t.void_reason,
         COALESCE(al.paid, 0)::numeric(16, 2) AS paid
    FROM transactions t
    JOIN contacts c ON c.business_id = t.business_id AND c.id = t.contact_id
    LEFT JOIN users cu ON cu.id = t.created_by
    ${PAID_LATERAL}`;

export async function findDocument(db, businessId, type, id, { forUpdate = false } = {}) {
  const { rows } = await db.query(
    `${HEADER_SELECT} WHERE t.business_id = $1 AND t.type = $2 AND t.id = $3 ${forUpdate ? 'FOR UPDATE OF t' : ''}`,
    [businessId, type, id],
  );
  return rows[0] ?? null;
}

export async function findLines(db, businessId, transactionId) {
  const { rows } = await db.query(
    `SELECT line_no, description, quantity, unit, unit_price, gross_amount, discount_amount, invoice_discount_share,
            is_taxable, tax_rate, taxable_amount, tax_amount, line_total
       FROM transaction_lines WHERE business_id = $1 AND transaction_id = $2 ORDER BY line_no`,
    [businessId, transactionId],
  );
  return rows;
}

export async function insertDraft(db, { businessId, userId, type, effect, contactId, txnDate, dueDate, externalRef, notes, description, totals }) {
  const { rows } = await db.query(
    `INSERT INTO transactions
       (business_id, contact_id, type, status, effect, txn_date, due_date, external_ref, notes, description,
        subtotal, discount_total, taxable_total, non_taxable_total, tax_total, total, created_by)
     VALUES ($1, $2, $3, 'draft', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
     RETURNING id`,
    [businessId, contactId, type, effect, txnDate, dueDate ?? null, externalRef ?? null, notes ?? null, description,
      totals.subtotal, totals.discount, totals.taxable, totals.nonTaxable, totals.tax, totals.total, userId],
  );
  return rows[0].id;
}

/** Replaces all lines of a draft in one statement (one round trip however many lines there are). */
export async function replaceLines(db, businessId, transactionId, lines) {
  await db.query('DELETE FROM transaction_lines WHERE business_id = $1 AND transaction_id = $2', [businessId, transactionId]);
  await db.query(
    `INSERT INTO transaction_lines
       (business_id, transaction_id, line_no, description, quantity, unit, unit_price, gross_amount, discount_amount,
        invoice_discount_share, is_taxable, tax_rate, taxable_amount, tax_amount, line_total)
     SELECT $1, $2, x.* FROM unnest($3::int[], $4::text[], $5::numeric[], $6::text[], $7::numeric[], $8::numeric[],
                                    $9::numeric[], $10::numeric[], $11::boolean[], $12::numeric[], $13::numeric[],
                                    $14::numeric[], $15::numeric[])
       AS x(line_no, description, quantity, unit, unit_price, gross_amount, discount_amount, invoice_discount_share,
            is_taxable, tax_rate, taxable_amount, tax_amount, line_total)`,
    [
      businessId, transactionId,
      lines.map((l) => l.lineNo), lines.map((l) => l.description), lines.map((l) => l.quantity), lines.map((l) => l.unit),
      lines.map((l) => l.unitPrice), lines.map((l) => l.gross), lines.map((l) => l.discount), lines.map((l) => l.share),
      lines.map((l) => l.isTaxable), lines.map((l) => l.taxRate), lines.map((l) => l.taxable), lines.map((l) => l.tax), lines.map((l) => l.total),
    ],
  );
}

export async function updateDraftHeader(db, { businessId, userId, id, contactId, txnDate, dueDate, externalRef, notes, description, totals }) {
  await db.query(
    `UPDATE transactions
        SET contact_id = $3, txn_date = $4, due_date = $5, external_ref = $6, notes = $7, description = $8,
            subtotal = $9, discount_total = $10, taxable_total = $11, non_taxable_total = $12, tax_total = $13, total = $14,
            updated_by = $15
      WHERE business_id = $1 AND id = $2 AND status = 'draft'`,
    [businessId, id, contactId, txnDate, dueDate ?? null, externalRef ?? null, notes ?? null, description,
      totals.subtotal, totals.discount, totals.taxable, totals.nonTaxable, totals.tax, totals.total, userId],
  );
}

export async function deleteDraft(db, businessId, id) {
  const { rowCount } = await db.query("DELETE FROM transactions WHERE business_id = $1 AND id = $2 AND status = 'draft'", [businessId, id]);
  return rowCount > 0;
}

export async function markPosted(db, { businessId, userId, id, referenceNo }) {
  const { rowCount } = await db.query(
    `UPDATE transactions
        SET status = 'posted', reference_no = $3, posted_at = now(), posted_by = $4, updated_by = $4
      WHERE business_id = $1 AND id = $2 AND status = 'draft'`,
    [businessId, id, referenceNo, userId],
  );
  return rowCount > 0;
}

export async function getTaxSettings(db, businessId) {
  const { rows } = await db.query(
    `SELECT b.is_vat_registered, s.default_vat_rate, s.default_credit_days
       FROM businesses b JOIN business_settings s ON s.business_id = b.id WHERE b.id = $1`,
    [businessId],
  );
  return rows[0];
}

export async function listDocuments(db, businessId, type, { contactId, from, to, status, payment, today, q, page, pageSize }) {
  const pattern = q ? `%${escapeLike(q)}%` : null;
  // `payment` narrows POSTED documents by how much has been paid: unpaid, partial, paid, open (not fully paid), overdue.
  const filter = `
    t.business_id = $1 AND t.type = $2
    AND ($3::uuid IS NULL OR t.contact_id = $3)
    AND ($4::date IS NULL OR t.txn_date >= $4) AND ($5::date IS NULL OR t.txn_date <= $5)
    AND ($6::text = 'all' OR t.status = $6)
    AND ($7::text IS NULL OR t.reference_no ILIKE $7 ESCAPE '\\' OR t.external_ref ILIKE $7 ESCAPE '\\'
         OR t.description ILIKE $7 ESCAPE '\\' OR c.name ILIKE $7 ESCAPE '\\')
    AND ($8::text = 'all' OR (t.status = 'posted' AND CASE $8::text
           WHEN 'unpaid'  THEN COALESCE(al.paid, 0) = 0
           WHEN 'partial' THEN COALESCE(al.paid, 0) > 0 AND COALESCE(al.paid, 0) < t.total
           WHEN 'paid'    THEN COALESCE(al.paid, 0) >= t.total
           WHEN 'open'    THEN COALESCE(al.paid, 0) < t.total
           WHEN 'overdue' THEN COALESCE(al.paid, 0) < t.total AND t.due_date IS NOT NULL AND t.due_date < $9::date
         END))`;
  const params = [businessId, type, contactId ?? null, from ?? null, to ?? null, status, pattern, payment, today];
  const [list, count] = await Promise.all([
    db.query(`${HEADER_SELECT} WHERE ${filter} ORDER BY t.txn_date DESC, t.created_at DESC, t.id LIMIT $10 OFFSET $11`, [...params, pageSize, (page - 1) * pageSize]),
    db.query(
      `SELECT count(*)::int AS total FROM transactions t
         JOIN contacts c ON c.business_id = t.business_id AND c.id = t.contact_id
         ${PAID_LATERAL} WHERE ${filter}`,
      params,
    ),
  ]);
  return { rows: list.rows, total: count.rows[0].total };
}

/** The receipts / payments currently applied to a document, newest first. */
export async function findPayments(db, businessId, documentId) {
  const { rows } = await db.query(
    `SELECT a.id, a.amount, p.id AS payment_id, p.type, p.reference_no, p.txn_date, p.payment_method
       FROM payment_allocations a JOIN transactions p ON p.business_id = a.business_id AND p.id = a.payment_txn_id
      WHERE a.business_id = $1 AND a.invoice_txn_id = $2 AND a.status = 'active'
      ORDER BY p.txn_date DESC, p.reference_no DESC`,
    [businessId, documentId],
  );
  return rows;
}
