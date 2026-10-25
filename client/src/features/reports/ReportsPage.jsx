import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { DateField } from '../../components/DateField.jsx';
import { Amount } from '../../components/Money.jsx';
import { ExportActions, PrintHeader } from '../../components/PrintTools.jsx';
import { Alert, Card, EmptyState, PageHeader } from '../../components/ui.jsx';
import { useDayFormatter, useDebounced } from '../../lib/hooks.js';

const TABS = [
  { key: 'activity', label: 'Sales, purchases, receipts & payments' },
  { key: 'receivable', label: 'Owed to you (customers)', balances: true },
  { key: 'payable', label: 'You owe (suppliers)', balances: true },
  { key: 'overdue-receivable', label: 'Overdue invoices', balances: true },
  { key: 'overdue-payable', label: 'Overdue bills', balances: true },
];

export function ReportsPage() {
  const auth = useAuth();
  const tabs = TABS.filter((t) => !t.balances || auth.can('ledger.view')); // who owes what is a balance
  const [params, setParams] = useSearchParams();
  const tab = tabs.find((t) => t.key === params.get('tab')) ?? tabs[0];

  return (
    <>
      <PageHeader title="Reports" description="Figures come straight from your posted records. Drafts and voided documents are never counted." />
      <div role="tablist" aria-label="Reports" className="no-print mb-4 flex flex-wrap gap-1 rounded-lg border border-slate-300 bg-white p-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab.key === t.key}
            onClick={() => setParams({ tab: t.key })}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab.key === t.key ? 'bg-brand-600 text-white' : 'text-slate-700 hover:bg-slate-50'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab.key === 'activity' && <ActivityReport />}
      {tab.key === 'receivable' && <OutstandingReport side="receivable" />}
      {tab.key === 'payable' && <OutstandingReport side="payable" />}
      {tab.key === 'overdue-receivable' && <OverdueReport side="receivable" />}
      {tab.key === 'overdue-payable' && <OverdueReport side="payable" />}
    </>
  );
}

function Status({ query }) {
  if (query.isPending) return <p className="text-sm text-slate-600">Loading…</p>;
  if (query.isError) return <Alert>{query.error.message}</Alert>;
  return null;
}

const TH = 'py-2 pr-3 text-right';

