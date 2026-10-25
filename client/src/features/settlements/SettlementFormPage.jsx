import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { planOldestFirst } from '@ledgernepal/shared/allocation';
import { todayInNepal } from '@ledgernepal/shared/dates';
import { formatNPR, fromPaisa, toPaisa } from '@ledgernepal/shared/money';
import { apiFetch } from '../../api/client.js';
import { ContactPicker } from '../../components/ContactPicker.jsx';
import { DateField } from '../../components/DateField.jsx';
import { Amount } from '../../components/Money.jsx';
import { Alert, Badge, Button, Card, Field, PageHeader } from '../../components/ui.jsx';
import { parseAmountOrNull } from '../../lib/format.js';
import { fieldErrors, generalMessage } from '../../lib/formErrors.js';
import { useDayFormatter } from '../../lib/hooks.js';
import { METHODS, SETTLEMENTS } from './kinds.js';

/** Record a receipt or payment, and (optionally) say which invoices or bills it pays. */
export function SettlementFormPage({ kind }) {
  const [params] = useSearchParams();
  const preselected = params.get('contactId');
  const contact = useQuery({
    queryKey: ['contact', preselected],
    queryFn: ({ signal }) => apiFetch(`/contacts/${preselected}`, { signal }).then((r) => r.data),
    enabled: Boolean(preselected),
  });
  const k = SETTLEMENTS[kind];
  if (preselected && contact.isPending) return <p className="text-sm text-slate-600">Loading…</p>;
  if (preselected && contact.isError) return <><PageHeader title={k.newLabel} /><Alert>{contact.error.message}</Alert></>;
  return <Form kind={kind} initialContact={contact.data ?? null} documentId={params.get('documentId')} />;
}

const asPaisa = (text) => {
  try { return text === '' ? 0n : toPaisa(text); } catch { return null; }
};

