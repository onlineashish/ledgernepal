import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { DateField } from '../../components/DateField.jsx';
import { Amount } from '../../components/Money.jsx';
import { Pagination } from '../../components/Pagination.jsx';
import { Alert, Badge, Button, Card, EmptyState, PageHeader } from '../../components/ui.jsx';
import { useDayFormatter, useDebounced } from '../../lib/hooks.js';

const PAGE_SIZE = 25;

/** "View Ledger": every direct entry and opening balance across all contacts, newest first. */
export function LedgerPage() {
  const auth = useAuth();
  const day = useDayFormatter();
  const [filters, setFilters] = useState({ from: '', to: '', q: '', status: 'posted' });
  const [page, setPage] = useState(1);
  const q = useDebounced(filters.q.trim(), 300);
  const change = (patch) => { setFilters((f) => ({ ...f, ...patch })); setPage(1); };

  const query = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), status: filters.status });
  if (filters.from) query.set('from', filters.from);
  if (filters.to) query.set('to', filters.to);
  if (q) query.set('q', q);

  const entries = useQuery({
    queryKey: ['ledger', 'entries', filters.from, filters.to, q, filters.status, page],
    queryFn: ({ signal }) => apiFetch(`/ledger/entries?${query}`, { signal }),
    placeholderData: (previous) => previous,
  });
  const filtered = Boolean(filters.from || filters.to || q || filters.status !== 'posted');

  return (
    <>
      <PageHeader
        title="Ledger"
        description="Direct entries and opening balances for all contacts. Open a contact to see its full account with running balance."
        actions={auth.can('ledger.create') && <Button to="/ledger/new">Add ledger entry</Button>}
      />
      <Card>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <DateField label="From" value={filters.from} onChange={(from) => change({ from })} />
          <DateField label="To" value={filters.to} onChange={(to) => change({ to })} />
          <div>
            <label htmlFor="entries-status" className="mb-1 block text-sm font-medium text-slate-700">Show</label>
            <select id="entries-status" value={filters.status} onChange={(e) => change({ status: e.target.value })} className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
              <option value="posted">Active entries</option>
              <option value="voided">Voided entries</option>
              <option value="all">All</option>
            </select>
          </div>
          <div>
            <label htmlFor="entries-search" className="mb-1 block text-sm font-medium text-slate-700">Search</label>
            <input id="entries-search" type="search" value={filters.q} onChange={(e) => change({ q: e.target.value })} placeholder="Contact, description, reference" className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-2 focus:outline-brand-600" />
          </div>
        </div>

        <div className="mt-4">
          {entries.isPending && <p className="text-sm text-slate-600">Loading entries…</p>}
          {entries.isError && <Alert>{entries.error.message}</Alert>}
          {entries.data?.data.length === 0 && (
            <EmptyState
              title={filtered ? 'No entries match' : 'No ledger entries yet'}
              description={filtered ? 'Try a different date range, status or search.' : 'Record money given or received without creating an invoice.'}
              action={!filtered && auth.can('ledger.create') && <Button to="/ledger/new">Add the first entry</Button>}
            />
          )}
          {entries.data?.data.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase text-slate-500">
                  <tr>
                    <th className="py-2 pr-3">Date</th>
                    <th className="py-2 pr-3">Reference</th>
                    <th className="py-2 pr-3">Contact</th>
                    <th className="py-2 pr-3">What happened</th>
                    <th className="py-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {entries.data.data.map((e) => (
                    <tr key={e.id} className={e.status === 'voided' ? 'text-slate-400 line-through' : ''}>
                      <td className="whitespace-nowrap py-2 pr-3">{day(e.txnDate)}</td>
                      <td className="whitespace-nowrap py-2 pr-3">{e.referenceNo}</td>
                      <td className="py-2 pr-3"><Link to={`/contacts/${e.contact.id}`} className="font-medium text-brand-700 hover:underline">{e.contact.name}</Link></td>
                      <td className="py-2 pr-3 no-underline">
                        {e.type === 'opening_balance' ? <Badge tone="blue">Opening balance</Badge> : e.direction === 'you_gave' ? 'You gave' : 'You got'}
                        {e.status === 'voided' && <span className="ml-2"><Badge tone="red">Voided</Badge></span>}
                        {e.description && <span className="block text-xs text-slate-500">{e.description}</span>}
                      </td>
                      <td className="py-2 text-right"><Amount value={e.amount} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {entries.data && <Pagination page={entries.data.meta.page} pageSize={entries.data.meta.pageSize} total={entries.data.meta.total} onPage={setPage} />}
        </div>
      </Card>
    </>
  );
}
