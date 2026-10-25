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
import { KINDS, PAYMENT_STATUS_LABELS, PAYMENT_STATUS_TONES, STATUS_LABELS, STATUS_TONES } from './kinds.js';

const PAGE_SIZE = 25;

/** The list of sales invoices or purchase bills. */
export function DocumentsPage({ kind }) {
  const k = KINDS[kind];
  const auth = useAuth();
  const day = useDayFormatter();
  const [filters, setFilters] = useState({ from: '', to: '', q: '', status: 'all', payment: 'all' });
  const [page, setPage] = useState(1);
  const q = useDebounced(filters.q.trim(), 300);
  const change = (patch) => { setFilters((f) => ({ ...f, ...patch })); setPage(1); };

  const query = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), status: filters.status, payment: filters.payment });
  if (filters.from) query.set('from', filters.from);
  if (filters.to) query.set('to', filters.to);
  if (q) query.set('q', q);

  const documents = useQuery({
    queryKey: [kind, 'list', filters.from, filters.to, q, filters.status, filters.payment, page],
    queryFn: ({ signal }) => apiFetch(`${k.api}?${query}`, { signal }),
    placeholderData: (previous) => previous,
  });
  const filtered = Boolean(filters.from || filters.to || q || filters.status !== 'all' || filters.payment !== 'all');

  return (
    <>
      <PageHeader
        title={k.plural}
        description={kind === 'sale' ? 'Invoices you have issued to customers.' : 'Bills you have received from suppliers.'}
        actions={auth.can(k.perms.create) && <Button to={`${k.path}/new`}>{k.newLabel}</Button>}
      />
      <Card>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <DateField label="From" value={filters.from} onChange={(from) => change({ from })} />
          <DateField label="To" value={filters.to} onChange={(to) => change({ to })} />
          <div>
            <label htmlFor="doc-status" className="mb-1 block text-sm font-medium text-slate-700">Show</label>
            <select id="doc-status" value={filters.status} onChange={(e) => change({ status: e.target.value })} className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
              <option value="all">All</option>
              <option value="draft">Drafts</option>
              <option value="posted">Posted</option>
              <option value="voided">Voided</option>
            </select>
          </div>
          <div>
            <label htmlFor="doc-payment" className="mb-1 block text-sm font-medium text-slate-700">Payment</label>
            <select id="doc-payment" value={filters.payment} onChange={(e) => change({ payment: e.target.value })} className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
              <option value="all">Any</option>
              <option value="open">Not fully paid</option>
              <option value="unpaid">Unpaid</option>
              <option value="partial">Part paid</option>
              <option value="paid">Paid</option>
              <option value="overdue">Overdue</option>
            </select>
          </div>
          <div>
            <label htmlFor="doc-search" className="mb-1 block text-sm font-medium text-slate-700">Search</label>
            <input id="doc-search" type="search" value={filters.q} onChange={(e) => change({ q: e.target.value })} placeholder="Number, contact or item" className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-2 focus:outline-brand-600" />
          </div>
        </div>

        <div className="mt-4">
          {documents.isPending && <p className="text-sm text-slate-600">Loading…</p>}
          {documents.isError && <Alert>{documents.error.message}</Alert>}
          {documents.data?.data.length === 0 && (
            <EmptyState
              title={filtered ? 'Nothing matches' : `No ${k.plural.toLowerCase()} yet`}
              description={filtered ? 'Try a different date range, status or search.' : kind === 'sale' ? 'Create your first sales invoice.' : 'Record your first purchase bill.'}
              action={!filtered && auth.can(k.perms.create) && <Button to={`${k.path}/new`}>{k.newLabel}</Button>}
            />
          )}
          {documents.data?.data.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase text-slate-500">
                  <tr>
                    <th className="py-2 pr-3">Date</th>
                    <th className="py-2 pr-3">Number</th>
                    <th className="py-2 pr-3">{k.partyLabel}</th>
                    <th className="hidden py-2 pr-3 md:table-cell">Due</th>
                    <th className="py-2 pr-3 text-right">Total</th>
                    <th className="hidden py-2 pr-3 text-right md:table-cell">Outstanding</th>
                    <th className="py-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {documents.data.data.map((d) => (
                    <tr key={d.id} className={d.status === 'voided' ? 'text-slate-400' : ''}>
                      <td className="whitespace-nowrap py-2 pr-3">{day(d.txnDate)}</td>
                      <td className="whitespace-nowrap py-2 pr-3">
                        <Link to={`${k.path}/${d.id}`} className="font-medium text-brand-700 hover:underline">{d.referenceNo ?? 'Draft'}</Link>
                        {d.description && <span className="block max-w-56 truncate text-xs text-slate-500">{d.description}</span>}
                      </td>
                      <td className="py-2 pr-3"><Link to={`/contacts/${d.contact.id}`} className="hover:underline">{d.contact.name}</Link></td>
                      <td className="hidden whitespace-nowrap py-2 pr-3 md:table-cell">{d.dueDate ? day(d.dueDate) : '–'}</td>
                      <td className="py-2 pr-3 text-right"><Amount value={d.total} /></td>
                      <td className="hidden py-2 pr-3 text-right md:table-cell">{d.status === 'posted' ? <Amount value={d.outstanding} /> : '–'}</td>
                      <td className="py-2">
                        <Badge tone={STATUS_TONES[d.status]}>{STATUS_LABELS[d.status]}</Badge>
                        {d.status === 'posted' && <span className="ml-1"><Badge tone={PAYMENT_STATUS_TONES[d.paymentStatus]}>{PAYMENT_STATUS_LABELS[d.paymentStatus]}</Badge></span>}
                        {d.overdue && <span className="ml-1"><Badge tone="red">Overdue</Badge></span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {documents.data && <Pagination page={documents.data.meta.page} pageSize={documents.data.meta.pageSize} total={documents.data.meta.total} onPage={setPage} />}
        </div>
      </Card>
    </>
  );
}