function ActivityReport() {
  const day = useDayFormatter();
  const [filters, setFilters] = useState({ from: '', to: '', group: 'month' });
  const query = new URLSearchParams({ group: filters.group });
  if (filters.from) query.set('from', filters.from);
  if (filters.to) query.set('to', filters.to);
  const report = useQuery({
    queryKey: ['reports', 'activity', filters.from, filters.to, filters.group],
    queryFn: ({ signal }) => apiFetch(`/reports/activity?${query}`, { signal }).then((r) => r.data),
    placeholderData: (previous) => previous,
  });
  const d = report.data;
  const range = d ? `${day(d.period.from)} to ${day(d.period.to)}` : '';

  return (
    <Card>
      <PrintHeader title="Sales, purchases, receipts and payments" subtitle={range} />
      <div className="no-print flex flex-wrap items-end justify-between gap-3">
        <div className="grid flex-1 gap-3 sm:grid-cols-3">
          <DateField label="From" value={filters.from} onChange={(from) => setFilters((f) => ({ ...f, from }))} />
          <DateField label="To" value={filters.to} onChange={(to) => setFilters((f) => ({ ...f, to }))} />
          <div>
            <label htmlFor="rep-group" className="mb-1 block text-sm font-medium text-slate-700">Group by</label>
            <select id="rep-group" value={filters.group} onChange={(e) => setFilters((f) => ({ ...f, group: e.target.value }))} className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
              <option value="month">Month</option>
              <option value="day">Day</option>
            </select>
          </div>
        </div>
        <ExportActions csvPath={`/reports/activity?${query}&format=csv`} />
      </div>
      <p className="mt-3 text-sm text-slate-600">{range ? `Showing ${range}.` : ''}{!filters.from && !filters.to && d ? ` This is fiscal year ${d.period.fiscalYear}.` : ''}</p>
      <div className="mt-3">
        <Status query={report} />
        {d && d.rows.length === 0 && <EmptyState title="Nothing recorded in this period" description="Try a wider date range." />}
        {d && d.rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-2 pr-3">{filters.group === 'day' ? 'Day' : 'Month'}</th>
                  <th className={TH}>Sales</th><th className={`${TH} hidden md:table-cell`}>Sales VAT</th>
                  <th className={TH}>Purchases</th><th className={`${TH} hidden md:table-cell`}>Purchase VAT</th>
                  <th className={TH}>Receipts</th><th className="py-2 text-right">Payments</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {d.rows.map((r) => (
                  <tr key={r.period}>
                    <td className="whitespace-nowrap py-2 pr-3">{filters.group === 'day' ? day(r.period) : r.period}</td>
                    <td className="py-2 pr-3 text-right"><Amount value={r.sales} /></td>
                    <td className="hidden py-2 pr-3 text-right md:table-cell"><Amount value={r.salesVat} /></td>
                    <td className="py-2 pr-3 text-right"><Amount value={r.purchases} /></td>
                    <td className="hidden py-2 pr-3 text-right md:table-cell"><Amount value={r.purchasesVat} /></td>
                    <td className="py-2 pr-3 text-right"><Amount value={r.receipts} /></td>
                    <td className="py-2 text-right"><Amount value={r.payments} /></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-300 font-semibold">
                  <td className="py-2 pr-3">Total</td>
                  <td className="py-2 pr-3 text-right"><Amount value={d.totals.sales} /></td>
                  <td className="hidden py-2 pr-3 text-right md:table-cell"><Amount value={d.totals.salesVat} /></td>
                  <td className="py-2 pr-3 text-right"><Amount value={d.totals.purchases} /></td>
                  <td className="hidden py-2 pr-3 text-right md:table-cell"><Amount value={d.totals.purchasesVat} /></td>
                  <td className="py-2 pr-3 text-right"><Amount value={d.totals.receipts} /></td>
                  <td className="py-2 text-right"><Amount value={d.totals.payments} /></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </Card>
  );
}

const SIDE = {
  receivable: { who: 'Customer', title: 'Owed to you', empty: 'Nobody owes you anything right now.', hint: 'What each customer currently owes, after their receipts.' },
  payable: { who: 'Supplier', title: 'You owe', empty: 'You do not owe anyone anything right now.', hint: 'What you currently owe each supplier, after your payments. A customer who paid in advance also appears here.' },
};

function OutstandingReport({ side }) {
  const s = SIDE[side];
  const [q, setQ] = useState('');
  const search = useDebounced(q.trim(), 300);
  const query = new URLSearchParams({ side });
  if (search) query.set('q', search);
  const report = useQuery({
    queryKey: ['reports', 'outstanding', side, search],
    queryFn: ({ signal }) => apiFetch(`/reports/outstanding?${query}`, { signal }).then((r) => r.data),
    placeholderData: (previous) => previous,
  });
  const d = report.data;

  return (
    <Card>
      <PrintHeader title={s.title} subtitle={s.hint} />
      <div className="no-print flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-48 flex-1">
          <label htmlFor="rep-search" className="mb-1 block text-sm font-medium text-slate-700">Search</label>
          <input id="rep-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or phone" className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-2 focus:outline-brand-600" />
        </div>
        <ExportActions csvPath={`/reports/outstanding?${query}&format=csv`} />
      </div>
      <p className="no-print mt-3 text-sm text-slate-600">{s.hint} Open a name to see the full account.</p>
      <div className="mt-3">
        <Status query={report} />
        {d && d.rows.length === 0 && <EmptyState title={search ? 'Nothing matches' : s.empty} />}
        {d && d.rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr><th className="py-2 pr-3">{s.who}</th><th className="hidden py-2 pr-3 md:table-cell">Phone</th><th className={TH}>Balance</th><th className="py-2 text-right">Of which overdue</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {d.rows.map((r) => (
                  <tr key={r.contact.id}>
                    <td className="py-2 pr-3"><Link to={`/contacts/${r.contact.id}`} className="font-medium text-brand-700 hover:underline">{r.contact.name}</Link></td>
                    <td className="hidden py-2 pr-3 md:table-cell">{r.contact.phone ?? '–'}</td>
                    <td className="py-2 pr-3 text-right"><Amount value={r.balance} /></td>
                    <td className={`py-2 text-right ${Number(r.overdue) > 0 ? 'text-red-700' : 'text-slate-400'}`}>{Number(r.overdue) > 0 ? <Amount value={r.overdue} /> : '–'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-300 font-semibold">
                  <td className="py-2 pr-3">Total</td><td className="hidden md:table-cell" />
                  <td className="py-2 pr-3 text-right"><Amount value={d.total} /></td>
                  <td className="py-2 text-right"><Amount value={d.totalOverdue} /></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </Card>
  );
}

function OverdueReport({ side }) {
  const day = useDayFormatter();
  const paths = { receivable: '/sales', payable: '/purchases' };
  const who = side === 'receivable' ? 'Customer' : 'Supplier';
  const title = side === 'receivable' ? 'Overdue sales invoices' : 'Overdue purchase bills';
  const report = useQuery({
    queryKey: ['reports', 'overdue', side],
    queryFn: ({ signal }) => apiFetch(`/reports/overdue?side=${side}`, { signal }).then((r) => r.data),
  });
  const d = report.data;

  return (
    <Card>
      <PrintHeader title={title} subtitle={d ? `As of ${day(d.asOf)}` : ''} />
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">{side === 'receivable' ? 'Invoices past their due date that are not fully paid.' : 'Bills past their due date that you have not fully paid.'}</p>
        <ExportActions csvPath={`/reports/overdue?side=${side}&format=csv`} />
      </div>
      <div className="mt-3">
        <Status query={report} />
        {d && d.rows.length === 0 && <EmptyState title="Nothing is overdue" description="Documents appear here once their due date has passed and money is still owing." />}
        {d && d.rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr><th className="py-2 pr-3">Number</th><th className="py-2 pr-3">{who}</th><th className="py-2 pr-3">Due</th><th className={TH}>Days late</th><th className={`${TH} hidden md:table-cell`}>Total</th><th className="py-2 text-right">Outstanding</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {d.rows.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap py-2 pr-3"><Link to={`${paths[side]}/${r.id}`} className="font-medium text-brand-700 hover:underline">{r.referenceNo}</Link></td>
                    <td className="py-2 pr-3"><Link to={`/contacts/${r.contact.id}`} className="hover:underline">{r.contact.name}</Link>{r.contact.phone && <span className="block text-xs text-slate-500">{r.contact.phone}</span>}</td>
                    <td className="whitespace-nowrap py-2 pr-3">{day(r.dueDate)}</td>
                    <td className="py-2 pr-3 text-right text-red-700">{r.daysOverdue}</td>
                    <td className="hidden py-2 pr-3 text-right md:table-cell"><Amount value={r.total} /></td>
                    <td className="py-2 text-right font-medium"><Amount value={r.outstanding} /></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-300 font-semibold">
                  <td className="py-2 pr-3" colSpan={5}>Total overdue</td>
                  <td className="py-2 text-right"><Amount value={d.total} /></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </Card>
  );
}
