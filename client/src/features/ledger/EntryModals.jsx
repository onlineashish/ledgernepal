import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { DIRECTIONS } from '@ledgernepal/shared/ledger';
import { apiFetch } from '../../api/client.js';
import { DateField } from '../../components/DateField.jsx';
import { Modal } from '../../components/Modal.jsx';
import { Alert, Button, Field } from '../../components/ui.jsx';
import { formatAmount } from '../../lib/format.js';
import { fieldErrors, generalMessage } from '../../lib/formErrors.js';

const Reason = ({ value, onChange, error }) => (
  <Field label="Reason" required value={value} onChange={(e) => onChange(e.target.value)} error={error} hint="Kept in the history so anyone can see why it was changed." />
);

/** Cancels a posted entry. It stays in the history, marked voided, and stops counting toward balances. */
export function VoidEntryModal({ entry, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const mutation = useMutation({
    mutationFn: () => apiFetch(`/ledger/entries/${entry.id}/void`, { method: 'POST', body: { reason } }),
    onSuccess: onDone,
  });
  const errors = fieldErrors(mutation.error);
  return (
    <Modal title="Void this entry?" onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); mutation.mutate(); }} noValidate className="space-y-4">
        <p className="text-sm text-slate-700">
          {entry.referenceNo}: <strong>{formatAmount(entry.debit ?? entry.credit)}</strong>{entry.description ? ` · ${entry.description}` : ''}.
          It will stop counting toward the balance but stays in the history.
        </p>
        {generalMessage(mutation.error) && <Alert>{generalMessage(mutation.error)}</Alert>}
        <Reason value={reason} onChange={setReason} error={errors.reason} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Keep it</Button>
          <Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? 'Voiding…' : 'Void entry'}</Button>
        </div>
      </form>
    </Modal>
  );
}

/** Replaces a posted entry with a corrected one (the old one is voided and linked to the new). */
export function CorrectEntryModal({ entry, onClose, onDone }) {
  const wasDebit = entry.debit !== null && entry.debit !== undefined;
  const [form, setForm] = useState({
    txnDate: entry.txnDate,
    direction: wasDebit ? 'you_gave' : 'you_got',
    amount: wasDebit ? entry.debit : entry.credit,
    description: entry.description ?? '',
    reason: '',
  });
  const mutation = useMutation({
    mutationFn: () => apiFetch(`/ledger/entries/${entry.id}/correct`, { method: 'POST', body: form }),
    onSuccess: onDone,
  });
  const errors = fieldErrors(mutation.error);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <Modal title="Correct this entry" onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); mutation.mutate(); }} noValidate className="space-y-4">
        <p className="text-sm text-slate-700">
          The old entry ({entry.referenceNo}) is voided and a new one replaces it. Both stay in the history.
        </p>
        {generalMessage(mutation.error) && <Alert>{generalMessage(mutation.error)}</Alert>}
        <fieldset>
          <legend className="mb-1 block text-sm font-medium text-slate-700">What happened?</legend>
          <div className="flex gap-3">
            {Object.entries(DIRECTIONS).map(([key, { label, meaning }]) => (
              <label key={key} className="flex flex-1 cursor-pointer items-start gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50">
                <input type="radio" name="correct-direction" value={key} checked={form.direction === key} onChange={set('direction')} className="mt-1" />
                <span><span className="font-medium">{label}</span><span className="block text-xs text-slate-500">{meaning}</span></span>
              </label>
            ))}
          </div>
          {errors.direction && <p className="mt-1 text-sm text-red-700">{errors.direction}</p>}
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Amount (NPR)" inputMode="decimal" value={form.amount} onChange={set('amount')} error={errors.amount} />
          <DateField label="Transaction date" value={form.txnDate} onChange={(txnDate) => setForm((f) => ({ ...f, txnDate }))} error={errors.txnDate} required />
        </div>
        <Field label="Description" value={form.description} onChange={set('description')} error={errors.description} />
        <Reason value={form.reason} onChange={(reason) => setForm((f) => ({ ...f, reason }))} error={errors.reason} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? 'Saving…' : 'Save correction'}</Button>
        </div>
      </form>
    </Modal>
  );
}
