import { useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addDays, todayInNepal } from '@ledgernepal/shared/dates';
import { describeBalanceAfter } from '@ledgernepal/shared/ledger';
import { formatNPR, fromPaisa, toPaisa } from '@ledgernepal/shared/money';
import { apiFetch } from '../../api/client.js';
import { ContactPicker } from '../../components/ContactPicker.jsx';
import { DateField } from '../../components/DateField.jsx';
import { Amount } from '../../components/Money.jsx';
import { Alert, Button, Card, Field, PageHeader } from '../../components/ui.jsx';
import { fieldErrors, generalMessage } from '../../lib/formErrors.js';
import { useDayFormatter } from '../../lib/hooks.js';
import { isBlankLine, previewDocument } from '../../lib/invoicePreview.js';
import { useSettings } from '../settings/useSettings.js';
import { KINDS } from './kinds.js';
import { LinesEditor } from './LinesEditor.jsx';

/** Create a sales invoice / purchase bill (/new) or edit a draft (/:id/edit). */
export function DocumentFormPage({ kind, mode }) {
  const k = KINDS[kind];
  const { id } = useParams();
  const [params] = useSearchParams();
  const editing = mode === 'edit';
  const settings = useSettings();
  const existing = useQuery({ queryKey: [kind, id], queryFn: ({ signal }) => apiFetch(`${k.api}/${id}`, { signal }).then((r) => r.data), enabled: editing });

  // The contact (with its balance, if the person may see balances): from the link, or the draft being edited.
  const contactId = editing ? existing.data?.contact.id : params.get('contactId');
  const contact = useQuery({
    queryKey: ['contact', contactId],
    queryFn: ({ signal }) => apiFetch(`/contacts/${contactId}`, { signal }).then((r) => r.data),
    enabled: Boolean(contactId),
  });

  if (settings.isPending || (editing && existing.isPending) || (contactId && contact.isPending)) return <p className="text-sm text-slate-600">Loading…</p>;
  const failure = settings.error ?? existing.error ?? contact.error;
  if (failure) return <><PageHeader title={k.newLabel} /><Alert>{failure.message}</Alert></>;
  if (editing && existing.data.status !== 'draft') {
    return (
      <>
        <PageHeader title={existing.data.referenceNo ?? k.singular} />
        <Alert tone="info">Only a draft can be edited. To change a posted document, void it and enter a new one.</Alert>
        <Button to={`${k.path}/${id}`} variant="secondary" className="mt-4">Back to the document</Button>
      </>
    );
  }

  return <DocumentForm kind={kind} editingId={editing ? id : null} existing={existing.data ?? null} initialContact={contact.data ?? null} settings={settings.data} />;
}

