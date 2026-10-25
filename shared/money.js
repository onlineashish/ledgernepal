// Money rules shared by server and client (plan.md §5.6).
//
// Money is held as an integer number of PAISA in a BigInt (1 rupee = 100 paisa).
// Never use floating point for money. The database stores NUMERIC(14,2); the API sends
// amounts as decimal STRINGS ("1250.50"). Convert with toPaisa() / fromPaisa() at the edges.
//
// Rounding is always "half away from zero" (0.005 -> 0.01), applied once per computed value.

export class MoneyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MoneyError';
  }
}

// One amount (an invoice total, a receipt) is stored as NUMERIC(14,2): at most 12 digits before the decimal point.
// Sums of many (a contact's balance, a report total) are held in NUMERIC(16,2), so they may use 14. toPaisa and
// fromPaisa accept the wider range so a big balance can still be read and shown; the INPUT limit is enforced where
// amounts are entered (see MAX_AMOUNT_PAISA).
const MAX_WHOLE_DIGITS = 14;
const AMOUNT_RE = /^(-)?(\d{1,14})(?:\.(\d{1,2}))?$/;
export const MAX_AMOUNT_PAISA = 99_999_999_999_999n;
export const MAX_AMOUNT_TEXT = '999,999,999,999.99';

/** Is this one amount small enough to be stored (at most 999,999,999,999.99)? */
export const isStorableAmount = (paisa) => paisa <= MAX_AMOUNT_PAISA && paisa >= -MAX_AMOUNT_PAISA;
const QUANTITY_RE = /^(\d{1,11})(?:\.(\d{1,3}))?$/;
const RATE_RE = /^(\d{1,3})(?:\.(\d{1,2}))?$/;

/** Parses "1250", "1250.5" or "1250.50" into paisa. Rejects >2 decimals, commas, exponents, blanks. */
export function toPaisa(input, { allowNegative = false } = {}) {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new MoneyError('Amount must be a number');
    input = String(input);
    if (/e/i.test(input)) throw new MoneyError('Amount is too large or too small');
  }
  if (typeof input !== 'string') throw new MoneyError('Amount must be a string or number');

  const match = AMOUNT_RE.exec(input.trim());
  if (!match && /^-?\d{15,}(\.\d{1,2})?$/.test(input.trim())) throw new MoneyError('Amount is too large');
  if (!match) throw new MoneyError('Enter an amount with at most 2 decimal places, e.g. 1250.50');
  const [, minus, whole, fraction = ''] = match;
  if (minus && !allowNegative) throw new MoneyError('Amount cannot be negative');

  const paisa = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  return minus ? -paisa : paisa;
}

/** Paisa -> exact decimal string with 2 decimals, e.g. 125050n -> "1250.50". */
export function fromPaisa(paisa) {
  assertPaisa(paisa);
  const negative = paisa < 0n;
  const abs = negative ? -paisa : paisa;
  const whole = abs / 100n;
  if (whole.toString().length > MAX_WHOLE_DIGITS) throw new MoneyError('Amount is too large');
  return `${negative ? '-' : ''}${whole}.${(abs % 100n).toString().padStart(2, '0')}`;
}

