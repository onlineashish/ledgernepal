// Spreading a receipt or payment over the invoices or bills it settles.
// Used by the server (authority) and by the screens (preview of "apply oldest first").
// Amounts are paisa BigInts. Matching never changes a balance; it only says WHICH documents are paid.

/**
 * Oldest first: the earliest document date is settled first, then the lower number. Each document takes at
 * most what is still outstanding on it. Whatever is left over stays an unallocated advance.
 *
 * @param {bigint} available   what can still be applied (payment amount minus what is already allocated)
 * @param {{ id: string, txnDate: string, referenceNo?: string|null, outstanding: bigint }[]} documents
 * @returns {{ allocations: { id: string, amount: bigint }[], remainder: bigint }}
 */
export function planOldestFirst(available, documents) {
  if (typeof available !== 'bigint' || available < 0n) throw new TypeError('available must be non-negative paisa');
  const order = [...documents].sort(
    (a, b) =>
      (a.txnDate < b.txnDate ? -1 : a.txnDate > b.txnDate ? 1 : 0) ||
      String(a.referenceNo ?? '').localeCompare(String(b.referenceNo ?? '')) ||
      a.id.localeCompare(b.id),
  );
  const allocations = [];
  let left = available;
  for (const doc of order) {
    if (left <= 0n) break;
    if (doc.outstanding <= 0n) continue;
    const amount = left < doc.outstanding ? left : doc.outstanding;
    allocations.push({ id: doc.id, amount });
    left -= amount;
  }
  return { allocations, remainder: left };
}

/** 'unpaid' | 'partially_paid' | 'paid' from the document total and what has been allocated to it. */
export function paymentStatus(total, paid) {
  if (paid <= 0n) return 'unpaid';
  return paid >= total ? 'paid' : 'partially_paid';
}

/** Is a document overdue? It needs a due date in the past AND something still outstanding. Dates are "YYYY-MM-DD". */
export function isOverdue({ dueDate, outstanding, today }) {
  return Boolean(dueDate) && outstanding > 0n && dueDate < today;
}