function DocumentForm({ kind, editingId, existing, initialContact, settings }) {
  const k = KINDS[kind];
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const day = useDayFormatter();
  const counter = useRef(0);
  const newKey = () => `line-${(counter.current += 1)}`;
  const blankLine = () => ({ key: newKey(), description: '', quantity: '1', unit: '', unitPrice: '', discount: '', taxable: false, taxRate: '' });

  const [contact, setContact] = useState(initialContact);
  const [txnDate, setTxnDate] = useState(existing?.txnDate ?? todayInNepal());
  const [dueDate, setDueDate] = useState(existing?.dueDate ?? '');
  const [externalRef, setExternalRef] = useState(existing?.externalRef ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [invoiceDiscount, setInvoiceDiscount] = useState(() => {
    if (!existing) return '';
    const total = existing.lines.reduce((sum, l) => sum + toPaisa(l.invoiceDiscountShare), 0n);
    return total > 0n ? fromPaisa(total) : '';
  });
  const [lines, setLines] = useState(() =>
    existing
      ? existing.lines.map((l) => ({
          key: newKey(), description: l.description, quantity: String(Number(l.quantity)), unit: l.unit ?? '', unitPrice: l.unitPrice,
          discount: Number(l.discount) ? l.discount : '', taxable: l.taxable, taxRate: l.taxable ? String(Number(l.taxRate)) : '',
        }))
      : [blankLine()],
  );

  const { isVatRegistered, defaultVatRate, defaultCreditDays } = settings.settings;
  const preview = previewDocument({ lines, invoiceDiscount }, { isVatRegistered, defaultVatRate });
  const creditDueHint = !dueDate && defaultCreditDays != null && txnDate ? addDays(txnDate, defaultCreditDays) : null;

  // What gets sent: only rows that were filled in. `sentRows` remembers which form row each one came from,
  // so a server message about "line 2" lands on the right input.
  const sentRows = lines.map((l, i) => i).filter((i) => !isBlankLine(lines[i]));
  const buildBody = () => ({
    contactId: contact.id,
    txnDate,
    ...(dueDate ? { dueDate } : editingId ? { dueDate: null } : {}),
    externalRef,
    notes,
    lines: sentRows.map((i) => {
      const l = lines[i];
      const taxable = isVatRegistered && l.taxable;
      return {
        description: l.description, quantity: l.quantity, unit: l.unit, unitPrice: l.unitPrice,
        ...(l.discount.trim() && { discount: l.discount }), taxable, ...(taxable && l.taxRate.trim() && { taxRate: l.taxRate }),
      };
    }),
    ...(invoiceDiscount.trim() && { invoiceDiscount }),
  });

  const save = useMutation({
    mutationFn: async (post) => {
      if (editingId) {
        await apiFetch(`${k.api}/${editingId}`, { method: 'PATCH', body: buildBody() });
        return post ? apiFetch(`${k.api}/${editingId}/post`, { method: 'POST' }) : apiFetch(`${k.api}/${editingId}`);
      }
      return apiFetch(k.api, { method: 'POST', body: { ...buildBody(), post } });
    },
    onSuccess: ({ data }) => {
      queryClient.invalidateQueries({ queryKey: [kind] });
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      queryClient.invalidateQueries({ queryKey: ['contact'] });
      queryClient.invalidateQueries({ queryKey: ['ledger'] });
      navigate(`${k.path}/${data.id}`);
    },
  });

  // Server messages: header fields by name, line fields as "lines.<n>.<field>" (n counts the rows that were sent).
  const flat = fieldErrors(save.error);
  const lineErrors = {};
  for (const [field, message] of Object.entries(flat)) {
    const m = /^lines\.(\d+)\.(\w+)$/.exec(field);
    if (m) (lineErrors[sentRows[Number(m[1])]] ??= {})[m[2]] = message;
  }
  const lineLevel = flat.lines;

  let after = null;
  if (contact?.balance && preview.ok && preview.totals.total > 0n) {
    const current = toPaisa(contact.balance.amount, { allowNegative: true });
    const next = k.effect === 'debit' ? current + preview.totals.total : current - preview.totals.total;
    after = describeBalanceAfter({ name: contact.name, balancePaisa: next, format: formatNPR });
  }
  const t = preview.ok ? preview.totals : null;
  const money = (v) => (t ? <Amount value={fromPaisa(v)} /> : '–');

  return (
    <>
      <PageHeader title={editingId ? `Edit draft ${k.singular.toLowerCase()}` : k.newLabel} />
      <form onSubmit={(e) => e.preventDefault()} noValidate className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {generalMessage(save.error) && !lineLevel && <Alert>{generalMessage(save.error)}</Alert>}

          <Card title="Details">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2"><ContactPicker label={k.partyLabel} value={contact} onChange={setContact} error={flat.contactId} autoFocus={!initialContact} /></div>
              <DateField label={kind === 'sale' ? 'Invoice date' : 'Bill date'} required value={txnDate} onChange={setTxnDate} error={flat.txnDate} />
              <div>
                <DateField label="Due date (optional)" value={dueDate} onChange={setDueDate} error={flat.dueDate} />
                {creditDueHint && <p className="-mt-3 text-xs text-slate-500">If left empty: due {day(creditDueHint)} ({defaultCreditDays} days)</p>}
              </div>
              <Field label={k.refLabel} hint={k.refHint} value={externalRef} onChange={(e) => setExternalRef(e.target.value)} error={flat.externalRef} className="sm:col-span-2" />
            </div>
          </Card>

          <Card title="Items">
            {lineLevel && <Alert className="mb-4">{lineLevel}</Alert>}
            <LinesEditor lines={lines} onChange={setLines} preview={preview} errors={lineErrors} isVatRegistered={isVatRegistered} defaultVatRate={defaultVatRate} newKey={newKey} />
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <Field label="Discount on the whole document" inputMode="decimal" placeholder="0.00" value={invoiceDiscount} onChange={(e) => setInvoiceDiscount(e.target.value)} error={flat.invoiceDiscount} hint="Spread over the items before VAT." />
            </div>
          </Card>

          <Card title="Notes">
            <label htmlFor="doc-notes" className="sr-only">Notes</label>
            <textarea id="doc-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-2 focus:outline-brand-600" />
            {flat.notes && <p className="mt-1 text-sm text-red-700">{flat.notes}</p>}
          </Card>
        </div>

        <aside aria-label="Document total" className="lg:col-span-1">
          <div className="space-y-4 lg:sticky lg:top-4">
            <Card title="Total">
              <dl className="space-y-2 text-sm" aria-label="Totals">
                <Row label="Subtotal" value={t && money(t.subtotal)} />
                <Row label="Discount" value={t && money(t.discount)} />
                {isVatRegistered && <Row label="Taxable amount" value={t && money(t.taxable)} />}
                {isVatRegistered && <Row label="Non-taxable amount" value={t && money(t.nonTaxable)} />}
                {isVatRegistered && <Row label="VAT" value={t && money(t.tax)} />}
                <div className="flex items-baseline justify-between border-t border-slate-200 pt-2 text-base font-semibold">
                  <dt>Total</dt>
                  <dd>{money(t?.total)}</dd>
                </div>
              </dl>
              {!preview.ok && <p className="mt-3 text-sm text-slate-500">{preview.message}</p>}
              {after && <p role="status" className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm font-medium text-slate-800">After posting: {after}.</p>}
              {contact && <p className="mt-2 text-xs text-slate-500">{k.afterPosting(contact.name)} A draft changes no balance.</p>}
            </Card>
            <div className="flex flex-wrap gap-3">
              <Button disabled={save.isPending || !contact || !preview.ok} onClick={() => save.mutate(true)}>{save.isPending ? 'Saving…' : 'Save and post'}</Button>
              <Button variant="secondary" disabled={save.isPending || !contact || !preview.ok} onClick={() => save.mutate(false)}>Save draft</Button>
              <Button variant="secondary" onClick={() => navigate(-1)}>Cancel</Button>
            </div>
            {!contact && <p className="text-xs text-slate-500">Choose a {k.partyLabel.toLowerCase()} to continue.</p>}
          </div>
        </aside>
      </form>
    </>
  );
}

const Row = ({ label, value }) => (
  <div className="flex items-baseline justify-between"><dt className="text-slate-600">{label}</dt><dd>{value || '–'}</dd></div>
);
