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
import { METHODS, METHOD_LABELS, SETTLEMENTS } from './kinds.js';

const PAGE_SIZE = 25;
const SELECT = 'block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm';

/** Receipts and payments, one tab each (only the ones this person may see). */
export function SettlementsPage() {
  const auth = useAuth();
  const kinds = Object.values(SETTLEMENTS).filter((k) => auth.can(k.perms.view));
  const [kind, setKind] = useState(kinds[0]?.type ?? 'receipt');
  const k = SETTLEMENTS[kind];
  const day = useDayFormatter();
  const [filters, setFilters] = useState({ from: '', to: '', q: '', method: 'all', status: 'posted', allocation: 'all' });
  const [page, setPage] = useState(1);
  const q = useDebounced(filters.q.trim(), 300);
  const change = (patch) => { setFilters((f) => ({ ...f, ...patch })); setPage(1); };

  const query = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), status: filters.status, allocation: filters.allocation });
  if (filters.method !== 'all') query.set('method', filters.method);
  if (filters.from) query.set('from', filters.from);
  if (filters.to) query.set('to', filters.to);
  if (q) query.set('q', q);

  const list = useQuery({
    queryKey: [kind, 'list', filters.from, filters.to, q, filters.method, filters.status, filters.allocation, page],
    queryFn: ({ signal }) => apiFetch(`${k.api}?${query}`, { signal }),
    placeholderData: (previous) => previous,
  });
  const filtered = Boolean(filters.from || filters.to || q || filters.method !== 'all' || filters.status !== 'posted' || filters.allocation !== 'all');

  return (
    <>
      <PageHeader
        title="Receipts & payments"
        description={k.intro}
        actions={auth.can(k.perms.create) && <Button to={k.newPath}>{k.newLabel}</Button>}
      />
      {kinds.length > 1 && (
        <div role="tablist" aria-label="Receipts or payments" className="mb-4 inline-flex rounded-lg border border-slate-300 bg-white p-1">
          {kinds.map((x) => (
            <button
              key={x.type}
              type="button"
              role="tab"
              aria-selected={kind === x.type}
              onClick={() => { setKind(x.type); setPage(1); }}
              className={`rounded-md px-4 py-1.5 text-sm font-medium ${kind === x.type ? 'bg-brand-600 text-white' : 'text-slate-700 hover:bg-slate-50'}`}
            >
              {x.plural}
            </button>
          ))}
        </div>
      )}
      <Card>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <DateField label="From" value={filters.from} onChange={(from) => change({ from })} />
          <DateField label="To" value={filters.to} onChange={(to) => change({ to })} />
          <div>
            <label htmlFor="st-method" className="mb-1 block text-sm font-medium text-slate-700">Method</label>
            <select id="st-method" value={filters.method} onChange={(e) => change({ method: e.target.value })} className={SELECT}>
              <option value="all">All methods</option>
              {METHODS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="st-status" className="mb-1 block text-sm font-medium text-slate-700">Show</label>
            <select id="st-status" value={filters.status} onChange={(e) => change({ status: e.target.value })} className={SELECT}>
              <option value="posted">Active</option>
              <option value="voided">Voided</option>
              <option value="all">All</option>
            </select>
          </div>
          <div>
            <label htmlFor="st-alloc" className="mb-1 block text-sm font-medium text-slate-700">Applied to documents</label>
            <select id="st-alloc" value={filters.allocation} onChange={(e) => change({ allocation: e.target.value })} className={SELECT}>
              <option value="all">All</option>
              <option value="unallocated">Advances (not fully applied)</option>
            </select>
          </div>
          <div>
            <label htmlFor="st-search" className="mb-1 block text-sm font-medium text-slate-700">Search</label>
            <input id="st-search" type="search" value={filters.q} onChange={(e) => change({ q: e.target.value })} placeholder="Number, contact or reference" className={`${SELECT} focus:outline-2 focus:outline-brand-600`} />
          </div>
        </div>

        <div className="mt-4">
          {list.isPending && <p className="text-sm text-slate-600">Loading…</p>}
          {list.isError && <Alert>{list.error.message}</Alert>}
          {list.data?.data.length === 0 && (
            <EmptyState
              title={filtered ? 'Nothing matches' : `No ${k.plural.toLowerCase()} yet`}
              description={filtered ? 'Try a different filter.' : `Record your first ${k.singular.toLowerCase()}.`}
              action={!filtered && auth.can(k.perms.create) && <Button to={k.newPath}>{k.newLabel}</Button>}
            />
          )}
          {list.data?.data.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase text-slate-500">
                  <tr>
                    <th className="py-2 pr-3">Date</th>
                    <th className="py-2 pr-3">Number</th>
                    <th className="py-2 pr-3">{k.partyLabel}</th>
                    <th className="hidden py-2 pr-3 md:table-cell">Method</th>
                    <th className="py-2 pr-3 text-right">Amount</th>
                    <th className="hidden py-2 pr-3 text-right md:table-cell">Advance</th>
                    <th className="py-2"><span className="sr-only">Status</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {list.data.data.map((s) => (
                    <tr key={s.id} className={s.status === 'voided' ? 'text-slate-400' : ''}>
                      <td className="whitespace-nowrap py-2 pr-3">{day(s.txnDate)}</td>
                      <td className="whitespace-nowrap py-2 pr-3"><Link to={`${k.base}/${s.id}`} className="font-medium text-brand-700 hover:underline">{s.referenceNo}</Link></td>
                      <td className="py-2 pr-3"><Link to={`/contacts/${s.contact.id}`} className="hover:underline">{s.contact.name}</Link></td>
                      <td className="hidden py-2 pr-3 md:table-cell">{METHOD_LABELS[s.method] ?? s.method}</td>
                      <td className="py-2 pr-3 text-right"><Amount value={s.amount} /></td>
                      <td className="hidden py-2 pr-3 text-right md:table-cell">{s.status === 'posted' && Number(s.unallocated) > 0 ? <Amount value={s.unallocated} /> : '–'}</td>
                      <td className="py-2">{s.status === 'voided' && <Badge tone="red">Voided</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {list.data && <Pagination page={list.data.meta.page} pageSize={list.data.meta.pageSize} total={list.data.meta.total} onPage={setPage} />}
        </div>
      </Card>
    </>
  );
}
