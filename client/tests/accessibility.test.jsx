import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import axe from 'axe-core';
import { baseRoutes, contact, ledgerPayload, mockApi, ok, paged, renderApp, sessionPayload } from './helpers.jsx';
import { listRow, openDoc, posted, settingsPayload, settlement } from './fixtures.jsx';

// Automated accessibility checks (axe-core: labels, roles, names, landmarks, ARIA use) on the main screens.
// jsdom has no layout, so colour contrast and responsive behaviour are NOT covered here; they need a real browser.

afterEach(() => vi.unstubAllGlobals());

const owner = baseRoutes(sessionPayload({ roleKey: 'owner' }));

async function violations(container) {
  const result = await axe.run(container, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } });
  return result.violations.map((v) => `${v.id}: ${v.help} -> ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
}

const dashboard = {
  period: { from: '2025-07-17', to: '2026-07-16', fiscalYear: '2082/83' },
  sales: { total: '100.00', tax: '0.00', count: 1 }, purchases: { total: '0.00', tax: '0.00', count: 0 },
  receipts: { total: '0.00', tax: '0.00', count: 0 }, payments: { total: '0.00', tax: '0.00', count: 0 },
  receivables: { outstanding: '100.00', contacts: 1, overdue: '0.00', overdueCount: 0 },
  payables: { outstanding: '0.00', contacts: 0, overdue: '0.00', overdueCount: 0 },
  recent: [{ id: 'r1', type: 'sale', effect: 'debit', txnDate: '2025-08-10', referenceNo: 'SI-2082/83-0001', description: null, amount: '100.00', contact: { id: 'c1', name: 'Ram' } }],
};

const PAGES = [
  ['dashboard', '/', { 'GET /reports/dashboard': ok(dashboard) }, 'Recent transactions'],
  ['sales list', '/sales', { 'GET /sales': paged([listRow({ id: 'a', status: 'posted', referenceNo: 'SI-1' })]) }, 'SI-1'],
  ['new sales invoice', '/sales/new', { 'GET /settings': settingsPayload() }, 'Save draft'],
  ['sales invoice', '/sales/d1', { 'GET /sales/d1': ok(posted()), 'GET /settings': settingsPayload() }, 'Items'],
  ['contacts', '/contacts', { 'GET /contacts': paged([contact()]) }, 'Ram Bahadur'],
  ['contact account', '/contacts/c1', { 'GET /contacts/c1': ok(contact()), 'GET /ledger/contacts/c1': ledgerPayload() }, 'Ledger'],
  ['add ledger entry', '/ledger/new', {}, 'Save entry'],
  ['receipts', '/receipts-payments', { 'GET /receipts': paged([settlement()]), 'GET /payments': paged([]) }, 'RC-2082/83-0001'],
  ['record receipt', '/receipts-payments/new-receipt?contactId=c1', { 'GET /contacts/c1': ok(contact()), 'GET /receipts/open-documents': ok([openDoc()]) }, 'Apply oldest first'],
  ['receipt', '/receipts-payments/receipts/r1', { 'GET /receipts/r1': ok(settlement()), 'GET /settings': settingsPayload() }, 'Advance (not applied)'],
  ['reports', '/reports', { 'GET /reports/activity': ok({ period: dashboard.period, group: 'month', rows: [], totals: { sales: '0.00', purchases: '0.00', receipts: '0.00', payments: '0.00', salesVat: '0.00', purchasesVat: '0.00' } }) }, 'Nothing recorded in this period'],
  ['settings', '/settings', { 'GET /settings': settingsPayload() }, 'Business details'],
];

describe('accessibility (axe-core)', () => {
  it.each(PAGES)('%s has no detectable violations', async (_name, route, routes, ready) => {
    mockApi({ ...owner, ...routes });
    const { container } = renderApp({ route });
    await waitFor(() => expect(screen.queryAllByText(ready, { exact: false }).length + screen.queryAllByRole('button', { name: ready }).length + screen.queryAllByRole('link', { name: ready }).length).toBeGreaterThan(0), { timeout: 4000 });
    expect(await violations(container)).toEqual([]);
  }, 15_000);
});
