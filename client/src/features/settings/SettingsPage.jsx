import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { Alert, Button, Card, Field, PageHeader } from '../../components/ui.jsx';
import { fieldErrors, generalMessage } from '../../lib/formErrors.js';
import { useSettings } from './useSettings.js';

const PREFIX_LABELS = [
  ['sale', 'Sales invoices'], ['purchase', 'Purchase bills'], ['receipt', 'Receipts'],
  ['payment', 'Payments'], ['ledgerEntry', 'Ledger entries'], ['openingBalance', 'Opening balances'],
];

export function SettingsPage() {
  const auth = useAuth();
  const settings = useSettings();
  if (settings.isPending) return <p className="text-sm text-slate-600">Loading…</p>;
  if (settings.isError) return <Alert>{settings.error.message}</Alert>;
  return (
    <>
      <PageHeader title="Settings" description="Your business details, tax, dates and numbering." />
      <div className="space-y-6">
        <ProfileCard business={settings.data.business} canEdit={auth.can('business.update')} />
        <BusinessSettingsCard settings={settings.data.settings} canEdit={auth.can('settings.manage')} />
      </div>
    </>
  );
}

/** Saves, then refreshes what depends on it: these settings, and the session (business name, date preference). */
function useSave(path, onSaved) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) => apiFetch(path, { method: 'PATCH', body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      queryClient.invalidateQueries({ queryKey: ['me'] });
      onSaved();
    },
  });
}

const ReadOnlyNote = () => (
  <p className="mb-4 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">You can view this but not change it. Ask the owner or an administrator.</p>
);

function ProfileCard({ business, canEdit }) {
  const [form, setForm] = useState({
    name: business.name, legalName: business.legalName ?? '', address: business.address ?? '', phone: business.phone ?? '',
    email: business.email ?? '', panNumber: business.panNumber ?? '', vatNumber: business.vatNumber ?? '',
  });
  const [saved, setSaved] = useState(false);
  const save = useSave('/businesses/current', () => setSaved(true));
  const errors = fieldErrors(save.error);
  const set = (key) => (e) => { setSaved(false); setForm((f) => ({ ...f, [key]: e.target.value })); };

  return (
    <Card title="Business details">
      {!canEdit && <ReadOnlyNote />}
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(form); }} noValidate>
        <fieldset disabled={!canEdit || save.isPending} className="grid gap-4 sm:grid-cols-2">
          {generalMessage(save.error) && <div className="sm:col-span-2"><Alert>{generalMessage(save.error)}</Alert></div>}
          {saved && <div className="sm:col-span-2"><Alert tone="success">Business details saved.</Alert></div>}
          <Field label="Business name" required value={form.name} onChange={set('name')} error={errors.name} className="sm:col-span-2" />
          <Field label="Legal name" value={form.legalName} onChange={set('legalName')} error={errors.legalName} hint="As registered, if different." />
          <Field label="Phone" value={form.phone} onChange={set('phone')} error={errors.phone} inputMode="tel" />
          <Field label="Address" value={form.address} onChange={set('address')} error={errors.address} className="sm:col-span-2" />
          <Field label="Email" type="email" value={form.email} onChange={set('email')} error={errors.email} />
          <div />
          <Field label="PAN number" value={form.panNumber} onChange={set('panNumber')} error={errors.panNumber} />
          <Field label="VAT registration number" value={form.vatNumber} onChange={set('vatNumber')} error={errors.vatNumber} hint="Only if you are registered for VAT." />
          {canEdit && <div className="sm:col-span-2"><Button type="submit">{save.isPending ? 'Saving…' : 'Save details'}</Button></div>}
        </fieldset>
      </form>
    </Card>
  );
}

