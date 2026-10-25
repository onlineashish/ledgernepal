import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { baseRoutes, contact, fail, ledgerPayload, mockApi, ok, paged, renderApp, sessionPayload } from './helpers.jsx';

afterEach(() => vi.unstubAllGlobals());

const as = (roleKey, extra = {}) => baseRoutes(sessionPayload({ roleKey, ...extra }));
const list = (rows, total) => ({ ...as('owner'), 'GET /contacts': paged(rows, total ?? rows.length) });

describe('contacts list', () => {
  const rows = [
    contact({ id: 'c1', name: 'Ram Bahadur', types: ['customer'], balance: { amount: '5000.00', side: 'receivable' } }),
    contact({ id: 'c2', name: 'Sita Suppliers', types: ['supplier', 'partner'], phone: null, balance: { amount: '-300.00', side: 'payable' } }),
    contact({ id: 'c3', name: 'Hari Traders', types: ['customer', 'supplier'], balance: { amount: '0.00', side: 'settled' } }),
  ];

  it('shows each contact with its type and balance in plain words', async () => {
    mockApi(list(rows));
    renderApp({ route: '/contacts' });
    const ram = (await screen.findByRole('link', { name: 'Ram Bahadur' })).closest('tr');
    expect(within(ram).getByText('Customer')).toBeInTheDocument();
    expect(within(ram).getByText('Owes you रु 5,000.00')).toBeInTheDocument();
    const sita = screen.getByRole('link', { name: 'Sita Suppliers' }).closest('tr');
    expect(within(sita).getByText('Supplier')).toBeInTheDocument();
    expect(within(sita).getByText('Partner')).toBeInTheDocument();
    expect(within(sita).getByText('You owe रु 300.00')).toBeInTheDocument(); // no bare minus sign
    expect(within(screen.getByRole('link', { name: 'Hari Traders' }).closest('tr')).getByText('Settled')).toBeInTheDocument();
  });

  it('links every contact to its page', async () => {
    mockApi(list(rows));
    renderApp({ route: '/contacts' });
    expect(await screen.findByRole('link', { name: 'Ram Bahadur' })).toHaveAttribute('href', '/contacts/c1');
  });

  it('searches after typing pauses, and sends the text to the server', async () => {
    const api = mockApi(list(rows));
    const user = userEvent.setup();
    renderApp({ route: '/contacts' });
    await screen.findByRole('link', { name: 'Ram Bahadur' });
    await user.type(screen.getByLabelText('Search contacts'), 'ram');
    await waitFor(() => expect(api.lastCall('GET /contacts').query.get('q')).toBe('ram'));
    expect(api.calledWith('GET /contacts').length).toBeLessThanOrEqual(3); // not one request per keystroke
  });

  it('filters by type and by archived state', async () => {
    const api = mockApi(list(rows));
    const user = userEvent.setup();
    renderApp({ route: '/contacts' });
    await screen.findByRole('link', { name: 'Ram Bahadur' });
    await user.selectOptions(screen.getByLabelText('Type'), 'supplier');
    await waitFor(() => expect(api.lastCall('GET /contacts').query.get('type')).toBe('supplier'));
    await user.selectOptions(screen.getByLabelText('Show'), 'all');
    await waitFor(() => expect(api.lastCall('GET /contacts').query.get('archived')).toBe('all'));
    expect(api.calledWith('GET /contacts')[0].query.get('archived')).toBe('false'); // active contacts by default
  });

  it('pages through results using the server’s totals', async () => {
    const api = mockApi({ ...as('owner'), 'GET /contacts': ({ query }) => paged(rows, 60, Number(query.get('page'))) });
    const user = userEvent.setup();
    renderApp({ route: '/contacts' });
    expect(await screen.findByText('1–25 of 60')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('26–50 of 60')).toBeInTheDocument();
    expect(api.lastCall('GET /contacts').query.get('page')).toBe('2');
  });

  it('marks archived contacts', async () => {
    mockApi(list([contact({ archivedAt: '2026-10-02T00:00:00Z' })]));
    renderApp({ route: '/contacts?archived=all' });
    expect(await screen.findByText('Archived')).toBeInTheDocument();
  });

  it('invites the first contact when there are none, only to someone who may add one', async () => {
    mockApi(list([]));
    renderApp({ route: '/contacts' });
    expect(await screen.findByText('No contacts yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add your first contact' })).toHaveAttribute('href', '/contacts/new');
  });

  it('does not offer to add contacts to a viewer', async () => {
    mockApi({ ...as('viewer'), 'GET /contacts': paged([]) });
    renderApp({ route: '/contacts' });
    expect(await screen.findByText('No contacts yet')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Add (your first )?contact/ })).not.toBeInTheDocument();
  });

  it('says so when filters match nothing, and clears them', async () => {
    mockApi({ ...as('owner'), 'GET /contacts': ({ query }) => paged(query.get('type') ? [] : rows) });
    const user = userEvent.setup();
    renderApp({ route: '/contacts' });
    await screen.findByRole('link', { name: 'Ram Bahadur' });
    await user.selectOptions(screen.getByLabelText('Type'), 'partner');
    expect(await screen.findByText('No contacts match')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(await screen.findByRole('link', { name: 'Ram Bahadur' })).toBeInTheDocument();
  });

  it('hides the balance column from someone who may not see the ledger', async () => {
    mockApi({ ...baseRoutes(sessionPayload({ roleKey: 'staff', permissions: ['business.view', 'contacts.view'] })), 'GET /contacts': paged(rows.map((r) => ({ ...r, balance: null }))) });
    renderApp({ route: '/contacts' });
    await screen.findByRole('link', { name: 'Ram Bahadur' });
    expect(screen.queryByRole('columnheader', { name: 'Balance' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Owes you/)).not.toBeInTheDocument();
  });

  it('shows the server’s error', async () => {
    mockApi({ ...as('owner'), 'GET /contacts': fail(500, 'INTERNAL_ERROR', 'Something went wrong. Please try again.') });
    renderApp({ route: '/contacts' });
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');
  });
});

