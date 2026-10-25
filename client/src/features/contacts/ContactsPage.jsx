import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { BalanceText } from '../../components/Money.jsx';
import { Pagination } from '../../components/Pagination.jsx';
import { Alert, Badge, Button, Card, EmptyState, PageHeader } from '../../components/ui.jsx';
import { useDebounced } from '../../lib/hooks.js';

const PAGE_SIZE = 25;
const TYPE_LABELS = { customer: 'Customer', supplier: 'Supplier', partner: 'Partner' };

export function TypeBadges({ types }) {
  return (
    <span className="flex flex-wrap gap-1">
      {types.map((t) => <Badge key={t} tone={t === 'customer' ? 'blue' : t === 'supplier' ? 'amber' : 'neutral'}>{TYPE_LABELS[t]}</Badge>)}
    </span>
  );
}

export function ContactsPage() {
  const auth = useAuth();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const type = params.get('type') ?? '';
  const archived = params.get('archived') ?? 'false';
  const page = Number(params.get('page') ?? 1) || 1;

  // The search box is typed into freely; the URL (and the request) follow once typing pauses.
  const [search, setSearch] = useState(q);
  const debounced = useDebounced(search.trim(), 300);
  const update = (changes) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) (value ? next.set(key, value) : next.delete(key));
    setParams(next, { replace: true });
  };
  useEffect(() => {
    if (debounced !== q) update({ q: debounced, page: '' });
    // react to the typed text only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const query = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), archived });
  if (q) query.set('q', q);
  if (type) query.set('type', type);

  const contacts = useQuery({
    queryKey: ['contacts', 'list', q, type, archived, page],
    queryFn: ({ signal }) => apiFetch(`/contacts?${query}`, { signal }),
    placeholderData: (previous) => previous, // keep showing the old rows while the new ones load
  });
  const filtered = Boolean(q || type || archived !== 'false');
  const showBalance = auth.can('ledger.view');

  return (
    <>
      <PageHeader
        title="Contacts"
        description="Customers, suppliers and partners."
        actions={auth.can('contacts.create') && <Button to="/contacts/new">Add contact</Button>}
      />

      <Card>
        <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
          <div>
            <label htmlFor="contact-search" className="sr-only">Search contacts</label>
            <input
              id="contact-search"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, phone, email or PAN"
              className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-2 focus:outline-brand-600"
            />
          </div>
          <div>
            <label htmlFor="contact-type" className="sr-only">Type</label>
            <select id="contact-type" value={type} onChange={(e) => update({ type: e.target.value, page: '' })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
              <option value="">All types</option>
              <option value="customer">Customers</option>
              <option value="supplier">Suppliers</option>
              <option value="partner">Partners</option>
            </select>
          </div>
          <div>
            <label htmlFor="contact-archived" className="sr-only">Show</label>
            <select id="contact-archived" value={archived} onChange={(e) => update({ archived: e.target.value === 'false' ? '' : e.target.value, page: '' })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
              <option value="false">Active</option>
              <option value="true">Archived</option>
              <option value="all">Active and archived</option>
            </select>
          </div>
        </div>

        <div className="mt-4">
          {contacts.isPending && <p className="text-sm text-slate-600">Loading contacts…</p>}
          {contacts.isError && <Alert>{contacts.error.message}</Alert>}
          {contacts.data && contacts.data.data.length === 0 && (
            filtered ? (
              <EmptyState title="No contacts match" description="Try a different search or filter." action={<Button variant="secondary" onClick={() => { setSearch(''); setParams({}, { replace: true }); }}>Clear filters</Button>} />
            ) : (
              <EmptyState
                title="No contacts yet"
                description="Add the people and businesses you buy from, sell to or work with."
                action={auth.can('contacts.create') && <Button to="/contacts/new">Add your first contact</Button>}
              />
            )
          )}
          {contacts.data && contacts.data.data.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase text-slate-500">
                  <tr>
                    <th className="py-2 pr-4">Name</th>
                    <th className="hidden py-2 pr-4 sm:table-cell">Phone</th>
                    {showBalance && <th className="py-2 text-right">Balance</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {contacts.data.data.map((c) => (
                    <tr key={c.id} className={c.archivedAt ? 'text-slate-400' : ''}>
                      <td className="py-3 pr-4">
                        <Link to={`/contacts/${c.id}`} className="font-medium text-brand-700 hover:underline">{c.name}</Link>
                        {c.archivedAt && <span className="ml-2"><Badge>Archived</Badge></span>}
                        <div className="mt-1"><TypeBadges types={c.types} /></div>
                      </td>
                      <td className="hidden py-3 pr-4 sm:table-cell">{c.phone ?? '–'}</td>
                      {showBalance && <td className="py-3 text-right"><BalanceText balance={c.balance} /></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {contacts.data && (
            <Pagination page={contacts.data.meta.page} pageSize={contacts.data.meta.pageSize} total={contacts.data.meta.total} onPage={(p) => update({ page: p === 1 ? '' : String(p) })} />
          )}
        </div>
      </Card>
    </>
  );
}
