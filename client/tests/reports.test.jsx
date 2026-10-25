import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { baseRoutes, contact, fail, ledgerPayload, mockApi, ok, renderApp, sessionPayload } from './helpers.jsx';
import { posted, settingsPayload, settlement } from './fixtures.jsx';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const as = (roleKey, extra = {}) => baseRoutes(sessionPayload({ roleKey, ...extra }));

const dashboardData = (o = {}) => ({
  period: { from: '2025-07-17', to: '2026-07-16', fiscalYear: '2082/83' },
  sales: { total: '12000.00', tax: '0.00', count: 3 },
  purchases: { total: '5000.00', tax: '0.00', count: 1 },
  receipts: { total: '4000.00', tax: '0.00', count: 2 },
  payments: { total: '1000.00', tax: '0.00', count: 1 },
  receivables: { outstanding: '8000.00', contacts: 2, overdue: '1500.00', overdueCount: 1 },
  payables: { outstanding: '4000.00', contacts: 1, overdue: '0.00', overdueCount: 0 },
  recent: [{ id: 'r1', type: 'receipt', effect: 'credit', txnDate: '2025-08-10', referenceNo: 'RC-2082/83-0001', description: null, amount: '400.00', contact: { id: 'c1', name: 'Ram Bahadur' } }],
  ...o,
});

describe('the dashboard', () => {
  it('shows the figures for the period, balances today, and recent transactions with links', async () => {
    mockApi({ ...as('owner'), 'GET /reports/dashboard': ok(dashboardData()) });
    renderApp({ route: '/' });
    const totals = await screen.findByLabelText('Totals for the period');
    expect(within(totals).getByText('रु 12,000.00')).toBeInTheDocument();
    expect(within(totals).getByText('3 invoices')).toBeInTheDocument();
    expect(within(totals).getByText('रु 5,000.00')).toBeInTheDocument();
    const balances = screen.getByLabelText('Balances today');
    expect(within(balances).getByText('रु 8,000.00')).toBeInTheDocument();
    expect(within(balances).getByText('2 customers owe you')).toBeInTheDocument();
    expect(within(balances).getByText('1 overdue invoice')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'RC-2082/83-0001' })).toHaveAttribute('href', '/receipts-payments/receipts/r1');
    expect(screen.getByText(/fiscal year 2082\/83/)).toBeInTheDocument();
  });

  it('asks the server for another period when the dates change', async () => {
    const api = mockApi({ ...as('owner'), 'GET /reports/dashboard': ok(dashboardData()) });
    const user = userEvent.setup();
    renderApp({ route: '/' });
    await screen.findByLabelText('Totals for the period');
    await user.type(screen.getByLabelText('From'), '2082-04-20'); // typed in BS, sent as AD
    await waitFor(() => expect(api.lastCall('GET /reports/dashboard').query.get('from')).toMatch(/^2025-08-\d\d$/));
    expect(await screen.findByRole('button', { name: 'This fiscal year' })).toBeInTheDocument();
  });

  it('shows no balances to someone who may not see them, and no figures to someone without reports', async () => {
    mockApi({ ...as('viewer'), 'GET /reports/dashboard': ok(dashboardData({ receivables: null, payables: null })) });
    renderApp({ route: '/' });
    await screen.findByLabelText('Totals for the period');
    expect(screen.queryByLabelText('Balances today')).not.toBeInTheDocument();

    vi.unstubAllGlobals();
    const api = mockApi({ ...as('staff') });
    renderApp({ route: '/' });
    expect(await screen.findByText('Quick actions')).toBeInTheDocument();
    expect(api.calledWith('GET /reports/dashboard')).toHaveLength(0);
  });

  it('says so when the figures cannot be loaded', async () => {
    mockApi({ ...as('owner'), 'GET /reports/dashboard': fail(500, 'INTERNAL', 'Something went wrong') });
    renderApp({ route: '/' });
    expect(await screen.findByText('Something went wrong')).toBeInTheDocument();
  });
});

