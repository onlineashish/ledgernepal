import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { DateField } from '../../components/DateField.jsx';
import { Amount } from '../../components/Money.jsx';
import { Pagination } from '../../components/Pagination.jsx';
import { Alert, Badge, Card, EmptyState } from '../../components/ui.jsx';
import { useDayFormatter, useDebounced } from '../../lib/hooks.js';
import { CorrectEntryModal, VoidEntryModal } from './EntryModals.jsx';

const PAGE_SIZE = 50;
// Invoices and bills open their own page; direct entries are corrected or voided right here.
const DOCUMENT_PATHS = { sale: '/sales', purchase: '/purchases', receipt: '/receipts-payments/receipts', payment: '/receipts-payments/payments' };
const TYPE_BADGES = { sale: ['Sales invoice', 'green'], purchase: ['Purchase bill', 'amber'], receipt: ['Receipt', 'blue'], payment: ['Payment', 'blue'] };

/** One contact's account: every posted line with debit, credit and the running balance. */
export function ContactLedger({ contactId, archived }) {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const day = useDayFormatter();
  const [filters, setFilters] = useState({ from: '', to: '', q: '' });
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState(null); // { kind: 'void' | 'correct', entry }
  const q = useDebounced(filters.q.trim(), 300);

  const query = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (filters.from) query.set('from', filters.from);
  if (filters.to) query.set('to', filters.to);
  if (q) query.set('q', q);

  const ledger = useQuery({
    queryKey: ['ledger', 'contact', contactId, filters.from, filters.to, q, page],
    queryFn: ({ signal }) => apiFetch(`/ledger/contacts/${contactId}?${query}`, { signal }),
    placeholderData: (previous) => previous,
  });
  const canCorrect = auth.can('ledger.correct') && !archived;
  const change = (patch) => { setFilters((f) => ({ ...f, ...patch })); setPage(1); };
  const refresh = () => {
    setModal(null);
    queryClient.invalidateQueries({ queryKey: ['ledger'] });
    queryClient.invalidateQueries({ queryKey: ['contact', contactId] });
    queryClient.invalidateQueries({ queryKey: ['contacts'] });
  };
  const filtered = Boolean(filters.from || filters.to || q);

  return (
    <Card title="Ledger">
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_2fr]">
        <DateField label="From" value={filters.from} onChange={(from) => change({ from })} />
        <DateField label="To" value={filters.to} onChange={(to) => change({ to })} />
        <div>
          <label htmlFor="ledger-search" className="mb-1 block text-sm font-medium text-slate-700">Search</label>
          <input id="ledger-search" type="search" value={filters.q} onChange={(e) => change({ q: e.target.value })} placeholder="Description or reference" className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-2 focus:outline-brand-600" />
        </div>
      </div>

      {ledger.isPending && <p className="mt-4 text-sm text-slate-600">Loading ledger…</p>}
      {ledger.isError && <Alert className="mt-4">{ledger.error.message}</Alert>}

      {ledger.data && (
        <>
          <dl className="mt-4 grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3 text-sm sm:grid-cols-4">
            <div><dt className="text-xs text-slate-500">{filters.from ? 'Brought forward' : 'Opening'}</dt><dd><Amount value={ledger.data.data.openingBalance} /></dd></div>
            <div><dt className="text-xs text-slate-500">Total debit</dt><dd><Amount value={ledger.data.data.totals.debit} /></dd></div>
            <div><dt className="text-xs text-slate-500">Total credit</dt><dd><Amount value={ledger.data.data.totals.credit} /></dd></div>
            <div><dt className="text-xs text-slate-500">Closing balance</dt><dd className="font-semibold"><Amount value={ledger.data.data.closingBalance} /></dd></div>
          </dl>
          <p className="mt-2 text-xs text-slate-500">
            Debit means they owe you more; credit means they owe you less. A negative balance means you owe them.
          </p>

          {ledger.data.data.rows.length === 0 ? (
            <div className="mt-4">
              <EmptyState title={filtered ? 'No entries match' : 'No entries yet'} description={filtered ? 'Try a different date range or search.' : 'Entries you add for this contact will appear here.'} />
            </div>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase text-slate-500">
                  <tr>
                    <th className="py-2 pr-3">Date</th>
                    <th className="py-2 pr-3">Reference</th>
                    <th className="py-2 pr-3">Description</th>
                    <th className="py-2 pr-3 text-right">Debit</th>
                    <th className="py-2 pr-3 text-right">Credit</th>
                    <th className="py-2 text-right">Balance</th>
                    {canCorrect && <th className="py-2 pl-3"><span className="sr-only">Actions</span></th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {ledger.data.data.rows.map((row) => (
                    <tr key={row.id}>
                      <td className="whitespace-nowrap py-2 pr-3">{day(row.txnDate)}</td>
                      <td className="whitespace-nowrap py-2 pr-3 text-slate-600">{DOCUMENT_PATHS[row.type] ? <Link to={`${DOCUMENT_PATHS[row.type]}/${row.id}`} className="font-medium text-brand-700 hover:underline">{row.referenceNo}</Link> : row.referenceNo}</td>
                      <td className="py-2 pr-3">
                        {row.type === 'opening_balance' && <span className="mr-2"><Badge tone="blue">Opening balance</Badge></span>}
                        {TYPE_BADGES[row.type] && <span className="mr-2"><Badge tone={TYPE_BADGES[row.type][1]}>{TYPE_BADGES[row.type][0]}</Badge></span>}
                        {row.description ?? ''}
                        {row.externalRef && <span className="ml-2 text-xs text-slate-500">Ref {row.externalRef}</span>}
                        {row.createdBy && <span className="block text-xs text-slate-400">by {row.createdBy.fullName}</span>}
                      </td>
                      <td className="py-2 pr-3 text-right"><Amount value={row.debit} /></td>
                      <td className="py-2 pr-3 text-right"><Amount value={row.credit} /></td>
                      <td className="py-2 text-right font-medium"><Amount value={row.balance} /></td>
                      {canCorrect && (
                        <td className="whitespace-nowrap py-2 pl-3 text-right">
                          {row.type === 'ledger_entry' && (
                            <>
                              <button type="button" className="text-sm font-medium text-brand-600 hover:underline" aria-label={`Correct ${row.referenceNo}`} onClick={() => setModal({ kind: 'correct', entry: row })}>Correct</button>
                              <button type="button" className="ml-3 text-sm font-medium text-red-700 hover:underline" aria-label={`Void ${row.referenceNo}`} onClick={() => setModal({ kind: 'void', entry: row })}>Void</button>
                            </>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pagination page={ledger.data.meta.page} pageSize={ledger.data.meta.pageSize} total={ledger.data.meta.total} onPage={setPage} />
        </>
      )}

      {modal?.kind === 'void' && <VoidEntryModal entry={modal.entry} onClose={() => setModal(null)} onDone={refresh} />}
      {modal?.kind === 'correct' && <CorrectEntryModal entry={modal.entry} onClose={() => setModal(null)} onDone={refresh} />}
    </Card>
  );
}
