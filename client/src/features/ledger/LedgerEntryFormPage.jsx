import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DIRECTIONS, describeOutcome } from '@ledgernepal/shared/ledger';
import { todayInNepal } from '@ledgernepal/shared/dates';
import { formatNPR, toPaisa } from '@ledgernepal/shared/money';
import { apiFetch } from '../../api/client.js';
import { ContactPicker } from '../../components/ContactPicker.jsx';
import { DateField } from '../../components/DateField.jsx';
import { Alert, Button, Card, Field, PageHeader } from '../../components/ui.jsx';
import { parseAmountOrNull } from '../../lib/format.js';
import { fieldErrors, generalMessage } from '../../lib/formErrors.js';

/** Add Ledger Entry: record money or goods given or received, with no invoice. */
export function LedgerEntryFormPage() {
  const [params] = useSearchParams();
  const preselected = params.get('contactId');

  // Arriving from a contact's page: load that contact (with its balance) so the form starts filled in.
  const preloaded = useQuery({
    queryKey: ['contact', preselected],
    queryFn: ({ signal }) => apiFetch(`/contacts/${preselected}`, { signal }).then((r) => r.data),
    enabled: Boolean(preselected),
  });
  if (preselected && preloaded.isPending) return <p className="text-sm text-slate-600">Loading…</p>;
  if (preselected && preloaded.isError) return <><PageHeader title="Add ledger entry" /><Alert>{preloaded.error.message}</Alert></>;

  return <EntryForm initialContact={preloaded.data ?? null} />;
}

function EntryForm({ initialContact }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [contact, setContact] = useState(initialContact);
  const [form, setForm] = useState({ txnDate: todayInNepal(), direction: '', amount: '', description: '', externalRef: '' });
  const [saved, setSaved] = useState(null);
  const set = (key) => (e) => { setSaved(null); setForm((f) => ({ ...f, [key]: e.target.value })); };

  const mutation = useMutation({
    mutationFn: () => apiFetch('/ledger/entries', { method: 'POST', body: { contactId: contact.id, ...form } }),
    onError: () => setSaved(null),
  });
  const errors = fieldErrors(mutation.error);
  if (mutation.error?.status === 404 && !errors.contactId) errors.contactId = mutation.error.message;

  async function submit(addAnother) {
    try {
      const { data } = await mutation.mutateAsync();
      queryClient.invalidateQueries({ queryKey: ['ledger'] });
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      queryClient.invalidateQueries({ queryKey: ['contact', contact.id] });
      if (addAnother) {
        // Keep who and when; clear what was just entered. The balance shown for the contact is refreshed.
        setSaved(`Saved ${data.referenceNo}.`);
        setForm((f) => ({ ...f, amount: '', description: '', externalRef: '' }));
        mutation.reset();
        const fresh = await apiFetch(`/contacts/${contact.id}`);
        setContact(fresh.data);
      } else {
        navigate(`/contacts/${contact.id}`);
      }
    } catch {
      // the error is shown from mutation.error
    }
  }

  // The sentence that spells out the result before saving, so "debit/credit" is never a guess.
  const amountPaisa = parseAmountOrNull(form.amount);
  const currentPaisa = contact?.balance ? toPaisa(contact.balance.amount, { allowNegative: true }) : null;
  const outcome =
    contact && form.direction && amountPaisa
      ? describeOutcome({ name: contact.name, direction: form.direction, amountPaisa, currentPaisa, format: formatNPR })
      : null;

  return (
    <>
      <PageHeader title="Add ledger entry" description="Record money, goods or services given or received. No invoice needed." />
      <form onSubmit={(e) => { e.preventDefault(); submit(false); }} noValidate className="space-y-6">
        {generalMessage(mutation.error) && !errors.contactId && <Alert>{generalMessage(mutation.error)}</Alert>}
        {saved && <Alert tone="success">{saved} You can add another below.</Alert>}

        <Card>
          <div className="space-y-5">
            <ContactPicker value={contact} onChange={(c) => { setContact(c); setSaved(null); }} error={errors.contactId} autoFocus={!initialContact} />

            <fieldset>
              <legend className="mb-1 block text-sm font-medium text-slate-700">What happened? <span aria-hidden="true">*</span></legend>
              <div className="grid gap-3 sm:grid-cols-2">
                {Object.entries(DIRECTIONS).map(([key, { label, meaning }]) => (
                  <label key={key} className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-300 px-4 py-3 has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50">
                    <input type="radio" name="direction" value={key} checked={form.direction === key} onChange={set('direction')} className="mt-1" />
                    <span>
                      <span className="block font-medium text-slate-900">{label}</span>
                      <span className="block text-sm text-slate-600">
                        {key === 'you_gave' ? 'You gave money, goods or services.' : 'You received money, goods or services.'}{' '}
                        {contact ? `${contact.name} ${key === 'you_gave' ? 'owes you more' : 'owes you less'}.` : `They ${meaning}.`}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
              {errors.direction && <p className="mt-1 text-sm text-red-700">{errors.direction}</p>}
            </fieldset>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Amount (NPR)" required inputMode="decimal" placeholder="0.00" value={form.amount} onChange={set('amount')} error={errors.amount} autoComplete="off" />
              <DateField label="Transaction date" required value={form.txnDate} onChange={(txnDate) => { setSaved(null); setForm((f) => ({ ...f, txnDate })); }} error={errors.txnDate} />
            </div>

            <div aria-live="polite" role="status" className="min-h-6 rounded-lg bg-slate-50 px-3 py-2 text-sm font-medium text-slate-800">
              {outcome ?? <span className="font-normal text-slate-500">Choose what happened and enter an amount to see the result.</span>}
            </div>

            <Field label="Description" value={form.description} onChange={set('description')} error={errors.description} placeholder="Optional, e.g. 50 kg rice" />
            <Field label="Your reference (optional)" value={form.externalRef} onChange={set('externalRef')} error={errors.externalRef} hint="A cheque, bill or eSewa number. The system also gives every entry its own number." />
          </div>
        </Card>

        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={mutation.isPending || !contact}>{mutation.isPending ? 'Saving…' : 'Save entry'}</Button>
          <Button variant="secondary" disabled={mutation.isPending || !contact} onClick={() => submit(true)}>Save and add another</Button>
          <Button variant="secondary" onClick={() => navigate(-1)}>Cancel</Button>
        </div>
      </form>
    </>
  );
}