function Form({ kind, initialContact, documentId }) {
  const k = SETTLEMENTS[kind];
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const day = useDayFormatter();
  const [contact, setContact] = useState(initialContact);
  const [form, setForm] = useState({ txnDate: todayInNepal(), amount: '', method: 'cash', externalRef: '', description: '' });
  const [applied, setApplied] = useState({}); // document id -> amount typed
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const open = useQuery({
    queryKey: [kind, 'open', contact?.id],
    queryFn: ({ signal }) => apiFetch(`${k.api}/open-documents?contactId=${contact.id}`, { signal }).then((r) => r.data),
    enabled: Boolean(contact),
  });
  const documents = open.data ?? [];

  // Arriving from an invoice or bill ("Record receipt" on its page): start with that document fully applied.
  const [prefilled, setPrefilled] = useState(false);
  useEffect(() => {
    if (prefilled || !documentId || !open.data) return;
    const doc = open.data.find((d) => d.id === documentId);
    if (doc) {
      setForm((f) => ({ ...f, amount: doc.outstanding }));
      setApplied({ [doc.id]: doc.outstanding });
    }
    setPrefilled(true);
  }, [open.data, documentId, prefilled]);

  const changeContact = (c) => { setContact(c); setApplied({}); };

  const amountPaisa = parseAmountOrNull(form.amount);
  const totals = Object.values(applied).map(asPaisa);
  const appliedPaisa = totals.some((p) => p === null) ? null : totals.reduce((a, b) => a + b, 0n);
  const tooMuch = amountPaisa !== null && appliedPaisa !== null && appliedPaisa > amountPaisa;
  const advancePaisa = amountPaisa !== null && appliedPaisa !== null && !tooMuch ? amountPaisa - appliedPaisa : null;

  const oldestFirst = () => {
    if (amountPaisa === null) return;
    const plan = planOldestFirst(
      amountPaisa,
      documents.map((d) => ({ id: d.id, txnDate: d.txnDate, referenceNo: d.referenceNo, outstanding: toPaisa(d.outstanding) })),
    );
    setApplied(Object.fromEntries(plan.allocations.map((a) => [a.id, fromPaisa(a.amount)])));
  };

  const mutation = useMutation({
    mutationFn: () => apiFetch(k.api, {
      method: 'POST',
      body: {
        contactId: contact.id,
        ...form,
        allocations: Object.entries(applied)
          .filter(([, amount]) => asPaisa(amount) > 0n)
          .map(([invoiceId, amount]) => ({ invoiceId, amount })),
      },
    }),
  });
  const errors = fieldErrors(mutation.error);
  if (mutation.error?.status === 404 && !errors.contactId) errors.contactId = mutation.error.message;

  async function submit(e) {
    e.preventDefault();
    try {
      const { data } = await mutation.mutateAsync();
      for (const key of [[kind], ['sale'], ['purchase'], ['contacts'], ['contact'], ['ledger']]) queryClient.invalidateQueries({ queryKey: key });
      navigate(`${k.base}/${data.id}`);
    } catch {
      // shown from mutation.error
    }
  }

  return (
    <>
      <PageHeader title={k.newLabel} description={k.intro} />
      <form onSubmit={submit} noValidate className="space-y-6">
        {generalMessage(mutation.error) && !errors.contactId && <Alert>{generalMessage(mutation.error)}</Alert>}
        <Card>
          <div className="space-y-5">
            <ContactPicker value={contact} onChange={changeContact} error={errors.contactId} label={k.partyLabel} autoFocus={!initialContact} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Amount (NPR)" required inputMode="decimal" placeholder="0.00" value={form.amount} onChange={set('amount')} error={errors.amount} autoComplete="off" />
              <DateField label="Date" required value={form.txnDate} onChange={(txnDate) => setForm((f) => ({ ...f, txnDate }))} error={errors.txnDate} />
              <div>
                <label htmlFor="st-form-method" className="mb-1 block text-sm font-medium text-slate-700">How was it paid? <span aria-hidden="true">*</span></label>
                <select id="st-form-method" value={form.method} onChange={set('method')} className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                  {METHODS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
                {errors.method && <p className="mt-1 text-sm text-red-700">{errors.method}</p>}
              </div>
              <Field label="Cheque / transaction number" value={form.externalRef} onChange={set('externalRef')} error={errors.externalRef} placeholder="Optional" />
            </div>
            <Field label="Description" value={form.description} onChange={set('description')} error={errors.description} placeholder="Optional" />
            {contact && amountPaisa && <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm font-medium text-slate-800">{formatNPR(amountPaisa)} {kind === 'receipt' ? 'received' : 'paid'}. {k.effectText(contact.name)}</p>}
          </div>
        </Card>

        {contact && (
          <Card title={`Apply to ${k.documentNoun}s`}>
            {open.isPending && <p className="text-sm text-slate-600">Loading…</p>}
            {open.isError && <Alert>{open.error.message}</Alert>}
            {open.data?.length === 0 && <p className="text-sm text-slate-600">{contact.name} has no unpaid {k.documentNoun}s. The full amount will be kept as an advance on the account.</p>}
            {documents.length > 0 && (
              <>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-slate-600">Optional. Anything you do not apply stays as an advance. Applying does not change the balance.</p>
                  <Button variant="secondary" onClick={oldestFirst} disabled={amountPaisa === null}>Apply oldest first</Button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-xs uppercase text-slate-500">
                      <tr>
                        <th className="py-2 pr-3">Number</th>
                        <th className="py-2 pr-3">Date</th>
                        <th className="py-2 pr-3 text-right">Outstanding</th>
                        <th className="py-2 text-right">Apply</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {documents.map((d, i) => (
                        <tr key={d.id}>
                          <td className="whitespace-nowrap py-2 pr-3 font-medium">{d.referenceNo} {d.overdue && <Badge tone="red">Overdue</Badge>}</td>
                          <td className="whitespace-nowrap py-2 pr-3">{day(d.txnDate)}</td>
                          <td className="py-2 pr-3 text-right"><Amount value={d.outstanding} /></td>
                          <td className="py-2 text-right">
                            <input
                              aria-label={`Apply to ${d.referenceNo}`}
                              inputMode="decimal"
                              value={applied[d.id] ?? ''}
                              placeholder="0.00"
                              onChange={(e) => setApplied((a) => ({ ...a, [d.id]: e.target.value }))}
                              className="w-28 rounded-lg border border-slate-300 px-2 py-1 text-right text-sm"
                            />
                            {errors[`allocations.${i}.amount`] && <p className="text-xs text-red-700">{errors[`allocations.${i}.amount`]}</p>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {errors.allocations && <p className="mt-2 text-sm text-red-700">{errors.allocations}</p>}
                <p role="status" className={`mt-3 text-sm font-medium ${tooMuch || appliedPaisa === null ? 'text-red-700' : 'text-slate-800'}`}>
                  {appliedPaisa === null && 'One of the amounts is not a valid number.'}
                  {tooMuch && `You applied ${formatNPR(appliedPaisa)}, which is more than the ${formatNPR(amountPaisa)} ${kind === 'receipt' ? 'received' : 'paid'}.`}
                  {appliedPaisa !== null && !tooMuch && `Applied ${formatNPR(appliedPaisa)}${advancePaisa ? `; ${formatNPR(advancePaisa)} stays as an advance` : ''}.`}
                </p>
              </>
            )}
          </Card>
        )}

        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={mutation.isPending || !contact || tooMuch || appliedPaisa === null}>{mutation.isPending ? 'Saving…' : `Save ${k.singular.toLowerCase()}`}</Button>
          <Button variant="secondary" onClick={() => navigate(-1)}>Cancel</Button>
        </div>
      </form>
    </>
  );
}
