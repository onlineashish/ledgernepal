import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api/client.js';
import { useDebounced } from '../lib/hooks.js';
import { BalanceText } from './Money.jsx';

/**
 * Pick one of the business's contacts by typing part of the name, phone or PAN.
 * `value` is the chosen contact object (or null); `onChange` receives the contact the person picks.
 */
export function ContactPicker({ value, onChange, error, label = 'Contact', autoFocus = false }) {
  const id = useId();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const debounced = useDebounced(query.trim(), 200);

  const results = useQuery({
    queryKey: ['contacts', 'picker', debounced],
    queryFn: ({ signal }) => apiFetch(`/contacts?pageSize=8${debounced ? `&q=${encodeURIComponent(debounced)}` : ''}`, { signal }).then((r) => r.data),
    enabled: open && !value,
  });

  if (value) {
    return (
      <div>
        <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
        <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-slate-900">{value.name}</p>
            {value.balance !== undefined && <p className="text-xs"><BalanceText balance={value.balance} /></p>}
          </div>
          <button type="button" onClick={() => { onChange(null); setQuery(''); }} className="shrink-0 text-sm font-medium text-brand-600 hover:underline">
            Change
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-slate-700">{label} <span aria-hidden="true">*</span></label>
      <input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-invalid={error ? 'true' : undefined}
        autoComplete="off"
        autoFocus={autoFocus}
        placeholder="Type a name, phone or PAN"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        className={`block w-full rounded-lg border px-3 py-2 text-sm focus:outline-2 focus:outline-brand-600 ${error ? 'border-red-500' : 'border-slate-300'}`}
      />
      {error && <p className="mt-1 text-sm text-red-700">{error}</p>}
      {open && (
        <div className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          {/* Messages sit outside the listbox: a listbox may only contain options. */}
          {results.isPending && <p role="status" className="px-3 py-2 text-sm text-slate-500">Searching…</p>}
          {results.isError && <p role="alert" className="px-3 py-2 text-sm text-red-700">{results.error.message}</p>}
          {results.data?.length === 0 && <p role="status" className="px-3 py-2 text-sm text-slate-500">No contact matches. Add the contact first.</p>}
          <ul id={`${id}-list`} role="listbox" aria-label={`${label} suggestions`} hidden={!results.data?.length}>
            {results.data?.map((contact) => (
              <li key={contact.id} role="option" aria-selected="false">
                <button type="button" onClick={() => { onChange(contact); setOpen(false); }} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-brand-50">
                  <span className="truncate font-medium text-slate-900">{contact.name}</span>
                  <span className="shrink-0 text-xs"><BalanceText balance={contact.balance} /></span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
