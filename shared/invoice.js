// How a sales invoice or purchase bill is added up. Used by the server (which is the authority and
// stores the result) and by the screens (which only preview it). All amounts are paisa BigInts.
//
// For each line:                           For the whole document:
//   gross      = quantity x unit price        subtotal      = sum of gross
//   afterLine  = gross - line discount        discount      = line discounts + invoice discount
//   share      = its part of the invoice      taxable total = sum of taxable amounts
//                discount, in proportion       non-taxable   = sum of net amounts that carry no VAT
//                to afterLine                  tax           = sum of the lines' VAT
//   net        = afterLine - share            total         = taxable + non-taxable + tax
//   taxable    = net if the line has a VAT rate, else 0
//   tax        = taxable x rate               (so also: total = subtotal - discount + tax)
//   line total = net + tax
//
// The invoice discount is spread BEFORE VAT, so VAT is charged on the reduced price. Shares add up to
// the invoice discount exactly (largest-remainder rounding). VAT is rounded per line, then added.
// A line is taxable only when it has a rate (`taxRate` not null); a rate of "0" is "taxable at 0%",
// which is different from "not taxable". No rate is ever assumed here: the caller supplies it.
import { MoneyError, allocateProportionally, multiplyByQuantity, percentOf } from './money.js';

export const MAX_LINES = 200;

const fail = (message, field = 'lines') => {
  const error = new MoneyError(message);
  error.field = field; // lets the API point the message at the right input
  return error;
};

/**
 * @param {{ quantity: string, unitPrice: bigint, discount?: bigint, taxRate?: string|null }[]} lines
 * @param {bigint} invoiceDiscount
 */
export function calculateDocument({ lines, invoiceDiscount = 0n }) {
  if (!Array.isArray(lines) || lines.length === 0) throw fail('Add at least one line');
  if (lines.length > MAX_LINES) throw fail(`A document can have at most ${MAX_LINES} lines`);

  const prepared = lines.map((line, i) => {
    const gross = multiplyByQuantity(line.unitPrice, line.quantity);
    const discount = line.discount ?? 0n;
    if (discount < 0n) throw fail(`Line ${i + 1}: discount cannot be negative`);
    if (discount > gross) throw fail(`Line ${i + 1}: discount cannot be more than the line amount`);
    return { gross, discount, afterLine: gross - discount, taxRate: line.taxRate ?? null };
  });

  const afterLineTotal = prepared.reduce((sum, p) => sum + p.afterLine, 0n);
  if (invoiceDiscount < 0n) throw fail('Invoice discount cannot be negative', 'invoiceDiscount');
  if (invoiceDiscount > afterLineTotal) {
    throw fail('Invoice discount cannot be more than the total after line discounts', 'invoiceDiscount');
  }
  const shares =
    invoiceDiscount === 0n ? prepared.map(() => 0n) : allocateProportionally(invoiceDiscount, prepared.map((p) => p.afterLine));

  const results = prepared.map((p, i) => {
    const net = p.afterLine - shares[i];
    const isTaxable = p.taxRate !== null;
    const taxable = isTaxable ? net : 0n;
    const tax = isTaxable ? percentOf(taxable, p.taxRate) : 0n;
    return {
      gross: p.gross,
      discount: p.discount,
      invoiceDiscountShare: shares[i],
      net,
      taxRate: p.taxRate,
      taxable,
      nonTaxable: net - taxable,
      tax,
      total: net + tax,
    };
  });

  const sum = (pick) => results.reduce((acc, r) => acc + pick(r), 0n);
  const totals = {
    subtotal: sum((r) => r.gross),
    discount: sum((r) => r.discount + r.invoiceDiscountShare),
    taxable: sum((r) => r.taxable),
    nonTaxable: sum((r) => r.nonTaxable),
    tax: sum((r) => r.tax),
    total: sum((r) => r.total),
  };
  return { lines: results, totals };
}