describe('the reports page', () => {
  const activity = {
    period: { from: '2025-07-17', to: '2026-07-16', fiscalYear: '2082/83' }, group: 'month',
    rows: [{ period: 'Shrawan 2082', sales: '1050.00', salesCount: 2, salesVat: '0.00', purchases: '500.00', purchasesCount: 1, purchasesVat: '0.00', receipts: '0.00', payments: '100.00' }],
    totals: { sales: '1050.00', purchases: '500.00', receipts: '0.00', payments: '100.00', salesVat: '0.00', purchasesVat: '0.00' },
  };

  it('opens on sales, purchases, receipts and payments, with totals, and can switch to days', async () => {
    const api = mockApi({ ...as('owner'), 'GET /reports/activity': ok(activity) });
    const user = userEvent.setup();
    renderApp({ route: '/reports' });
    const row = (await screen.findByText('Shrawan 2082')).closest('tr');
    expect(within(row).getByText('रु 1,050.00')).toBeInTheDocument();
    expect(within(screen.getAllByRole('row').at(-1)).getByText('Total')).toBeInTheDocument();
    expect(api.lastCall('GET /reports/activity').query.get('group')).toBe('month');
    await user.selectOptions(screen.getByLabelText('Group by'), 'day');
    await waitFor(() => expect(api.lastCall('GET /reports/activity').query.get('group')).toBe('day'));
  });

  it('lists who owes you with the overdue part, linking to each account', async () => {
    const api = mockApi({
      ...as('owner'),
      'GET /reports/outstanding': ok({ side: 'receivable', total: '1150.00', totalOverdue: '750.00', rows: [
        { contact: { id: 'c1', name: 'Ram Traders', phone: '9841000000' }, balance: '1100.00', overdue: '700.00' },
        { contact: { id: 'c2', name: 'Sita Stores', phone: null }, balance: '50.00', overdue: '0.00' },
      ] }),
    });
    const user = userEvent.setup();
    renderApp({ route: '/reports?tab=receivable' });
    expect(await screen.findByRole('link', { name: 'Ram Traders' })).toHaveAttribute('href', '/contacts/c1');
    expect(screen.getByText('9841000000')).toBeInTheDocument();
    expect(screen.getByText('रु 750.00')).toBeInTheDocument(); // total overdue
    await user.type(screen.getByLabelText('Search'), 'ram');
    await waitFor(() => expect(api.lastCall('GET /reports/outstanding').query.get('q')).toBe('ram'));
    expect(api.lastCall('GET /reports/outstanding').query.get('side')).toBe('receivable');
  });

  it('lists overdue invoices with days late, linking to the invoice', async () => {
    mockApi({
      ...as('owner'),
      'GET /reports/overdue': ok({ side: 'receivable', asOf: '2026-10-25', total: '700.00', rows: [
        { id: 'd1', referenceNo: 'SI-2082/83-0001', txnDate: '2025-08-05', dueDate: '2025-08-20', daysOverdue: 431, total: '1000.00', paid: '300.00', outstanding: '700.00', contact: { id: 'c1', name: 'Ram Traders', phone: null } },
      ] }),
    });
    renderApp({ route: '/reports?tab=overdue-receivable' });
    expect(await screen.findByRole('link', { name: 'SI-2082/83-0001' })).toHaveAttribute('href', '/sales/d1');
    expect(screen.getByText('431')).toBeInTheDocument();
    expect(screen.getAllByText('रु 700.00').length).toBeGreaterThan(0);
  });

  it('says so when nothing is overdue', async () => {
    mockApi({ ...as('owner'), 'GET /reports/overdue': ok({ side: 'payable', asOf: '2026-10-25', total: '0.00', rows: [] }) });
    renderApp({ route: '/reports?tab=overdue-payable' });
    expect(await screen.findByText('Nothing is overdue')).toBeInTheDocument();
  });

  it('hides the balance reports from someone without the ledger permission', async () => {
    mockApi({ ...baseRoutes(sessionPayload({ roleKey: 'viewer', permissions: ['business.view', 'reports.view'] })), 'GET /reports/activity': ok(activity) });
    renderApp({ route: '/reports?tab=receivable' });
    await screen.findByText('Shrawan 2082'); // fell back to the first report
    expect(screen.queryByRole('tab', { name: /Owed to you/ })).not.toBeInTheDocument();
  });

  it('is closed to staff', async () => {
    mockApi(as('staff'));
    renderApp({ route: '/reports' });
    expect(await screen.findByText('You do not have access to this page')).toBeInTheDocument();
  });
});

