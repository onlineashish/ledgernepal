import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from '../src/app/App.jsx';

function renderApp(path = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const stubHealth = (response) => vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
const healthyResponse = { ok: true, status: 200, json: async () => ({ data: { status: 'ok', database: 'ok' } }) };

afterEach(() => vi.unstubAllGlobals());

describe('navigation', () => {
  it('shows all eight main sections in the sidebar', () => {
    stubHealth(healthyResponse);
    renderApp();
    const nav = screen.getByRole('navigation', { name: /main navigation/i });
    for (const label of ['Dashboard', 'Contacts', 'Sales', 'Purchases', 'Receipts & Payments', 'Ledger', 'Reports', 'Settings']) {
      expect(within(nav).getByRole('link', { name: label })).toBeInTheDocument();
    }
  });

  it('offers View Ledger and Add Ledger Entry inside the Ledger section', () => {
    stubHealth(healthyResponse);
    renderApp('/ledger');
    const nav = screen.getByRole('navigation', { name: /main navigation/i });
    expect(within(nav).getByRole('link', { name: 'View Ledger' })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Add Ledger Entry' })).toBeInTheDocument();
  });

  it('navigates between pages without a reload', async () => {
    stubHealth(healthyResponse);
    renderApp();
    await userEvent.click(within(screen.getByRole('navigation')).getByRole('link', { name: 'Contacts' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Contacts' })).toBeInTheDocument();
  });

  it('shows a not-found page for unknown URLs', () => {
    stubHealth(healthyResponse);
    renderApp('/definitely/not/a/page');
    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();
  });

  it('is honest that unbuilt pages are not connected yet', () => {
    stubHealth(healthyResponse);
    renderApp('/sales');
    expect(screen.getByText(/nothing on this page is connected yet/i)).toBeInTheDocument();
  });
});

describe('dashboard', () => {
  it('links every quick action required by the requirements', () => {
    stubHealth(healthyResponse);
    renderApp();
    for (const label of ['Add Contact', 'Add Ledger Entry', 'Create Sales Invoice', 'Record Purchase', 'Record Receipt', 'Record Payment']) {
      expect(screen.getAllByRole('link', { name: label }).length).toBeGreaterThan(0);
    }
  });

  it('shows the real server status when the API is up', async () => {
    stubHealth(healthyResponse);
    renderApp();
    expect(await screen.findByText(/server and database are connected/i)).toBeInTheDocument();
  });

  it('shows an error state when the API reports a problem', async () => {
    stubHealth({ ok: false, status: 503, json: async () => ({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Database is not reachable' } }) });
    renderApp();
    expect(await screen.findByRole('alert')).toHaveTextContent('Database is not reachable');
  });
});

describe('mobile menu', () => {
  it('opens and closes the drawer', async () => {
    stubHealth(healthyResponse);
    renderApp();
    expect(screen.getAllByRole('navigation')).toHaveLength(1); // desktop sidebar only
    await userEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    expect(screen.getAllByRole('navigation')).toHaveLength(2);
    await userEvent.click(screen.getByRole('button', { name: 'Close menu' }));
    expect(screen.getAllByRole('navigation')).toHaveLength(1);
  });
});