describe('add / edit contact', () => {
  const fillName = async (user, name = 'Gita Stores') => user.type(await screen.findByLabelText('Name'), name);

  it('needs only a name and a type, and sends the rest as empty', async () => {
    const api = mockApi({ ...as('owner'), 'POST /contacts': ok(contact({ id: 'c9', name: 'Gita Stores' }), 201), 'GET /contacts/c9': ok(contact({ id: 'c9', name: 'Gita Stores' })), 'GET /ledger/contacts/c9': ledgerPayload([]) });
    const user = userEvent.setup();
    renderApp({ route: '/contacts/new' });
    await fillName(user);
    await user.click(screen.getByLabelText(/^Customer/));
    await user.click(screen.getByRole('button', { name: 'Save contact' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Gita Stores' })).toBeInTheDocument(); // lands on the new contact
    expect(api.calledWith('POST /contacts')[0].body).toEqual({ name: 'Gita Stores', types: ['customer'], phone: '', email: '', address: '', panNumber: '', vatNumber: '', notes: '' });
  });

  it('lets one contact be several things at once', async () => {
    const api = mockApi({ ...as('owner'), 'POST /contacts': ok(contact({ id: 'c9' }), 201), 'GET /contacts/c9': ok(contact({ id: 'c9' })), 'GET /ledger/contacts/c9': ledgerPayload([]) });
    const user = userEvent.setup();
    renderApp({ route: '/contacts/new' });
    await fillName(user);
    await user.click(screen.getByLabelText(/^Customer/));
    await user.click(screen.getByLabelText(/^Supplier/));
    await user.click(screen.getByRole('button', { name: 'Save contact' }));
    await screen.findByRole('heading', { level: 1 });
    expect(api.calledWith('POST /contacts')[0].body.types).toEqual(['customer', 'supplier']);
  });

  it('shows the server’s messages next to the right fields and keeps what was typed', async () => {
    mockApi({
      ...as('owner'),
      'POST /contacts': fail(400, 'VALIDATION_FAILED', 'Some fields are invalid', [
        { field: 'types', message: 'Choose at least one contact type' },
        { field: 'email', message: 'Enter a valid email address' },
      ]),
    });
    const user = userEvent.setup();
    renderApp({ route: '/contacts/new' });
    await fillName(user);
    await user.type(screen.getByLabelText('Email'), 'nope');
    await user.click(screen.getByRole('button', { name: 'Save contact' }));
    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument();
    expect(screen.getByText('Choose at least one contact type')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveValue('nope');
    expect(screen.getByLabelText('Name')).toHaveValue('Gita Stores');
  });

  it('can add an opening balance, saved together with the contact', async () => {
    const api = mockApi({ ...as('owner'), 'POST /contacts': ok(contact({ id: 'c9' }), 201), 'GET /contacts/c9': ok(contact({ id: 'c9' })), 'GET /ledger/contacts/c9': ledgerPayload([]) });
    const user = userEvent.setup();
    renderApp({ route: '/contacts/new' });
    await fillName(user);
    await user.click(screen.getByLabelText(/^Supplier/));
    await user.click(screen.getByRole('button', { name: 'Add an opening balance' }));
    await user.click(screen.getByLabelText('I owe them (payable)'));
    await user.type(screen.getByLabelText('Amount (NPR)'), '12500.50');
    await user.type(screen.getByLabelText('As of date'), '2082-04-01');
    await user.click(screen.getByRole('button', { name: 'Save contact' }));
    await screen.findByRole('heading', { level: 1 });
    expect(api.calledWith('POST /contacts')[0].body.openingBalance).toEqual({ amount: '12500.50', side: 'i_owe_them', asOfDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
  });

  it('leaves the opening balance out when its amount is empty', async () => {
    const api = mockApi({ ...as('owner'), 'POST /contacts': ok(contact({ id: 'c9' }), 201), 'GET /contacts/c9': ok(contact({ id: 'c9' })), 'GET /ledger/contacts/c9': ledgerPayload([]) });
    const user = userEvent.setup();
    renderApp({ route: '/contacts/new' });
    await fillName(user);
    await user.click(screen.getByLabelText(/^Customer/));
    await user.click(screen.getByRole('button', { name: 'Add an opening balance' }));
    await user.click(screen.getByRole('button', { name: 'Save contact' }));
    await screen.findByRole('heading', { level: 1 });
    expect(api.calledWith('POST /contacts')[0].body).not.toHaveProperty('openingBalance');
  });

  it('offers no opening balance to someone who cannot create ledger entries', async () => {
    mockApi(baseRoutes(sessionPayload({ roleKey: 'staff', permissions: ['business.view', 'contacts.view', 'contacts.create'] })));
    renderApp({ route: '/contacts/new' });
    await screen.findByLabelText('Name');
    expect(screen.queryByText('Opening balance (optional)')).not.toBeInTheDocument();
  });

  it('edits an existing contact: loads its values and sends the changes', async () => {
    const api = mockApi({
      ...as('owner'),
      'GET /contacts/c1': ok(contact({ notes: 'Pays monthly', types: ['customer', 'supplier'] })),
      'PATCH /contacts/c1': ok(contact()),
      'GET /ledger/contacts/c1': ledgerPayload(),
    });
    const user = userEvent.setup();
    renderApp({ route: '/contacts/c1/edit' });
    const name = await screen.findByLabelText('Name');
    expect(name).toHaveValue('Ram Bahadur');
    expect(screen.getByLabelText('Notes')).toHaveValue('Pays monthly');
    expect(screen.getByLabelText(/^Supplier/)).toBeChecked();
    expect(screen.queryByText('Opening balance (optional)')).not.toBeInTheDocument(); // changed from the contact page instead

    await user.clear(name);
    await user.type(name, 'Ram B. Shrestha');
    await user.click(screen.getByRole('button', { name: 'Save contact' }));
    await screen.findByRole('heading', { level: 1 });
    expect(api.calledWith('PATCH /contacts/c1')[0].body).toMatchObject({ name: 'Ram B. Shrestha', types: ['customer', 'supplier'], notes: 'Pays monthly' });
  });

  it('is closed to someone who may not add contacts', async () => {
    mockApi(as('viewer'));
    renderApp({ route: '/contacts/new' });
    expect(await screen.findByText(/do not have access to this page/i)).toBeInTheDocument();
  });
});

describe('contact page', () => {
  const page = (c = contact(), extra = {}, role = 'owner') => mockApi({
    ...as(role),
    'GET /contacts/c1': ok({ ...c, openingBalance: null, ...extra }),
    'GET /ledger/contacts/c1': ledgerPayload(),
  });

  it('shows the balance in words, the details, and links to add an entry or edit', async () => {
    page();
    renderApp({ route: '/contacts/c1' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Ram Bahadur' })).toBeInTheDocument();
    expect(screen.getByText('Ram Bahadur owes you रु 5,000.00')).toBeInTheDocument();
    expect(screen.getByText('9841234567')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add ledger entry' })).toHaveAttribute('href', '/ledger/new?contactId=c1');
    expect(screen.getByRole('link', { name: 'Edit' })).toHaveAttribute('href', '/contacts/c1/edit');
  });

  it('shows "You owe" when the balance is negative', async () => {
    page(contact({ balance: { amount: '-1250.00', side: 'payable' } }));
    renderApp({ route: '/contacts/c1' });
    expect(await screen.findByText('You owe Ram Bahadur रु 1,250.00')).toBeInTheDocument();
  });

  it('archives only after a confirmation', async () => {
    const api = mockApi({
      ...as('owner'),
      'GET /contacts/c1': ok({ ...contact(), openingBalance: null }),
      'GET /ledger/contacts/c1': ledgerPayload(),
      'POST /contacts/c1/archive': ok(contact({ archivedAt: '2026-10-25T00:00:00Z' })),
    });
    const user = userEvent.setup();
    renderApp({ route: '/contacts/c1' });
    await user.click(await screen.findByRole('button', { name: 'Archive' }));
    expect(api.calledWith('POST /contacts/c1/archive')).toHaveLength(0);
    expect(screen.getByText(/hidden from lists and cannot get new entries/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Confirm archive' }));
    await waitFor(() => expect(api.calledWith('POST /contacts/c1/archive')).toHaveLength(1));
  });

  it('for an archived contact: no new entries, and it can be unarchived', async () => {
    page(contact({ archivedAt: '2026-10-02T00:00:00Z' }));
    renderApp({ route: '/contacts/c1' });
    await screen.findByRole('heading', { level: 1, name: 'Ram Bahadur' });
    expect(screen.queryByRole('link', { name: 'Add ledger entry' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unarchive' })).toBeInTheDocument();
  });

  it('shows a viewer the contact and ledger but no buttons to change anything', async () => {
    page(contact(), {}, 'viewer');
    renderApp({ route: '/contacts/c1' });
    await screen.findByRole('heading', { level: 1, name: 'Ram Bahadur' });
    for (const name of ['Add ledger entry', 'Edit']) expect(screen.queryByRole('link', { name })).not.toBeInTheDocument();
    for (const name of ['Archive', 'Add opening balance']) expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    expect(await screen.findByText('Rice')).toBeInTheDocument(); // can still read the ledger
  });

  it('hides balances and the ledger from someone who may not view the ledger', async () => {
    mockApi({
      ...baseRoutes(sessionPayload({ roleKey: 'staff', permissions: ['business.view', 'contacts.view'] })),
      'GET /contacts/c1': ok({ ...contact({ balance: null }), openingBalance: null }),
    });
    renderApp({ route: '/contacts/c1' });
    await screen.findByRole('heading', { level: 1, name: 'Ram Bahadur' });
    expect(screen.queryByText('Balance')).not.toBeInTheDocument();
    expect(screen.queryByText('Ledger')).not.toBeInTheDocument();
  });

  it('says so, with a way back, for a contact that is not there', async () => {
    mockApi({ ...as('owner'), 'GET /contacts/c1': fail(404, 'NOT_FOUND', 'Contact not found') });
    renderApp({ route: '/contacts/c1' });
    expect(await screen.findByRole('heading', { name: 'Contact not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to contacts' })).toBeInTheDocument();
  });
});

describe('opening balance on the contact page', () => {
  const opening = { id: 'o1', amount: '1000.00', side: 'they_owe_me', asOfDate: '2024-04-13', referenceNo: 'OB-2080/81-0001' };
  const routes = (extra = {}, role = 'owner') => ({
    ...as(role),
    'GET /contacts/c1': ok({ ...contact(), openingBalance: opening }),
    'GET /ledger/contacts/c1': ledgerPayload(),
    ...extra,
  });

  it('describes it with the as-of date in the business calendar', async () => {
    mockApi(routes());
    renderApp({ route: '/contacts/c1' });
    expect(await screen.findByText(/they owe me \(receivable\), as of 2081-01-01 \(OB-2080\/81-0001\)/)).toBeInTheDocument();
  });

  it('changes it through a dialog that explains the old one is kept in the history', async () => {
    const api = mockApi(routes({ 'PUT /contacts/c1/opening-balance': ok({}) }));
    const user = userEvent.setup();
    renderApp({ route: '/contacts/c1' });
    await user.click(await screen.findByRole('button', { name: 'Change opening balance' }));
    const dialog = screen.getByRole('dialog', { name: 'Change opening balance' });
    expect(within(dialog).getByText(/voided and replaced; both stay in the history/)).toBeInTheDocument();
    const amount = within(dialog).getByLabelText('Amount (NPR)');
    expect(amount).toHaveValue('1000.00');
    await user.clear(amount);
    await user.type(amount, '1500');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.calledWith('PUT /contacts/c1/opening-balance')[0].body).toEqual({ amount: '1500', side: 'they_owe_me', asOfDate: '2024-04-13' });
  });

  it('removes it only after a confirmation', async () => {
    const api = mockApi(routes({ 'DELETE /contacts/c1/opening-balance': ok({ removed: true }) }));
    const user = userEvent.setup();
    renderApp({ route: '/contacts/c1' });
    await user.click(await screen.findByRole('button', { name: 'Remove' }));
    expect(api.calledWith('DELETE /contacts/c1/opening-balance')).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Confirm remove' }));
    await waitFor(() => expect(api.calledWith('DELETE /contacts/c1/opening-balance')).toHaveLength(1));
  });

  it('shows the server’s refusal inside the dialog', async () => {
    mockApi(routes({ 'PUT /contacts/c1/opening-balance': fail(403, 'FORBIDDEN', 'Only someone who can correct the ledger may change an existing opening balance') }));
    const user = userEvent.setup();
    renderApp({ route: '/contacts/c1' });
    await user.click(await screen.findByRole('button', { name: 'Change opening balance' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }));
    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent('Only someone who can correct');
  });

  it('lets someone without ledger.correct add a first one but not change or remove an existing one', async () => {
    const permissions = ['business.view', 'contacts.view', 'ledger.view', 'ledger.create'];
    mockApi({ ...baseRoutes(sessionPayload({ roleKey: 'staff', permissions })), 'GET /contacts/c1': ok({ ...contact(), openingBalance: opening }), 'GET /ledger/contacts/c1': ledgerPayload() });
    renderApp({ route: '/contacts/c1' });
    await screen.findByText(/they owe me \(receivable\)/);
    expect(screen.queryByRole('button', { name: 'Change opening balance' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
  });

  it('offers to add one when there is none', async () => {
    mockApi({ ...as('owner'), 'GET /contacts/c1': ok({ ...contact(), openingBalance: null }), 'GET /ledger/contacts/c1': ledgerPayload() });
    renderApp({ route: '/contacts/c1' });
    expect(await screen.findByRole('button', { name: 'Add opening balance' })).toBeInTheDocument();
  });
});