/** Display format with Nepali/Indian digit grouping: 12345678n -> "रु 1,23,456.78". */
export function formatNPR(paisa, { symbol = true } = {}) {
  assertPaisa(paisa);
  const negative = paisa < 0n;
  const abs = negative ? -paisa : paisa;
  const wholeStr = (abs / 100n).toString();
  const fraction = (abs % 100n).toString().padStart(2, '0');

  // Last three digits, then groups of two: 1234567 -> 12,34,567
  const lastThree = wholeStr.slice(-3);
  const rest = wholeStr.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${lastThree}` : lastThree;

  return `${negative ? '-' : ''}${symbol ? 'रु ' : ''}${grouped}.${fraction}`;
}

export const addPaisa = (...values) => values.reduce((sum, v) => (assertPaisa(v), sum + v), 0n);
export const subPaisa = (a, b) => (assertPaisa(a), assertPaisa(b), a - b);

/** Integer division rounding half away from zero. `divisor` must be a positive even BigInt. */
function roundDiv(numerator, divisor) {
  const half = divisor / 2n;
  return numerator >= 0n ? (numerator + half) / divisor : -((-numerator + half) / divisor);
}

/** unit price (paisa) x quantity (decimal string, up to 3 decimals) -> paisa, rounded once. */
export function multiplyByQuantity(unitPricePaisa, quantity) {
  assertPaisa(unitPricePaisa);
  const match = QUANTITY_RE.exec(String(quantity).trim());
  if (!match) throw new MoneyError('Quantity must be a positive number with at most 3 decimal places');
  const [, whole, fraction = ''] = match;
  const milli = BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0'));
  if (milli === 0n) throw new MoneyError('Quantity must be greater than zero');
  return roundDiv(unitPricePaisa * milli, 1000n);
}

/** rate% of an amount, e.g. percentOf(44998n, "13") -> 5850n. Rate: 0-100 with up to 2 decimals. */
export function percentOf(paisa, rate) {
  assertPaisa(paisa);
  const match = RATE_RE.exec(String(rate).trim());
  if (!match) throw new MoneyError('Rate must be a percentage with at most 2 decimal places');
  const [, whole, fraction = ''] = match;
  const hundredths = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (hundredths > 10000n) throw new MoneyError('Rate cannot exceed 100%');
  return roundDiv(paisa * hundredths, 10000n);
}

/**
 * Splits `total` paisa across `weights` proportionally so the parts add up EXACTLY to total
 * (largest-remainder method; ties go to the earlier item). Used to spread an invoice-level
 * discount over lines. weights: array of non-negative BigInt, at least one > 0.
 */
export function allocateProportionally(total, weights) {
  assertPaisa(total);
  if (total < 0n) throw new MoneyError('Cannot allocate a negative total');
  if (!Array.isArray(weights) || weights.length === 0) throw new MoneyError('Nothing to allocate to');
  weights.forEach((w) => {
    assertPaisa(w);
    if (w < 0n) throw new MoneyError('Weights cannot be negative');
  });
  const weightSum = weights.reduce((a, b) => a + b, 0n);
  if (weightSum === 0n) throw new MoneyError('Weights must not all be zero');

  const shares = weights.map((w) => (total * w) / weightSum);
  const remainders = weights.map((w, i) => ({ i, r: (total * w) % weightSum }));
  let leftover = total - shares.reduce((a, b) => a + b, 0n);
  remainders.sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  for (const { i } of remainders) {
    if (leftover === 0n) break;
    shares[i] += 1n;
    leftover -= 1n;
  }
  return shares;
}

/**
 * One invoice/bill line (plan.md §5.6). All amounts in paisa; quantity/taxRate are strings.
 *   gross   = quantity x unitPrice            (rounded once)
 *   net     = gross - discount                (discount cannot exceed gross)
 *   taxable = net if the line is taxable, else 0
 *   tax     = taxRate% of taxable             (rounded once)
 *   total   = net + tax
 * `taxRate` null/undefined means "not taxable" (a business need not be VAT-registered).
 */
export function calculateLine({ quantity, unitPrice, discount = 0n, taxRate = null }) {
  const gross = multiplyByQuantity(unitPrice, quantity);
  assertPaisa(discount);
  if (discount < 0n) throw new MoneyError('Discount cannot be negative');
  if (discount > gross) throw new MoneyError('Discount cannot be more than the line amount');

  const net = gross - discount;
  const isTaxable = taxRate !== null && taxRate !== undefined;
  const taxable = isTaxable ? net : 0n;
  const tax = isTaxable ? percentOf(taxable, taxRate) : 0n;
  return { gross, discount, net, taxable, nonTaxable: net - taxable, tax, total: net + tax };
}

function assertPaisa(value) {
  if (typeof value !== 'bigint') throw new MoneyError('Money values must be BigInt paisa');
}
