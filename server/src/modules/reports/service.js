import { BS_MONTHS, adToBs, fiscalYearOf, todayInNepal } from '@ledgernepal/shared/dates';
import { fromPaisa, toPaisa } from '@ledgernepal/shared/money';
import * as repo from './repo.js';

const canSeeBalances = (req) => req.business.permissions.has('ledger.view');
const escapeLike = (text) => text.replace(/[\\%_]/g, '\\$&');
const pad = (n) => String(n).padStart(2, '0');
const sum = (values) => fromPaisa(values.reduce((total, v) => total + toPaisa(v), 0n));

/** The period asked for, or the current fiscal year (Shrawan 1 to the end of Ashadh) by default. */
export function resolvePeriod({ from, to }, today = todayInNepal()) {
  const fy = fiscalYearOf(today);
  return { from: from ?? fy.start, to: to ?? fy.end, fiscalYear: fy.label };
}

const typeTotals = (rows, type) => {
  const row = rows.find((r) => r.type === type);
  return { total: row?.total ?? '0.00', tax: row?.tax ?? '0.00', count: row?.count ?? 0 };
};

export async function dashboard({ pool, req }, query) {
  const businessId = req.business.id;
  const today = todayInNepal();
  const period = resolvePeriod(query, today);
  const [totals, recent] = await Promise.all([
    repo.totalsByType(pool, businessId, period.from, period.to),
    repo.recentTransactions(pool, businessId, 10),
  ]);
  const result = {
    period,
    sales: typeTotals(totals, 'sale'),
    purchases: typeTotals(totals, 'purchase'),
    receipts: typeTotals(totals, 'receipt'),
    payments: typeTotals(totals, 'payment'),
    // What people owe and are owed is a balance, so it follows the ledger permission, like the contact balances do.
    receivables: null,
    payables: null,
    recent: recent.map((r) => ({
      id: r.id, type: r.type, effect: r.effect, txnDate: r.txn_date, referenceNo: r.reference_no, description: r.description,
      amount: r.total, contact: { id: r.contact_id, name: r.contact_name },
    })),
  };
  if (canSeeBalances(req)) {
    const [balances, overdueSales, overduePurchases] = await Promise.all([
      repo.receivablesAndPayables(pool, businessId),
      repo.overdueTotal(pool, businessId, 'sale', today),
      repo.overdueTotal(pool, businessId, 'purchase', today),
    ]);
    result.receivables = { outstanding: balances.receivable, contacts: balances.receivable_contacts, overdue: overdueSales.amount, overdueCount: overdueSales.count };
    result.payables = { outstanding: balances.payable, contacts: balances.payable_contacts, overdue: overduePurchases.amount, overdueCount: overduePurchases.count };
  }
  return { data: result };
}

// ---------------------------------------------------------------- daily / monthly activity

/** The bucket a date falls in: the day itself, or its month in the calendar this business uses. */
function bucketOf(iso, group, calendar) {
  if (group === 'day') return { key: iso, label: iso };
  if (calendar === 'AD') return { key: iso.slice(0, 7), label: iso.slice(0, 7) };
  const { year, month } = adToBs(iso);
  return { key: `${year}-${pad(month)}`, label: `${BS_MONTHS[month - 1]} ${year}` };
}

export async function activity({ pool, req }, query) {
  const period = resolvePeriod(query);
  const days = await repo.dailyByType(pool, req.business.id, period.from, period.to);
  const buckets = new Map();
  for (const day of days) {
    const { key, label } = bucketOf(day.txn_date, query.group, req.business.dateDisplay);
    if (!buckets.has(key)) buckets.set(key, { key, label, sale: [], purchase: [], receipt: [], payment: [], saleTax: [], purchaseTax: [], saleCount: 0, purchaseCount: 0 });
    const bucket = buckets.get(key);
    bucket[day.type].push(day.total);
    if (day.type === 'sale' || day.type === 'purchase') {
      bucket[`${day.type}Tax`].push(day.tax);
      bucket[`${day.type}Count`] += day.count;
    }
  }
  const rows = [...buckets.values()]
    .sort((a, b) => (a.key < b.key ? -1 : 1))
    .map((b) => ({
      period: b.label, sales: sum(b.sale), salesCount: b.saleCount, salesVat: sum(b.saleTax),
      purchases: sum(b.purchase), purchasesCount: b.purchaseCount, purchasesVat: sum(b.purchaseTax),
      receipts: sum(b.receipt), payments: sum(b.payment),
    }));
  const column = (name) => sum(rows.map((r) => r[name]));
  return {
    data: {
      period, group: query.group, rows,
      totals: { sales: column('sales'), purchases: column('purchases'), receipts: column('receipts'), payments: column('payments'), salesVat: column('salesVat'), purchasesVat: column('purchasesVat') },
    },
  };
}

// ---------------------------------------------------------------- outstanding / overdue (balances: need ledger.view)

export async function outstanding({ pool, req }, { side, q }) {
  const rows = await repo.outstandingByContact(pool, req.business.id, side, todayInNepal(), q ? `%${escapeLike(q)}%` : null);
  return {
    data: {
      side,
      rows: rows.map((r) => ({ contact: { id: r.contact_id, name: r.name, phone: r.phone }, balance: r.balance, overdue: r.overdue })),
      total: sum(rows.map((r) => r.balance)),
      totalOverdue: sum(rows.map((r) => r.overdue)),
    },
  };
}

export async function overdue({ pool, req }, { side }) {
  const today = todayInNepal();
  const rows = await repo.overdueDocuments(pool, req.business.id, side === 'receivable' ? 'sale' : 'purchase', today);
  return {
    data: {
      side, asOf: today,
      rows: rows.map((r) => ({
        id: r.id, referenceNo: r.reference_no, txnDate: r.txn_date, dueDate: r.due_date, daysOverdue: r.days_overdue,
        total: r.total, paid: r.paid, outstanding: r.outstanding, contact: { id: r.contact_id, name: r.contact_name, phone: r.contact_phone },
      })),
      total: sum(rows.map((r) => r.outstanding)),
    },
  };
}
