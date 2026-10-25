import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { OPENING_SIDES } from '@ledgernepal/shared/ledger';
import { apiFetch } from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { DateField } from '../../components/DateField.jsx';
import { Alert, Button, Card, Field, PageHeader } from '../../components/ui.jsx';
import { fieldErrors, generalMessage } from '../../lib/formErrors.js';

const TYPES = [
  ['customer', 'Customer', 'They buy from you'],
  ['supplier', 'Supplier', 'You buy from them'],
  ['partner', 'Partner', 'A business partner'],
];
const EMPTY = { name: '', types: [], phone: '', email: '', address: '', panNumber: '', vatNumber: '', notes: '' };
const EMPTY_OPENING = { amount: '', side: 'they_owe_me', asOfDate: '' };

/** Add a contact (/contacts/new) or edit one (/contacts/:id/edit). */
export function ContactFormPage({ mode }) {
  const { id } = useParams();
  const auth = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const editing = mode === 'edit';

  const existing = useQuery({
    queryKey: ['contact', id],
    queryFn: ({ signal }) => apiFetch(`/contacts/${id}`, { signal }).then((r) => r.data),
    enabled: editing,
  });

  if (editing && existing.isPending) return <p className="text-sm text-slate-600">Loading…</p>;
  if (editing && existing.isError) return <Alert>{existing.error.message}</Alert>;

  // The form is rendered only once the contact is loaded, so its first state is the real values.
  return (
    <>
      <PageHeader title={editing ? `Edit ${existing.data.name}` : 'Add contact'} />
      <ContactForm
        initial={editing ? toForm(existing.data) : EMPTY}
        canOpeningBalance={!editing && auth.can('ledger.create')}
        onSaved={(contact) => {
          queryClient.invalidateQueries({ queryKey: ['contacts'] });
          queryClient.invalidateQueries({ queryKey: ['contact', contact.id] });
          navigate(`/contacts/${contact.id}`);
        }}
        save={(body) =>
          editing
            ? apiFetch(`/contacts/${id}`, { method: 'PATCH', body })
            : apiFetch('/contacts', { method: 'POST', body })
        }
      />
    </>
  );
}

const toForm = (c) => ({
  name: c.name, types: c.types, phone: c.phone ?? '', email: c.email ?? '', address: c.address ?? '',
  panNumber: c.panNumber ?? '', vatNumber: c.vatNumber ?? '', notes: c.notes ?? '',
});

function ContactForm({ initial, canOpeningBalance, save, onSaved }) {
  const navigate = useNavigate();
  const [form, setForm] = useState(initial);
  const [opening, setOpening] = useState(EMPTY_OPENING);
  const [showOpening, setShowOpening] = useState(false);

  const mutation = useMutation({
    mutationFn: () => {
      const body = { ...form }; // empty text is sent as "" and stored as no value
      if (canOpeningBalance && showOpening && opening.amount.trim()) {
        body.openingBalance = { amount: opening.amount.trim(), side: opening.side, ...(opening.asOfDate && { asOfDate: opening.asOfDate }) };
      }
      return save(body);
    },
    onSuccess: (response) => onSaved(response.data),
  });
  const errors = fieldErrors(mutation.error);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const toggleType = (type) =>
    setForm((f) => ({ ...f, types: f.types.includes(type) ? f.types.filter((t) => t !== type) : [...f.types, type] }));

  return (
    <form onSubmit={(e) => { e.preventDefault(); mutation.mutate(); }} noValidate className="space-y-6">
      {generalMessage(mutation.error) && <Alert>{generalMessage(mutation.error)}</Alert>}

      <Card title="Details">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required className="sm:col-span-2" value={form.name} onChange={set('name')} error={errors.name} autoComplete="off" />

          <fieldset className="sm:col-span-2">
            <legend className="mb-1 block text-sm font-medium text-slate-700">Type (choose one or more)</legend>
            <div className="flex flex-wrap gap-3">
              {TYPES.map(([key, label, hint]) => (
                <label key={key} className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50">
                  <input type="checkbox" checked={form.types.includes(key)} onChange={() => toggleType(key)} className="mt-1" />
                  <span><span className="font-medium">{label}</span><span className="block text-xs text-slate-500">{hint}</span></span>
                </label>
              ))}
            </div>
            {(errors.types || Object.keys(errors).some((k) => k.startsWith('types.'))) && (
              <p className="mt-1 text-sm text-red-700">{errors.types ?? 'Choose customer, supplier or partner'}</p>
            )}
          </fieldset>

          <Field label="Phone number" value={form.phone} onChange={set('phone')} error={errors.phone} inputMode="tel" />
          <Field label="Email" type="email" value={form.email} onChange={set('email')} error={errors.email} />
          <Field label="Address" className="sm:col-span-2" value={form.address} onChange={set('address')} error={errors.address} />
          <Field label="PAN number" value={form.panNumber} onChange={set('panNumber')} error={errors.panNumber} />
          <Field label="VAT number" value={form.vatNumber} onChange={set('vatNumber')} error={errors.vatNumber} />
          <div className="sm:col-span-2">
            <label htmlFor="contact-notes" className="mb-1 block text-sm font-medium text-slate-700">Notes</label>
            <textarea id="contact-notes" rows={3} value={form.notes} onChange={set('notes')} className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-2 focus:outline-brand-600" />
            {errors.notes && <p className="mt-1 text-sm text-red-700">{errors.notes}</p>}
          </div>
        </div>
        <p className="mt-3 text-xs text-slate-500">Only the name and type are required.</p>
      </Card>

      {canOpeningBalance && (
        <Card title="Opening balance (optional)">
          {!showOpening ? (
            <div>
              <p className="text-sm text-slate-600">Already owed money before you started using LedgerNepal? Enter it here.</p>
              <Button variant="secondary" className="mt-3" onClick={() => setShowOpening(true)}>Add an opening balance</Button>
            </div>
          ) : (
            <OpeningBalanceFields value={opening} onChange={setOpening} errors={errors} prefix="openingBalance." />
          )}
        </Card>
      )}

      <div className="flex gap-3">
        <Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? 'Saving…' : 'Save contact'}</Button>
        <Button variant="secondary" onClick={() => navigate(-1)}>Cancel</Button>
      </div>
    </form>
  );
}

/** Amount + who owes whom + as-of date. Shared by the new-contact form and the "change opening balance" dialog. */
export function OpeningBalanceFields({ value, onChange, errors = {}, prefix = '' }) {
  const set = (key) => (e) => onChange({ ...value, [key]: e.target.value });
  return (
    <div className="space-y-4">
      <fieldset>
        <legend className="mb-1 block text-sm font-medium text-slate-700">Who owes whom?</legend>
        <div className="flex flex-wrap gap-3">
          {Object.entries(OPENING_SIDES).map(([key, { label }]) => (
            <label key={key} className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50">
              <input type="radio" name="opening-side" value={key} checked={value.side === key} onChange={set('side')} />
              {label}
            </label>
          ))}
        </div>
        {errors[`${prefix}side`] && <p className="mt-1 text-sm text-red-700">{errors[`${prefix}side`]}</p>}
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Amount (NPR)" inputMode="decimal" value={value.amount} onChange={set('amount')} error={errors[`${prefix}amount`]} placeholder="0.00" />
        <DateField label="As of date" value={value.asOfDate} onChange={(asOfDate) => onChange({ ...value, asOfDate })} error={errors[`${prefix}asOfDate`]} />
      </div>
      <p className="text-xs text-slate-500">If you leave the date empty, today is used.</p>
    </div>
  );
}