describe('downloading and printing', () => {
  // Gives the page a fetch that can also send a file, and records what the browser was asked to save.
  function withDownloads(routes) {
    const api = mockApi(routes);
    const json = globalThis.fetch;
    const downloads = [];
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      if (!String(url).includes('format=csv') && !String(url).includes('/export')) return json(url, init);
      downloads.push(String(url));
      const failing = routes.__csvFails;
      if (failing) return { ok: false, status: 403, json: async () => ({ error: { code: 'FORBIDDEN', message: 'You do not have permission to do this' } }), headers: new Headers() };
      return { ok: true, status: 200, headers: new Headers({ 'Content-Disposition': 'attachment; filename="outstanding-receivable.csv"' }), blob: async () => new Blob(['a,b']) };
    }));
    const saved = [];
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click() { saved.push(this.download); });
    return { api, downloads, saved };
  }
  const empty = { 'GET /reports/outstanding': ok({ side: 'receivable', total: '0.00', totalOverdue: '0.00', rows: [] }) };

  it('downloads the CSV of the report being viewed under the file name the server chose', async () => {
    const { downloads, saved } = withDownloads({ ...as('owner'), ...empty });
    const user = userEvent.setup();
    renderApp({ route: '/reports?tab=receivable' });
    await user.click(await screen.findByRole('button', { name: 'Download CSV' }));
    await waitFor(() => expect(saved).toEqual(['outstanding-receivable.csv']));
    expect(downloads[0]).toBe('/api/reports/outstanding?side=receivable&format=csv');
  });

  it('shows the server’s reason when a download is refused', async () => {
    const routes = { ...as('owner'), ...empty };
    routes.__csvFails = true;
    withDownloads(routes);
    const user = userEvent.setup();
    renderApp({ route: '/reports?tab=receivable' });
    await user.click(await screen.findByRole('button', { name: 'Download CSV' }));
    expect(await screen.findByText('You do not have permission to do this')).toBeInTheDocument();
  });

  it('a viewer, who may not export, gets neither Print nor CSV on reports', async () => {
    mockApi({ ...as('viewer'), ...empty });
    renderApp({ route: '/reports?tab=receivable' });
    await screen.findByText('Nobody owes you anything right now.');
    expect(screen.queryByRole('button', { name: 'Download CSV' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Print' })).not.toBeInTheDocument();
  });

  it('the contact account can be exported for the dates chosen', async () => {
    const { downloads } = withDownloads({ ...as('owner'), 'GET /contacts/c1': ok(contact()), 'GET /ledger/contacts/c1': ledgerPayload() });
    const user = userEvent.setup();
    renderApp({ route: '/contacts/c1' });
    await user.click(await screen.findByRole('button', { name: 'Download CSV' }));
    await waitFor(() => expect(downloads).toHaveLength(1));
    expect(downloads[0]).toBe('/api/ledger/contacts/c1/export?');
  });

  it('an invoice can be printed once posted, and carries the business details for the paper copy', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    mockApi({
      ...as('staff'),
      'GET /sales/d1': ok(posted()),
      'GET /settings': settingsPayload({ business: { name: 'Test Traders', address: 'Thamel, Kathmandu', panNumber: '123456789', vatNumber: '987654321' } }),
    });
    const user = userEvent.setup();
    renderApp({ route: '/sales/d1' });
    await user.click(await screen.findByRole('button', { name: 'Print' }));
    expect(print).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Thamel, Kathmandu')).toBeInTheDocument();
    expect(screen.getByText('PAN 123456789 · VAT 987654321')).toBeInTheDocument();
    expect(screen.getByText('Sales invoice SI-2082/83-0001')).toBeInTheDocument();
  });

  it('a draft has nothing to print yet', async () => {
    mockApi({ ...as('owner'), 'GET /sales/d1': ok(posted({ status: 'draft', referenceNo: null })), 'GET /settings': settingsPayload() });
    renderApp({ route: '/sales/d1' });
    await screen.findByText(/This is a draft/);
    expect(screen.queryByRole('button', { name: 'Print' })).not.toBeInTheDocument();
  });

  it('a receipt can be printed', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    mockApi({ ...as('staff'), 'GET /receipts/r1': ok(settlement()), 'GET /settings': settingsPayload() });
    const user = userEvent.setup();
    renderApp({ route: '/receipts-payments/receipts/r1' });
    await user.click(await screen.findByRole('button', { name: 'Print receipt' }));
    expect(print).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Received from: Ram Bahadur/)).toBeInTheDocument();
  });
});
