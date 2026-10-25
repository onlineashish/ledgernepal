import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../api/client.js';
import { QUICK_ACTIONS, visibleTo } from '../../app/navigation.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { DateField } from '../../components/DateField.jsx';
import { Amount } from '../../components/Money.jsx';
import { Alert, Badge, Button, Card, PageHeader } from '../../components/ui.jsx';
import { useDayFormatter } from '../../lib/hooks.js';
import { t } from '../../i18n/en.js';

// Where each kind of transaction opens, and how it is labelled.
const PATHS = { sale: '/sales', purchase: '/purchases', receipt: '/receipts-payments/receipts', payment: '/receipts-payments/payments' };
const LABELS = { sale: ['Sales invoice', 'green'], purchase: ['Purchase bill', 'amber'], receipt: ['Receipt', 'blue'], payment: ['Payment', 'blue'], ledger_entry: ['Ledger entry', 'neutral'], opening_balance: ['Opening balance', 'blue'] };

function ApiStatus() {
  const { data, error, isPending } = useQuery({
    queryKey: ['health', 'ready'],
    queryFn: ({ signal }) => apiFetch('/health/ready', { signal }),
    retry: false,
  });

  if (isPending) return <p className="text-sm text-slate-600">Checking server…</p>;
  if (error) {
    return (
      <p role="alert" className="text-sm font-medium text-red-700">
        Server problem: {error.message}
      </p>
    );
  }
  return (
    <p className="text-sm font-medium text-emerald-700">
      Server and database are connected ({data.data.database}).
    </p>
  );
}

function Stat({ label, value, note, to, tone = 'text-slate-900' }) {
  const body = (
    <>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${tone}`}><Amount value={value} /></p>
      {note && <p className="mt-1 text-xs text-slate-600">{note}</p>}
    </>
  );
  const box = 'block rounded-xl border border-slate-200 bg-white p-4';
  return to ? <Link to={to} className={`${box} hover:border-brand-600`}>{body}</Link> : <div className={box}>{body}</div>;
}

const count = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function DashboardPage() {
  const auth = useAuth();
  const day = useDayFormatter();
  const actions = visibleTo(auth, QUICK_ACTIONS);
  const [period, setPeriod] = useState({ from: '', to: '' });
  const canReport = auth.can('reports.view');

  const query = new URLSearchParams();
  if (period.from) query.set('from', period.from);
  if (period.to) query.set('to', period.to);
  const dashboard = useQuery({
    queryKey: ['reports', 'dashboard', period.from, period.to],
    queryFn: ({ signal }) => apiFetch(`/reports/dashboard?${query}`, { signal }).then((r) => r.data),
    enabled: canReport,
    placeholderData: (previous) => previous,
  });
  const d = dashboard.data;

  return (
    <>
      <PageHeader title={t('nav.dashboard')} description={d ? `Showing ${day(d.period.from)} to ${day(d.period.to)}${period.from || period.to ? '' : ` (fiscal year ${d.period.fiscalYear})`}.` : 'Your business at a glance.'} />

      {canReport && (
        <Card className="mb-6">
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <DateField label="From" value={period.from} onChange={(from) => setPeriod((p) => ({ ...p, from }))} />
            <DateField label="To" value={period.to} onChange={(to) => setPeriod((p) => ({ ...p, to }))} />
            {(period.from || period.to) && <Button variant="secondary" onClick={() => setPeriod({ from: '', to: '' })}>This fiscal year</Button>}
          </div>
        </Card>
      )}

      {canReport && dashboard.isPending && <p className="mb-6 text-sm text-slate-600">Loading figures…</p>}
      {canReport && dashboard.isError && <Alert className="mb-6">{dashboard.error.message}</Alert>}
      {d && (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Totals for the period">
            <Stat label="Sales" value={d.sales.total} note={count(d.sales.count, 'invoice')} to="/sales" />
            <Stat label="Purchases" value={d.purchases.total} note={count(d.purchases.count, 'bill')} to="/purchases" />
            <Stat label="Receipts" value={d.receipts.total} note={count(d.receipts.count, 'receipt')} to="/receipts-payments" />
            <Stat label="Payments" value={d.payments.total} note={count(d.payments.count, 'payment')} to="/receipts-payments" />
          </div>
          {d.receivables && d.payables && (
            <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Balances today">
              <Stat label="Owed to you" value={d.receivables.outstanding} note={`${count(d.receivables.contacts, 'customer')} owe you`} tone="text-emerald-700" to="/reports?tab=receivable" />
              <Stat label="Overdue to you" value={d.receivables.overdue} note={count(d.receivables.overdueCount, 'overdue invoice')} tone="text-red-700" to="/reports?tab=overdue-receivable" />
              <Stat label="You owe" value={d.payables.outstanding} note={`to ${count(d.payables.contacts, 'supplier')}`} tone="text-amber-700" to="/reports?tab=payable" />
              <Stat label="Overdue you owe" value={d.payables.overdue} note={count(d.payables.overdueCount, 'overdue bill')} tone="text-red-700" to="/reports?tab=overdue-payable" />
            </div>
          )}
        </>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Quick actions">
          {actions.length === 0 && <p className="text-sm text-slate-600">Nothing to record with your current access.</p>}
          <div className="grid gap-2 sm:grid-cols-2">
            {actions.map((action) => (
              <Button key={action.key} to={action.to} variant={action.key === 'ledger' ? 'primary' : 'secondary'}>
                {action.label}
              </Button>
            ))}
          </div>
        </Card>
        <Card title="System status">
          <ApiStatus />
        </Card>
      </div>

      {d && (
        <Card title="Recent transactions" className="mt-6">
          {d.recent.length === 0 ? (
            <p className="text-sm text-slate-600">Nothing recorded yet. Use a quick action above to start.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase text-slate-500">
                  <tr><th className="py-2 pr-3">Date</th><th className="py-2 pr-3">Number</th><th className="py-2 pr-3">Contact</th><th className="py-2 pr-3">Type</th><th className="py-2 text-right">Amount</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {d.recent.map((r) => (
                    <tr key={r.id}>
                      <td className="whitespace-nowrap py-2 pr-3">{day(r.txnDate)}</td>
                      <td className="whitespace-nowrap py-2 pr-3">{PATHS[r.type] ? <Link to={`${PATHS[r.type]}/${r.id}`} className="font-medium text-brand-700 hover:underline">{r.referenceNo}</Link> : r.referenceNo}</td>
                      <td className="py-2 pr-3"><Link to={`/contacts/${r.contact.id}`} className="hover:underline">{r.contact.name}</Link></td>
                      <td className="py-2 pr-3"><Badge tone={LABELS[r.type]?.[1] ?? 'neutral'}>{LABELS[r.type]?.[0] ?? r.type}</Badge></td>
                      <td className="py-2 text-right"><Amount value={r.amount} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </>
  );
}
