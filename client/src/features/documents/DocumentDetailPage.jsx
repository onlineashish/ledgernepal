import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fromPaisa, toPaisa } from '@ledgernepal/shared/money';
import { apiFetch } from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { PrintButton, PrintHeader } from '../../components/PrintTools.jsx';
import { Modal } from '../../components/Modal.jsx';
import { Amount } from '../../components/Money.jsx';
import { Alert, Badge, Button, Card, Field, PageHeader } from '../../components/ui.jsx';
import { fieldErrors, generalMessage } from '../../lib/formErrors.js';
import { useDayFormatter } from '../../lib/hooks.js';
import { KINDS, PAYMENT_STATUS_LABELS, PAYMENT_STATUS_TONES, STATUS_LABELS, STATUS_TONES } from './kinds.js';

// What was taken off a line: its own discount plus its share of the discount on the whole document.
const lineDiscount = (l) => toPaisa(l.discount) + toPaisa(l.invoiceDiscountShare);

export function DocumentDetailPage({ kind }) {
  const k = KINDS[kind];
  const { id } = useParams();
  const auth = useAuth();
  const day = useDayFormatter();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState(null); // 'post' | 'void' | 'notes'
  const [confirmDelete, setConfirmDelete] = useState(false);

  const doc = useQuery({ queryKey: [kind, id], queryFn: ({ signal }) => apiFetch(`${k.api}/${id}`, { signal }).then((r) => r.data) });
  const refresh = () => {
    setDialog(null);
    queryClient.invalidateQueries({ queryKey: [kind] });
    queryClient.invalidateQueries({ queryKey: ['contacts'] });
    queryClient.invalidateQueries({ queryKey: ['contact'] });
    queryClient.invalidateQueries({ queryKey: ['ledger'] });
  };
  const remove = useMutation({
    mutationFn: () => apiFetch(`${k.api}/${id}`, { method: 'DELETE' }),
    onSuccess: () => { refresh(); navigate(k.path, { replace: true }); },
  });

  if (doc.isPending) return <p className="text-sm text-slate-600">Loading…</p>;
  if (doc.isError) {
    return (
      <>
        <PageHeader title={`${k.singular} not found`} />
        <Alert>{doc.error.message}</Alert>
        <Button to={k.path} variant="secondary" className="mt-4">Back to {k.plural.toLowerCase()}</Button>
      </>
    );
  }

  const d = doc.data;
  const vat = d.lines.some((l) => l.taxable);
  const isDraft = d.status === 'draft';
  const isPosted = d.status === 'posted';

  return (
    <>
      {!isDraft && <PrintHeader title={`${k.singular} ${d.referenceNo}`} subtitle={`${k.partyLabel}: ${d.contact.name} · Date: ${day(d.txnDate)}`} />}
      <PageHeader
        title={d.referenceNo ?? `Draft ${k.singular.toLowerCase()}`}
        description={<span className="flex flex-wrap items-center gap-2"><Badge tone={STATUS_TONES[d.status]}>{STATUS_LABELS[d.status]}</Badge><span>{k.singular} for <Link to={`/contacts/${d.contact.id}`} className="font-medium text-brand-700 hover:underline">{d.contact.name}</Link></span></span>}
        actions={
          <>
            {!isDraft && <PrintButton />}
            {isDraft && auth.can(k.perms.create) && <Button onClick={() => setDialog('post')}>Post</Button>}
            {isDraft && auth.can(k.perms.update) && <Button to={`${k.path}/${d.id}/edit`} variant="secondary">Edit</Button>}
            {isDraft && auth.can(k.perms.update) && !confirmDelete && <Button variant="secondary" onClick={() => setConfirmDelete(true)}>Delete draft</Button>}
            {confirmDelete && (
              <>
                <Button onClick={() => remove.mutate()} disabled={remove.isPending}>Confirm delete</Button>
                <Button variant="secondary" onClick={() => setConfirmDelete(false)}>Cancel</Button>
              </>
            )}
            {isPosted && Number(d.outstanding) > 0 && auth.can(k.settle.perm) && <Button to={`${k.settle.path}?contactId=${d.contact.id}&documentId=${d.id}`}>{k.settle.label}</Button>}
            {isPosted && auth.can(k.perms.update) && <Button variant="secondary" onClick={() => setDialog('notes')}>Edit notes and reference</Button>}
            {isPosted && auth.can(k.perms.void) && <Button variant="secondary" onClick={() => setDialog('void')}>Void</Button>}
          </>
        }
      />
      {remove.error && <Alert className="mb-4">{remove.error.message}</Alert>}
      {d.status === 'voided' && <Alert tone="info" className="mb-4">Voided{d.voidedAt ? ` on ${day(d.voidedAt)}` : ''}: {d.voidReason}. It no longer counts toward the balance but stays on record.</Alert>}
      {isDraft && <Alert tone="info" className="mb-4">This is a draft. It has no number yet and does not change any balance until you post it.</Alert>}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Details" className="lg:col-span-2">
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <Detail label={kind === 'sale' ? 'Invoice date' : 'Bill date'} value={day(d.txnDate)} />
            <Detail label="Due date" value={d.dueDate ? day(d.dueDate) : '–'} />
            <Detail label={k.refLabel.replace(' (optional)', '')} value={d.externalRef} />
            <Detail label="Created by" value={d.createdBy?.fullName} />
            <Detail label="Notes" value={d.notes} className="sm:col-span-2" />
          </dl>
        </Card>
        <Card title="Total">
          <dl className="space-y-2 text-sm" aria-label="Totals">
            <Total label="Subtotal" value={d.totals.subtotal} />
            <Total label="Discount" value={d.totals.discount} />
            {vat && <Total label="Taxable amount" value={d.totals.taxable} />}
            {vat && <Total label="Non-taxable amount" value={d.totals.nonTaxable} />}
            {vat && <Total label="VAT" value={d.totals.tax} />}
            <div className="flex items-baseline justify-between border-t border-slate-200 pt-2 text-base font-semibold">
              <dt>Total</dt><dd><Amount value={d.totals.total} /></dd>
            </div>
            {isPosted && (
              <>
                <Total label="Paid" value={d.paid} />
                <div className="flex items-baseline justify-between font-medium"><dt>Outstanding</dt><dd><Amount value={d.outstanding} /></dd></div>
                <div className="flex flex-wrap gap-1 pt-1">
                  <Badge tone={PAYMENT_STATUS_TONES[d.paymentStatus]}>{PAYMENT_STATUS_LABELS[d.paymentStatus]}</Badge>
                  {d.overdue && <Badge tone="red">Overdue</Badge>}
                </div>
              </>
            )}
          </dl>
        </Card>
      </div>

      <Card title="Items" className="mt-6">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2 pr-3">#</th>
                <th className="py-2 pr-3">Item</th>
                <th className="py-2 pr-3 text-right">Quantity</th>
                <th className="py-2 pr-3 text-right">Unit price</th>
                <th className="py-2 pr-3 text-right">Discount</th>
                {vat && <th className="py-2 pr-3 text-right">VAT</th>}
                <th className="py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {d.lines.map((l) => (
                <tr key={l.lineNo}>
                  <td className="py-2 pr-3 text-slate-500">{l.lineNo}</td>
                  <td className="py-2 pr-3">{l.description}</td>
                  <td className="whitespace-nowrap py-2 pr-3 text-right">{Number(l.quantity)}{l.unit ? ` ${l.unit}` : ''}</td>
                  <td className="py-2 pr-3 text-right"><Amount value={l.unitPrice} /></td>
                  <td className="py-2 pr-3 text-right">{lineDiscount(l) > 0n ? <Amount value={fromPaisa(lineDiscount(l))} /> : '–'}</td>
                  {vat && <td className="whitespace-nowrap py-2 pr-3 text-right">{l.taxable ? <>{Number(l.taxRate)}% · <Amount value={l.taxAmount} /></> : '–'}</td>}
                  <td className="py-2 text-right font-medium"><Amount value={l.lineTotal} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {isPosted && (
        <Card title={kind === 'sale' ? 'Receipts applied' : 'Payments applied'} className="mt-6">
          {d.payments.length === 0 ? <p className="text-sm text-slate-600">Nothing has been {kind === 'sale' ? 'received' : 'paid'} against this yet.</p> : (
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-500"><tr><th className="py-2 pr-3">Number</th><th className="py-2 pr-3">Date</th><th className="py-2 text-right">Applied</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {d.payments.map((p) => (
                  <tr key={p.id}>
                    <td className="py-2 pr-3"><Link to={`/receipts-payments/${p.payment.type}s/${p.payment.id}`} className="font-medium text-brand-700 hover:underline">{p.payment.referenceNo}</Link></td>
                    <td className="py-2 pr-3">{day(p.payment.txnDate)}</td>
                    <td className="py-2 text-right"><Amount value={p.amount} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      <p className="mt-6 text-sm"><Link to={k.path} className="text-brand-600 hover:underline">← All {k.plural.toLowerCase()}</Link></p>

      {dialog === 'post' && <PostDialog k={k} d={d} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog === 'void' && <VoidDialog k={k} d={d} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog === 'notes' && <NotesDialog k={k} d={d} onClose={() => setDialog(null)} onDone={refresh} />}
    </>
  );
}

const Detail = ({ label, value, className = '' }) => (
  <div className={className}><dt className="text-xs text-slate-500">{label}</dt><dd className="whitespace-pre-line text-slate-900">{value || '–'}</dd></div>
);
const Total = ({ label, value }) => (
  <div className="flex items-baseline justify-between"><dt className="text-slate-600">{label}</dt><dd><Amount value={value} /></dd></div>
);

function PostDialog({ k, d, onClose, onDone }) {
  const mutation = useMutation({ mutationFn: () => apiFetch(`${k.api}/${d.id}/post`, { method: 'POST' }), onSuccess: onDone });
  return (
    <Modal title={`Post this ${k.singular.toLowerCase()}?`} onClose={onClose}>
      <p className="text-sm text-slate-700">
        It gets its number and counts toward {d.contact.name}&rsquo;s account. After posting, only the notes and reference can be edited; to change anything
        else you void it and enter a new one.
      </p>
      {mutation.error && <Alert className="mt-3">{generalMessage(mutation.error) ?? 'Could not post. Check the document.'}</Alert>}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Not yet</Button>
        <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>{mutation.isPending ? 'Posting…' : 'Post'}</Button>
      </div>
    </Modal>
  );
}

function VoidDialog({ k, d, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const mutation = useMutation({ mutationFn: () => apiFetch(`${k.api}/${d.id}/void`, { method: 'POST', body: { reason } }), onSuccess: onDone });
  const errors = fieldErrors(mutation.error);
  return (
    <Modal title={`Void ${d.referenceNo}?`} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); mutation.mutate(); }} noValidate className="space-y-4">
        <p className="text-sm text-slate-700">It stops counting toward {d.contact.name}&rsquo;s balance but stays on record, marked voided.</p>
        {generalMessage(mutation.error) && <Alert>{generalMessage(mutation.error)}</Alert>}
        <Field label="Reason" required value={reason} onChange={(e) => setReason(e.target.value)} error={errors.reason} hint="Kept in the history so anyone can see why." />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Keep it</Button>
          <Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? 'Voiding…' : 'Void'}</Button>
        </div>
      </form>
    </Modal>
  );
}

function NotesDialog({ k, d, onClose, onDone }) {
  const [form, setForm] = useState({ notes: d.notes ?? '', externalRef: d.externalRef ?? '' });
  const mutation = useMutation({ mutationFn: () => apiFetch(`${k.api}/${d.id}`, { method: 'PATCH', body: form }), onSuccess: onDone });
  const errors = fieldErrors(mutation.error);
  return (
    <Modal title="Edit notes and reference" onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); mutation.mutate(); }} noValidate className="space-y-4">
        {generalMessage(mutation.error) && <Alert>{generalMessage(mutation.error)}</Alert>}
        <Field label={k.refLabel.replace(' (optional)', '')} value={form.externalRef} onChange={(e) => setForm((f) => ({ ...f, externalRef: e.target.value }))} error={errors.externalRef} />
        <div>
          <label htmlFor="notes-edit" className="mb-1 block text-sm font-medium text-slate-700">Notes</label>
          <textarea id="notes-edit" rows={3} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          {errors.notes && <p className="mt-1 text-sm text-red-700">{errors.notes}</p>}
        </div>
        <p className="text-xs text-slate-500">Amounts, items and dates of a posted document cannot be changed.</p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? 'Saving…' : 'Save'}</Button>
        </div>
      </form>
    </Modal>
  );
}
