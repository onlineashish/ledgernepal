import { formatAmount } from '../lib/format.js';

/** An exact rupee amount from the API ("1250.50") in Nepali grouping. Renders a dash for no value. */
export function Amount({ value, className = '' }) {
  if (value === null || value === undefined) return <span className={className}>–</span>;
  return <span className={`tabular-nums ${className}`}>{formatAmount(value)}</span>;
}

const SIDE_STYLES = {
  receivable: 'text-emerald-700',
  payable: 'text-red-700',
  settled: 'text-slate-500',
};

/**
 * A contact's balance in plain words, never a bare minus sign:
 *   receivable "Owes you रु 5,000.00"   payable "You owe रु 300.00"   settled "Settled"
 * `balance` is { amount, side } from the API, or null when the person may not see balances.
 */
export function BalanceText({ balance, name }) {
  if (!balance) return <span className="text-slate-400">–</span>;
  const abs = balance.amount.replace('-', '');
  let text;
  if (balance.side === 'receivable') text = name ? `${name} owes you ${formatAmount(abs)}` : `Owes you ${formatAmount(abs)}`;
  else if (balance.side === 'payable') text = name ? `You owe ${name} ${formatAmount(abs)}` : `You owe ${formatAmount(abs)}`;
  else text = 'Settled';
  return <span className={`tabular-nums font-medium ${SIDE_STYLES[balance.side]}`}>{text}</span>;
}