function BusinessSettingsCard({ settings, canEdit }) {
  const [form, setForm] = useState({
    dateDisplay: settings.dateDisplay,
    isVatRegistered: settings.isVatRegistered,
    defaultVatRate: settings.defaultVatRate === null ? '' : String(Number(settings.defaultVatRate)),
    defaultCreditDays: settings.defaultCreditDays === null ? '' : String(settings.defaultCreditDays),
    invoiceFooter: settings.invoiceFooter ?? '',
    prefixes: { ...settings.prefixes },
  });
  const [saved, setSaved] = useState(false);
  const save = useSave('/settings', () => setSaved(true));
  const errors = fieldErrors(save.error);
  const set = (patch) => { setSaved(false); setForm((f) => ({ ...f, ...patch })); };

  const submit = () =>
    save.mutate({
      dateDisplay: form.dateDisplay,
      isVatRegistered: form.isVatRegistered,
      defaultVatRate: form.defaultVatRate.trim() === '' ? null : form.defaultVatRate.trim(),
      defaultCreditDays: form.defaultCreditDays.trim() === '' ? null : Number(form.defaultCreditDays),
      invoiceFooter: form.invoiceFooter,
      prefixes: form.prefixes,
    });

  return (
    <Card title="Tax, dates and numbering">
      {!canEdit && <ReadOnlyNote />}
      <form onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
        <fieldset disabled={!canEdit || save.isPending} className="space-y-6">
          {generalMessage(save.error) && <Alert>{generalMessage(save.error)}</Alert>}
          {saved && <Alert tone="success">Settings saved.</Alert>}

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-slate-700">Show dates in</legend>
            <div className="flex gap-3">
              {[['BS', 'Bikram Sambat (BS)'], ['AD', 'Gregorian (AD)']].map(([value, label]) => (
                <label key={value} className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50">
                  <input type="radio" name="dateDisplay" value={value} checked={form.dateDisplay === value} onChange={() => set({ dateDisplay: value })} />
                  {label}
                </label>
              ))}
            </div>
            <p className="text-xs text-slate-500">You can type a date in either calendar anywhere; this only decides how dates are shown.</p>
          </fieldset>

          <fieldset className="space-y-3">
            <legend className="text-sm font-medium text-slate-700">VAT</legend>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.isVatRegistered} onChange={(e) => set({ isVatRegistered: e.target.checked })} />
              My business is registered for VAT
            </label>
            <Field label="Default VAT rate (%)" inputMode="decimal" className="max-w-xs" value={form.defaultVatRate} onChange={(e) => set({ defaultVatRate: e.target.value })} error={errors.defaultVatRate} hint="No rate is assumed. Enter the rate that applies to your business; each item can use a different one." />
            <p className="text-xs text-slate-500">Documents show taxable amount, VAT and total separately. This is bookkeeping, not tax filing.</p>
          </fieldset>

          <Field label="Default credit days" inputMode="numeric" className="max-w-xs" value={form.defaultCreditDays} onChange={(e) => set({ defaultCreditDays: e.target.value })} error={errors.defaultCreditDays} hint="Used for the due date when a document has none. Leave empty for no due date." />

          <fieldset className="space-y-3">
            <legend className="text-sm font-medium text-slate-700">Number prefixes</legend>
            <div className="grid gap-4 sm:grid-cols-3">
              {PREFIX_LABELS.map(([key, label]) => (
                <Field key={key} label={label} value={form.prefixes[key]} onChange={(e) => set({ prefixes: { ...form.prefixes, [key]: e.target.value } })} error={errors[`prefixes.${key}`]} maxLength={6} />
              ))}
            </div>
            <p className="text-xs text-slate-500">Numbers look like SI-2082/83-0001. A new prefix applies to new documents only.</p>
          </fieldset>

          <div>
            <label htmlFor="invoice-footer" className="mb-1 block text-sm font-medium text-slate-700">Text at the bottom of invoices</label>
            <textarea id="invoice-footer" rows={2} value={form.invoiceFooter} onChange={(e) => set({ invoiceFooter: e.target.value })} className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            {errors.invoiceFooter && <p className="mt-1 text-sm text-red-700">{errors.invoiceFooter}</p>}
          </div>

          {canEdit && <Button type="submit">{save.isPending ? 'Saving…' : 'Save settings'}</Button>}
        </fieldset>
      </form>
    </Card>
  );
}
