import { fiscalYearOf } from '@ledgernepal/shared/dates';

// Which business setting holds the prefix for each kind of document.
const PREFIX_COLUMN = {
  ledger_entry: 'ledger_prefix',
  opening_balance: 'opening_prefix',
  sale: 'sale_prefix',
  purchase: 'purchase_prefix',
  receipt: 'receipt_prefix',
  payment: 'payment_prefix',
};

/**
 * Hands out the next reference number, e.g. "LE-2082/83-0001": the business's prefix, the fiscal year
 * containing the transaction date, and a counter that restarts each fiscal year.
 *
 * The counter row is locked until the caller's transaction ends, so two people saving at the same
 * moment get different numbers, and a number is never burned by a failed save (the increment rolls back
 * with it). Always call this inside the same transaction that inserts the transaction.
 */
export async function nextReference(db, businessId, kind, txnDate) {
  const prefixColumn = PREFIX_COLUMN[kind]; // from a fixed map above, never from user input
  if (!prefixColumn) throw new Error(`Unknown document kind "${kind}"`);
  const fiscalYear = fiscalYearOf(txnDate).label;

  const { rows } = await db.query(
    `INSERT INTO document_sequences (business_id, doc_kind, fiscal_year, next_value)
     VALUES ($1, $2, $3, 2)
     ON CONFLICT (business_id, doc_kind, fiscal_year)
       DO UPDATE SET next_value = document_sequences.next_value + 1
     RETURNING next_value - 1 AS n,
               (SELECT ${prefixColumn} FROM business_settings WHERE business_id = $1) AS prefix`,
    [businessId, kind, fiscalYear],
  );
  const { n, prefix } = rows[0];
  return `${prefix}-${fiscalYear}-${String(n).padStart(4, '0')}`;
}
