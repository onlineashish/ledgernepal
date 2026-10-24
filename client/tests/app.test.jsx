import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { baseRoutes, fail, mockApi, renderApp, sessionPayload } from './helpers.jsx';

afterEach(() => vi.unstubAllGlobals());

const asRole = (roleKey) => mockApi(baseRoutes(sessionPayload({ roleKey })));
const nav = () => screen.findByRole('navigation', { name: /main navigation/i });

describe('navigation', () => {
  it('shows all eight main sections plus Team to an owner', async () => {
    asRole('owner');
    renderApp();
    const sidebar = await nav();
    for (const label of ['Dashboard', 'Contacts', 'Sales', 'Purchases', 'Receipts & Payments', 'Ledger', 'Reports', 'Team', 'Settings']) {
      expect(within(sidebar).getByRole('link', { name: label })).toBeInTheDocument();
    }
  });

  it('offers View Ledger and Add Ledger Entry inside the Ledger section', async () => {
    asRole('owner');
    renderApp({ route: '/ledger' });
    const sidebar = await nav();
    expect(within(sidebar).getByRole('link', { name: 'View Ledger' })).toBeInTheDocument();
    expect(within(sidebar).getByRole('link', { name: 'Add Ledger Entry' })).toBeInTheDocument();
  });

  it('navigates between pages without a reload', async () => {
    asRole('owner');
    renderApp();
    await userEvent.click(within(await nav()).getByRole('link', { name: 'Contacts' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Contacts' })).toBeInTheDocument();
  });

  it('shows a not-found page for unknown URLs', async () => {
    asRole('owner');
    renderApp({ route: '/definitely/not/a/page' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();
  });

  it('is honest that unbuilt pages are not connected yet', async () => {
    asRole('owner');
    renderApp({ route: '/sales' });
    expect(await screen.findByText(/nothing on this page is connected yet/i)).toBeInTheDocument();
  });

  it('shows the business, the person and their role, and a log out button', async () => {
    asRole('accountant');
    renderApp();
    const sidebar = await nav();
    expect(within(sidebar).getByText('Test Traders')).toBeInTheDocument();
    expect(within(sidebar).getByText(/Sita Sharma · Accountant/)).toBeInTheDocument();
    expect(within(sidebar).getByRole('button', { name: 'Log out' })).toBeInTheDocument();
  });
});

describe('what each role is shown (a convenience; the server enforces access)', () => {
  const linkNames = async () => {
    const sidebar = await nav();
    return within(sidebar).getAllByRole('link').map((a) => a.textContent);
  };

  it('a viewer sees read-only sections and no Team link', async () => {
    asRole('viewer');
    renderApp();
    const links = await linkNames();
    expect(links).toEqual(expect.arrayContaining(['Dashboard', 'Contacts', 'Sales', 'Purchases', 'Receipts & Payments', 'Ledger', 'Reports', 'Settings']));
    expect(links).not.toContain('Team');
  });

  it('staff do not see Reports or Team', async () => {
    asRole('staff');
    renderApp();
    const links = await linkNames();
    expect(links).not.toContain('Reports');
    expect(links).not.toContain('Team');
    expect(links).toContain('Sales');
  });

  it('hides Add Ledger Entry from someone who cannot create entries', async () => {
    asRole('viewer');
    renderApp({ route: '/ledger' });
    await nav();
    expect(screen.queryByRole('link', { name: 'Add Ledger Entry' })).not.toBeInTheDocument();
  });

  it('shows only the quick actions the role may use', async () => {
    asRole('staff'); // can create contacts, ledger entries, sales, purchases, receipts, but not payments
    renderApp();
    expect(await screen.findByRole('link', { name: 'Add Contact' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Record Receipt' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Record Payment' })).not.toBeInTheDocument();
  });

  it('shows all six quick actions to an owner', async () => {
    asRole('owner');
    renderApp();
    for (const label of ['Add Contact', 'Add Ledger Entry', 'Create Sales Invoice', 'Record Purchase', 'Record Receipt', 'Record Payment']) {
      expect(await screen.findByRole('link', { name: label })).toBeInTheDocument();
    }
  });

  it('a viewer typing a restricted URL gets "no access" and no data request is made', async () => {
    const api = asRole('viewer');
    renderApp({ route: '/team' });
    expect(await screen.findByText(/do not have access to this page/i)).toBeInTheDocument();
    expect(api.calledWith('GET /users')).toHaveLength(0);
    expect(api.calledWith('GET /users/invitations')).toHaveLength(0);
  });

  it('a viewer cannot open the create pages either', async () => {
    asRole('viewer');
    renderApp({ route: '/sales/new' });
    expect(await screen.findByText(/do not have access to this page/i)).toBeInTheDocument();
  });
});

describe('dashboard status', () => {
  it('shows the real server status when the API is up', async () => {
    asRole('owner');
    renderApp();
    expect(await screen.findByText(/server and database are connected/i)).toBeInTheDocument();
  });

  it('shows an error state when the API reports a problem', async () => {
    mockApi({ ...baseRoutes(), 'GET /health/ready': fail(503, 'SERVICE_UNAVAILABLE', 'Database is not reachable') });
    renderApp();
    expect(await screen.findByText(/Database is not reachable/)).toBeInTheDocument();
  });
});

describe('mobile menu', () => {
  it('opens and closes the drawer', async () => {
    asRole('owner');
    renderApp();
    await nav();
    expect(screen.getAllByRole('navigation')).toHaveLength(1); // desktop sidebar only
    await userEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    expect(screen.getAllByRole('navigation')).toHaveLength(2);
    await userEvent.click(screen.getByRole('button', { name: 'Close menu' }));
    expect(screen.getAllByRole('navigation')).toHaveLength(1);
  });
});
