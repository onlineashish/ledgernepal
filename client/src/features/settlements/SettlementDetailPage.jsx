import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { PrintButton, PrintHeader } from '../../components/PrintTools.jsx';
import { Modal } from '../../components/Modal.jsx';
import { Amount } from '../../components/Money.jsx';
import { Alert, Badge, Button, Card, Field, PageHeader } from '../../components/ui.jsx';
import { fieldErrors, generalMessage } from '../../lib/formErrors.js';
import { useDayFormatter } from '../../lib/hooks.js';
import { METHOD_LABELS, SETTLEMENTS } from './kinds.js';

/** One receipt or payment: what it is, which invoices or bills it pays, and what can still be done to it. */
export function SettlementDetailPage({ kind }) {
  const k = SETTLEMENTS[kind];
  const { id } = useParams();
  const auth = useAuth();
  const day = useDayFormatter();
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState(null); // 'void' | 'notes'

  const item = useQuery({ queryKey: [kind, id], queryFn: ({ signal }) => apiFetch(`${k.api}/${id}`, { signal }).then((r) => r.data) });
  const refresh = () => {
    setDialog(null);
    for (const key of [[kind], ['sale'], ['purchase'], ['contacts'], ['contact'], ['ledger']]) queryClient.invalidateQueries({ queryKey: key });
  };
  const apply = useMutation({ mutationFn: () => apiFetch(`${k.api}/${id}/auto-allocate`, { method: 'POST' }), onSuccess: refresh });

  if (item.isPending) return <p className="text-sm text-slate-600">Loading…</p>;
  if (item.isError) {
    return (
      <>
        <PageHeader title={`${k.singular} not found`} />
        <Alert>{item.error.message}</Alert>
        <Button to="/receipts-payments" variant="secondary" className="mt-4">Back to receipts &amp; payments</Button>
      </>
    );
  }

  const s = item.data;
  const posted = s.status === 'posted';
  const hasAdvance = posted && Number(s.unallocated) > 0;

  return (
    <>
      {posted && <PrintHeader title={`${k.singular} ${s.referenceNo}`} subtitle={`${kind === 'receipt' ? 'Received from' : 'Paid to'}: ${s.contact.name} · Date: ${day(s.txnDate)}`} />}
      <PageHeader
        title={s.referenceNo}
        description={<span className="flex flex-wrap items-center gap-2">{s.status === 'voided' && <Badge tone="red">Voided</Badge>}<span>{k.singular} {kind === 'receipt' ? 'from' : 'to'} <Link to={`/contacts/${s.contact.id}`} className="font-medium text-brand-700 hover:underline">{s.contact.name}</Link></span></span>}
        actions={
          <>
            {posted && <PrintButton label={`Print ${k.singular.toLowerCase()}`} />}
            {hasAdvance && auth.can(k.perms.create) && <Button variant="secondary" onClick={() => apply.mutate()} disabled={apply.isPending}>{apply.isPending ? 'Applying…' : 'Apply advance to open documents'}</Button>}
            {posted && auth.can(k.perms.create) && <Button variant="secondary" onClick={() => setDialog('notes')}>Edit notes and reference</Button>}
            {posted && auth.can(k.perms.void) && <Button variant="secondary" onClick={() => setDialog('void')}>Void</Button>}
          </>
        }
      />
      {apply.error && <Alert className="mb-4">{apply.error.message}</Alert>}
      {s.status === 'voided' && <Alert tone="info" className="mb-4">Voided{s.voidedAt ? ` on ${day(s.voidedAt)}` : ''}: {s.voidReason}. It no longer counts toward the balance but stays on record.</Alert>}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Details" className="lg:col-span-2">
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <Detail label="Date" value={day(s.txnDate)} />
            <Detail label="Method" value={METHOD_LABELS[s.method] ?? s.method} />
            <Detail label="Cheque / transaction number" value={s.externalRef} />
            <Detail label="Recorded by" value={s.createdBy?.fullName} />
            <Detail label="Description" value={s.description} className="sm:col-span-2" />
            <Detail label="Notes" value={s.notes} className="sm:col-span-2" />
          </dl>
        </Card>
        <Card title="Amount">
          <dl className="space-y-2 text-sm">
            <div className="flex items-baseline justify-between text-base font-semibold"><dt>Total</dt><dd><Amount value={s.amount} /></dd></div>
            {posted && <div className="flex items-baseline justify-between"><dt className="text-slate-600">Applied to documents</dt><dd><Amount value={s.allocated} /></dd></div>}
            {posted && <div className="flex items-baseline justify-between"><dt className="text-slate-600">Advance (not applied)</dt><dd><Amount value={s.unallocated} /></dd></div>}
          </dl>
        </Card>
      </div>

      <Card title={`Applied to ${k.documentNoun}s`} className="mt-6">
        {s.allocations.length === 0 ? (
          <p className="text-sm text-slate-600">{posted ? 'Not applied to any document. The money is held as an advance on the account.' : 'Nothing is applied; this was voided.'}</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr><th className="py-2 pr-3">Document</th><th className="py-2 pr-3">Date</th><th className="py-2 pr-3 text-right">Document total</th><th className="py-2 text-right">Applied</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {s.allocations.map((a) => (
                <tr key={a.id}>
                  <td className="py-2 pr-3"><Link to={`${k.documentsPath}/${a.document.id}`} className="font-medium text-brand-700 hover:underline">{a.document.referenceNo}</Link></td>
                  <td className="py-2 pr-3">{day(a.document.txnDate)}</td>
                  <td className="py-2 pr-3 text-right"><Amount value={a.document.total} /></td>
                  <td className="py-2 text-right font-medium"><Amount value={a.amount} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <p className="mt-6 text-sm"><Link to="/receipts-payments" className="text-brand-600 hover:underline">← All receipts &amp; payments</Link></p>

      {dialog === 'void' && <VoidDialog k={k} s={s} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog === 'notes' && <NotesDialog k={k} s={s} onClose={() => setDialog(null)} onDone={refresh} />}
    </>
  );
}

const Detail = ({ label, value, className = '' }) => (
  <div className={className}><dt className="text-xs text-slate-500">{label}</dt><dd className="whitespace-pre-line text-slate-900">{value || '–'}</dd></div>
);

function VoidDialog({ k, s, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const mutation = useMutation({ mutationFn: () => apiFetch(`${k.api}/${s.id}/void`, { method: 'POST', body: { reason } }), onSuccess: onDone });
  const errors = fieldErrors(mutation.error);
  return (
    <Modal title={`Void ${s.referenceNo}?`} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); mutation.mutate(); }} noValidate className="space-y-4">
        <p className="text-sm text-slate-700">
          It stops counting toward {s.contact.name}&rsquo;s balance but stays on record, marked voided.
          {s.allocations.length > 0 && ` The ${k.documentNoun}s it paid become unpaid again.`}
        </p>
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

function NotesDialog({ k, s, onClose, onDone }) {
  const [form, setForm] = useState({ description: s.description ?? '', notes: s.notes ?? '', externalRef: s.externalRef ?? '' });
  const mutation = useMutation({ mutationFn: () => apiFetch(`${k.api}/${s.id}`, { method: 'PATCH', body: form }), onSuccess: onDone });
  const errors = fieldErrors(mutation.error);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  return (
    <Modal title="Edit notes and reference" onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); mutation.mutate(); }} noValidate className="space-y-4">
        {generalMessage(mutation.error) && <Alert>{generalMessage(mutation.error)}</Alert>}
        <Field label="Cheque / transaction number" value={form.externalRef} onChange={set('externalRef')} error={errors.externalRef} />
        <Field label="Description" value={form.description} onChange={set('description')} error={errors.description} />
        <div>
          <label htmlFor="st-notes" className="mb-1 block text-sm font-medium text-slate-700">Notes</label>
          <textarea id="st-notes" rows={3} value={form.notes} onChange={set('notes')} className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          {errors.notes && <p className="mt-1 text-sm text-red-700">{errors.notes}</p>}
        </div>
        <p className="text-xs text-slate-500">The amount, date and method cannot be changed. To correct them, void this and record a new one.</p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? 'Saving…' : 'Save'}</Button>
        </div>
      </form>
    </Modal>
  );
}
