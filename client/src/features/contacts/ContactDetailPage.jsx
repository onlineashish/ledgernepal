import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { OPENING_SIDES } from '@ledgernepal/shared/ledger';
import { apiFetch } from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { Modal } from '../../components/Modal.jsx';
import { Amount, BalanceText } from '../../components/Money.jsx';
import { Alert, Badge, Button, Card, PageHeader } from '../../components/ui.jsx';
import { fieldErrors, generalMessage } from '../../lib/formErrors.js';
import { useDayFormatter } from '../../lib/hooks.js';
import { ContactLedger } from '../ledger/ContactLedger.jsx';
import { OpeningBalanceFields } from './ContactFormPage.jsx';
import { TypeBadges } from './ContactsPage.jsx';

export function ContactDetailPage() {
  const { id } = useParams();
  const auth = useAuth();
  const queryClient = useQueryClient();
  const [confirmArchive, setConfirmArchive] = useState(false);

  const contact = useQuery({ queryKey: ['contact', id], queryFn: ({ signal }) => apiFetch(`/contacts/${id}`, { signal }).then((r) => r.data) });
  const archive = useMutation({
    mutationFn: (archived) => apiFetch(`/contacts/${id}/${archived ? 'archive' : 'unarchive'}`, { method: 'POST' }),
    onSuccess: () => {
      setConfirmArchive(false);
      queryClient.invalidateQueries({ queryKey: ['contact', id] });
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
    },
  });

  if (contact.isPending) return <p className="text-sm text-slate-600">Loading…</p>;
  if (contact.isError) {
    return (
      <>
        <PageHeader title="Contact not found" />
        <Alert>{contact.error.message}</Alert>
        <Button to="/contacts" variant="secondary" className="mt-4">Back to contacts</Button>
      </>
    );
  }

  const c = contact.data;
  const isArchived = Boolean(c.archivedAt);
  return (
    <>
      <PageHeader
        title={c.name}
        description={<span className="flex flex-wrap items-center gap-2"><TypeBadges types={c.types} />{isArchived && <Badge>Archived</Badge>}</span>}
        actions={
          <>
            {auth.can('ledger.create') && !isArchived && <Button to={`/ledger/new?contactId=${c.id}`}>Add ledger entry</Button>}
            {auth.can('sales.create') && !isArchived && <Button to={`/sales/new?contactId=${c.id}`} variant='secondary'>New sales invoice</Button>}
            {auth.can('purchases.create') && !isArchived && <Button to={`/purchases/new?contactId=${c.id}`} variant='secondary'>Record purchase</Button>}
            {auth.can('receipts.create') && !isArchived && <Button to={`/receipts-payments/new-receipt?contactId=${c.id}`} variant="secondary">Record receipt</Button>}
            {auth.can('payments.create') && !isArchived && <Button to={`/receipts-payments/new-payment?contactId=${c.id}`} variant="secondary">Record payment</Button>}
            {auth.can('contacts.update') && <Button to={`/contacts/${c.id}/edit`} variant="secondary">Edit</Button>}
            {auth.can('contacts.archive') && !confirmArchive && (
              <Button variant="secondary" onClick={() => (isArchived ? archive.mutate(false) : setConfirmArchive(true))} disabled={archive.isPending}>
                {isArchived ? 'Unarchive' : 'Archive'}
              </Button>
            )}
            {confirmArchive && (
              <>
                <Button onClick={() => archive.mutate(true)} disabled={archive.isPending}>Confirm archive</Button>
                <Button variant="secondary" onClick={() => setConfirmArchive(false)}>Cancel</Button>
              </>
            )}
          </>
        }
      />
      {archive.error && <Alert className="mb-4">{archive.error.message}</Alert>}
      {confirmArchive && <Alert tone="info" className="mb-4">Archived contacts are hidden from lists and cannot get new entries. Their history is kept, and you can unarchive them anytime.</Alert>}

      <div className="grid gap-6 lg:grid-cols-3">
        {auth.can('ledger.view') && (
          <Card title="Balance" className="lg:col-span-1">
            <p className="text-lg"><BalanceText balance={c.balance} name={c.name} /></p>
            <p className="mt-1 text-xs text-slate-500">Calculated from all entries. A negative balance means you owe them.</p>
          </Card>
        )}
        <Card title="Details" className={auth.can('ledger.view') ? 'lg:col-span-2' : 'lg:col-span-3'}>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <Detail label="Phone" value={c.phone} />
            <Detail label="Email" value={c.email} />
            <Detail label="Address" value={c.address} />
            <Detail label="PAN" value={c.panNumber} />
            <Detail label="VAT number" value={c.vatNumber} />
            <Detail label="Notes" value={c.notes} />
          </dl>
        </Card>
      </div>

      {auth.can('ledger.view') && (
        <>
          <div className="mt-6"><OpeningBalanceCard contactId={c.id} opening={c.openingBalance} archived={isArchived} /></div>
          <div className="mt-6"><ContactLedger contactId={c.id} archived={isArchived} /></div>
        </>
      )}
      <p className="mt-6 text-sm"><Link to="/contacts" className="text-brand-600 hover:underline">← All contacts</Link></p>
    </>
  );
}

