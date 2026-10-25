import { useState } from 'react';
import { downloadFile } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { useSettings } from '../features/settings/useSettings.js';
import { Alert, Button } from './ui.jsx';

/**
 * The business details at the top of a printed page (name, address, PAN / VAT number). Invisible on screen.
 * `title` is what the page is, e.g. "Sales invoice SI-2082/83-0001".
 */
export function PrintHeader({ title, subtitle }) {
  const auth = useAuth();
  const { data } = useSettings();
  const business = data?.business;
  const lines = [business?.address, business?.phone, business?.email].filter(Boolean).join(' · ');
  const ids = [business?.panNumber && `PAN ${business.panNumber}`, business?.vatNumber && `VAT ${business.vatNumber}`].filter(Boolean).join(' · ');
  return (
    <div className="print-only mb-4 border-b border-slate-400 pb-3">
      <p className="text-xl font-semibold">{business?.legalName || business?.name || auth.activeBusiness?.name}</p>
      {lines && <p className="text-sm">{lines}</p>}
      {ids && <p className="text-sm">{ids}</p>}
      {title && <p className="mt-2 text-lg font-semibold">{title}</p>}
      {subtitle && <p className="text-sm">{subtitle}</p>}
    </div>
  );
}

/** A Print button (the browser's print dialog, which also saves as PDF). */
export function PrintButton({ label = 'Print' }) {
  return <Button variant="secondary" onClick={() => window.print()}>{label}</Button>;
}

/**
 * Print and "Download CSV" for a report or ledger. Only for people who may export (reports.export).
 * `csvPath` is the API path with ?format=csv already in it.
 */
export function ExportActions({ csvPath }) {
  const auth = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  if (!auth.can('reports.export')) return null;

  async function download() {
    setBusy(true);
    setError(null);
    try {
      await downloadFile(csvPath);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="no-print">
      <div className="flex flex-wrap gap-2">
        <PrintButton />
        {csvPath && <Button variant="secondary" onClick={download} disabled={busy}>{busy ? 'Preparing…' : 'Download CSV'}</Button>}
      </div>
      {error && <Alert className="mt-2">{error}</Alert>}
    </div>
  );
}
