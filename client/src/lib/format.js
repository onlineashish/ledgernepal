import { formatDate } from '@ledgernepal/shared/dates';
import { formatNPR, toPaisa } from '@ledgernepal/shared/money';

/** "1250.5" -> "रु 1,250.50" (Nepali digit grouping). Negative amounts keep their minus sign. */
export function formatAmount(amount, { symbol = true } = {}) {
  return formatNPR(toPaisa(amount, { allowNegative: true }), { symbol });
}

/** An API date ("2025-08-01", or a timestamp) shown in the business's chosen calendar. */
export function formatDay(iso, calendar = 'AD') {
  if (!iso) return '';
  try {
    return formatDate(String(iso).slice(0, 10), calendar);
  } catch {
    return String(iso).slice(0, 10); // outside the BS tables: show the AD date rather than nothing
  }
}

/** An exact amount typed by a person -> paisa BigInt, or null if it is not a valid positive amount. */
export function parseAmountOrNull(text) {
  try {
    const paisa = toPaisa(String(text).trim());
    return paisa > 0n ? paisa : null;
  } catch {
    return null;
  }
}