const Detail = ({ label, value }) => (
  <div>
    <dt className="text-xs text-slate-500">{label}</dt>
    <dd className="whitespace-pre-line text-slate-900">{value || '–'}</dd>
  </div>
);

function OpeningBalanceCard({ contactId, opening, archived }) {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const day = useDayFormatter();
  const [dialog, setDialog] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const refresh = () => {
    setDialog(false);
    setConfirmRemove(false);
    queryClient.invalidateQueries({ queryKey: ['contact', contactId] });
    queryClient.invalidateQueries({ queryKey: ['ledger'] });
    queryClient.invalidateQueries({ queryKey: ['contacts'] });
  };
  const remove = useMutation({ mutationFn: () => apiFetch(`/contacts/${contactId}/opening-balance`, { method: 'DELETE' }), onSuccess: refresh });
  // The first one needs "add entries"; changing or removing needs "correct the ledger" (the server checks too).
  const canSet = auth.can('ledger.create') && !archived && (!opening || auth.can('ledger.correct'));
  const canRemove = opening && auth.can('ledger.correct') && !archived;

  return (
    <Card title="Opening balance">
      {opening ? (
        <p className="text-sm text-slate-700">
          <strong><Amount value={opening.amount} /></strong>{' '}
          {OPENING_SIDES[opening.side].label.toLowerCase()}, as of {day(opening.asOfDate)} ({opening.referenceNo}).
        </p>
      ) : (
        <p className="text-sm text-slate-600">None. Use this for money owed before you started using LedgerNepal.</p>
      )}
      {remove.error && <Alert className="mt-3">{remove.error.message}</Alert>}
      <div className="mt-3 flex flex-wrap gap-2">
        {canSet && <Button variant="secondary" onClick={() => setDialog(true)}>{opening ? 'Change opening balance' : 'Add opening balance'}</Button>}
        {canRemove && !confirmRemove && <Button variant="secondary" onClick={() => setConfirmRemove(true)}>Remove</Button>}
        {confirmRemove && (
          <>
            <Button onClick={() => remove.mutate()} disabled={remove.isPending}>Confirm remove</Button>
            <Button variant="secondary" onClick={() => setConfirmRemove(false)}>Cancel</Button>
          </>
        )}
      </div>
      {dialog && <OpeningBalanceDialog contactId={contactId} current={opening} onClose={() => setDialog(false)} onDone={refresh} />}
    </Card>
  );
}

function OpeningBalanceDialog({ contactId, current, onClose, onDone }) {
  const [value, setValue] = useState({ amount: current?.amount ?? '', side: current?.side ?? 'they_owe_me', asOfDate: current?.asOfDate ?? '' });
  const mutation = useMutation({
    mutationFn: () => apiFetch(`/contacts/${contactId}/opening-balance`, {
      method: 'PUT',
      body: { amount: value.amount, side: value.side, ...(value.asOfDate && { asOfDate: value.asOfDate }) },
    }),
    onSuccess: onDone,
  });
  const errors = fieldErrors(mutation.error);
  return (
    <Modal title={current ? 'Change opening balance' : 'Add opening balance'} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); mutation.mutate(); }} noValidate className="space-y-4">
        {current && <p className="text-sm text-slate-600">The current opening balance is voided and replaced; both stay in the history.</p>}
        {generalMessage(mutation.error) && <Alert>{generalMessage(mutation.error)}</Alert>}
        <OpeningBalanceFields value={value} onChange={setValue} errors={errors} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? 'Saving…' : 'Save'}</Button>
        </div>
      </form>
    </Modal>
  );
}
