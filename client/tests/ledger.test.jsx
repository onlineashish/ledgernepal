import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { formatDay } from '../src/lib/format.js';
import { baseRoutes, contact, fail, ledgerPayload, ledgerRow, mockApi, ok, paged, renderApp, sessionPayload } from './helpers.jsx';

afterEach(() => vi.unstubAllGlobals());

const as = (roleKey, extra = {}) => baseRoutes(sessionPayload({ roleKey, ...extra }));
const detailRoutes = (rows, role = 'owner', extra = {}, contactOverrides = {}) => ({
  ...as(role),
  'GET /contacts/c1': ok({ ...contact(contactOverrides), openingBalance: null }),
  'GET /ledger/contacts/c1': ledgerPayload(rows),
  ...extra,
});

describe('the contact ledger', () => {
  const rows = [
    ledgerRow({ id: 'o', type: 'opening_balance', referenceNo: 'OB-2082/83-0001', txnDate: '2025-07-17', description: null, debit: '1000.00', credit: null, balance: '1000.00' }),
    ledgerRow({ id: 'a', referenceNo: 'LE-2082/83-0001', txnDate: '2025-08-01', description: 'Rice', debit: '500.00', credit: null, balance: '1500.00', externalRef: 'BILL-9', createdBy: { id: 'u1', fullName: 'Sita Sharma' } }),
    ledgerRow({ id: 'b', referenceNo: 'LE-2082/83-0002', txnDate: '2025-08-10', description: 'Part payment', debit: null, credit: '300.00', balance: '1200.00' }),
  ];

  it('shows each line with debit, credit and the running balance, dated in the business calendar', async () => {
    mockApi(detailRoutes(rows, 'owner', {}, {}));
    renderApp({ route: '/contacts/c1' });
    const rice = (await screen.findByText('Rice')).closest('tr');
    expect(within(rice).getByText(formatDay('2025-08-01', 'BS'))).toBeInTheDocument();
    expect(within(rice).getByText('LE-2082/83-0001')).toBeInTheDocument();
    expect(within(rice).getByText('रु 500.00')).toBeInTheDocument(); // debit
    expect(within(rice).getByText('रु 1,500.00')).toBeInTheDocument(); // running balance
    expect(within(rice).getByText('Ref BILL-9')).toBeInTheDocument();
    expect(within(rice).getByText('by Sita Sharma')).toBeInTheDocument();

    const payment = screen.getByText('Part payment').closest('tr');
    const cells = within(payment).getAllByRole('cell').map((c) => c.textContent);
    expect(cells[3]).toBe('–'); // nothing in the debit column
    expect(cells[4]).toBe('रु 300.00'); // credit
    expect(cells[5]).toBe('रु 1,200.00');
  });

  it('marks the opening balance line, which has no void or correct buttons of its own', async () => {
    mockApi(detailRoutes(rows));
    renderApp({ route: '/contacts/c1' });
    await screen.findByText('Rice');
    const opening = screen.getByText('LE-2082/83-0001').closest('tr').parentElement.querySelector('tr');
    expect(within(opening).getByText('Opening balance')).toBeInTheDocument();
    expect(within(opening).queryByRole('button')).not.toBeInTheDocument();
  });

  it('explains debit and credit in plain words under the totals', async () => {
    mockApi(detailRoutes(rows));
    renderApp({ route: '/contacts/c1' });
    expect(await screen.findByText(/Debit means they owe you more; credit means they owe you less/)).toBeInTheDocument();
    expect(screen.getByText('Closing balance')).toBeInTheDocument();
  });

  it('asks the server for a date range and search text, and labels the balance brought forward', async () => {
    const api = mockApi(detailRoutes(rows, 'owner', {
      'GET /ledger/contacts/c1': ({ query }) => ledgerPayload(rows, { openingBalance: query.get('from') ? '1500.00' : '0.00' }),
    }));
    const user = userEvent.setup();
    renderApp({ route: '/contacts/c1' });
    await screen.findByText('Rice');
    expect(screen.getByText('Opening')).toBeInTheDocument();

    await user.type(screen.getByLabelText('From'), '2082-04-20'); // typed in BS, sent as AD
    await waitFor(() => expect(api.lastCall('GET /ledger/contacts/c1').query.get('from')).toMatch(/^2025-08-\d\d$/));
    expect(await screen.findByText('Brought forward')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Search'), 'rice');
    await waitFor(() => expect(api.lastCall('GET /ledger/contacts/c1').query.get('q')).toBe('rice'));
  });

  it('pages through long ledgers', async () => {
    const api = mockApi(detailRoutes(rows, 'owner', {
      'GET /ledger/contacts/c1': ({ query }) => ledgerPayload(rows, {}, { total: 120, page: Number(query.get('page')) }),
    }));
    const user = userEvent.setup();
    renderApp({ route: '/contacts/c1' });
    expect(await screen.findByText('1–50 of 120')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(api.lastCall('GET /ledger/contacts/c1').query.get('page')).toBe('2'));
  });

  it('has a friendly empty state, and a different one when filters hide everything', async () => {
    mockApi(detailRoutes([]));
    const user = userEvent.setup();
    renderApp({ route: '/contacts/c1' });
    expect(await screen.findByText('No entries yet')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Search'), 'zzz');
    expect(await screen.findByText('No entries match')).toBeInTheDocument();
  });

  it('shows an error instead of a blank table when the ledger cannot be loaded', async () => {
    mockApi(detailRoutes(rows, 'owner', { 'GET /ledger/contacts/c1': fail(500, 'INTERNAL_ERROR', 'Something went wrong. Please try again.') }));
    renderApp({ route: '/contacts/c1' });
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');
  });

  describe('voiding', () => {
    it('asks for a reason, explains what happens, and refreshes the ledger afterwards', async () => {
      const api = mockApi(detailRoutes(rows, 'owner', { 'POST /ledger/entries/a/void': ok({ id: 'a', status: 'voided' }) }));
      const user = userEvent.setup();
      renderApp({ route: '/contacts/c1' });
      await user.click(await screen.findByRole('button', { name: 'Void LE-2082/83-0001' }));
      const dialog = screen.getByRole('dialog', { name: 'Void this entry?' });
      expect(within(dialog).getByText(/stop counting toward the balance but stays in the history/)).toBeInTheDocument();
      expect(api.calledWith('POST /ledger/entries/a/void')).toHaveLength(0); // nothing yet

      const before = api.calledWith('GET /ledger/contacts/c1').length;
      await user.type(within(dialog).getByLabelText(/Reason/), 'Entered for the wrong customer');
      await user.click(within(dialog).getByRole('button', { name: 'Void entry' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(api.calledWith('POST /ledger/entries/a/void')[0].body).toEqual({ reason: 'Entered for the wrong customer' });
      await waitFor(() => expect(api.calledWith('GET /ledger/contacts/c1').length).toBeGreaterThan(before));
    });

    it('shows a missing-reason message from the server and stays open', async () => {
      mockApi(detailRoutes(rows, 'owner', { 'POST /ledger/entries/a/void': fail(400, 'VALIDATION_FAILED', 'Some fields are invalid', [{ field: 'reason', message: 'Give a reason (at least 3 characters)' }]) }));
      const user = userEvent.setup();
      renderApp({ route: '/contacts/c1' });
      await user.click(await screen.findByRole('button', { name: 'Void LE-2082/83-0001' }));
      await user.click(screen.getByRole('button', { name: 'Void entry' }));
      expect(await screen.findByText('Give a reason (at least 3 characters)')).toBeInTheDocument();
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('can be dismissed with Keep it or Escape without calling the server', async () => {
      const api = mockApi(detailRoutes(rows));
      const user = userEvent.setup();
      renderApp({ route: '/contacts/c1' });
      await user.click(await screen.findByRole('button', { name: 'Void LE-2082/83-0001' }));
      await user.click(screen.getByRole('button', { name: 'Keep it' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Void LE-2082/83-0001' }));
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(api.calledWith('POST /ledger/entries/a/void')).toHaveLength(0);
    });
  });

  describe('correcting', () => {
    it('starts from the old values, sends the new ones with the reason, and explains the old entry is kept', async () => {
      const api = mockApi(detailRoutes(rows, 'owner', { 'POST /ledger/entries/a/correct': ok({ voided: {}, replacement: {} }, 201) }));
      const user = userEvent.setup();
      renderApp({ route: '/contacts/c1' });
      await user.click(await screen.findByRole('button', { name: 'Correct LE-2082/83-0001' }));
      const dialog = screen.getByRole('dialog', { name: 'Correct this entry' });
      expect(within(dialog).getByText(/voided and a new one replaces it. Both stay in the history/)).toBeInTheDocument();
      expect(within(dialog).getByLabelText(/^You gave/)).toBeChecked();
      const amount = within(dialog).getByLabelText('Amount (NPR)');
      expect(amount).toHaveValue('500.00');
      expect(within(dialog).getByLabelText('Description')).toHaveValue('Rice');

      await user.clear(amount);
      await user.type(amount, '5000');
      await user.type(within(dialog).getByLabelText(/Reason/), 'An extra zero was missing');
      await user.click(within(dialog).getByRole('button', { name: 'Save correction' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(api.calledWith('POST /ledger/entries/a/correct')[0].body).toEqual({
        txnDate: '2025-08-01', direction: 'you_gave', amount: '5000', description: 'Rice', reason: 'An extra zero was missing',
      });
    });

    it('pre-selects "You got" for a credit line', async () => {
      mockApi(detailRoutes(rows));
      const user = userEvent.setup();
      renderApp({ route: '/contacts/c1' });
      await user.click(await screen.findByRole('button', { name: 'Correct LE-2082/83-0002' }));
      expect(within(screen.getByRole('dialog')).getByLabelText(/^You got/)).toBeChecked();
      expect(within(screen.getByRole('dialog')).getByLabelText('Amount (NPR)')).toHaveValue('300.00');
    });
  });

  describe('who sees the buttons', () => {
    it('someone who cannot correct the ledger sees the lines but no Void or Correct', async () => {
      mockApi(detailRoutes(rows, 'staff'));
      renderApp({ route: '/contacts/c1' });
      await screen.findByText('Rice');
      expect(screen.queryByRole('button', { name: /^(Void|Correct) / })).not.toBeInTheDocument();
    });

    it('an archived contact’s ledger is read-only even for the owner', async () => {
      mockApi(detailRoutes(rows, 'owner', {}, { archivedAt: '2026-10-02T00:00:00Z' }));
      renderApp({ route: '/contacts/c1' });
      await screen.findByText('Rice');
      expect(screen.queryByRole('button', { name: /^(Void|Correct) / })).not.toBeInTheDocument();
    });
  });
});

describe('View Ledger (all entries)', () => {
  const entry = (overrides = {}) => ({
    id: 'e1', referenceNo: 'LE-2082/83-0001', type: 'ledger_entry', status: 'posted', direction: 'you_gave', effect: 'debit',
    txnDate: '2025-08-01', amount: '2500.00', description: 'Cement', notes: null, externalRef: null,
    contact: { id: 'c1', name: 'Ram Bahadur' }, correctsId: null, createdAt: '2026-10-01T00:00:00Z', createdBy: null, voidedAt: null, voidReason: null,
    ...overrides,
  });
  const routes = (rows, extra = {}) => ({ ...as('owner'), 'GET /ledger/entries': paged(rows, rows.length, 1, 25), ...extra });

  it('lists entries with the contact, what happened and the amount', async () => {
    mockApi(routes([entry(), entry({ id: 'e2', referenceNo: 'LE-2082/83-0002', direction: 'you_got', amount: '100.00', description: 'Cash back', contact: { id: 'c2', name: 'Sita' } })]));
    renderApp({ route: '/ledger' });
    const first = (await screen.findByText('LE-2082/83-0001')).closest('tr');
    expect(within(first).getByRole('link', { name: 'Ram Bahadur' })).toHaveAttribute('href', '/contacts/c1');
    expect(within(first).getByText('You gave')).toBeInTheDocument();
    expect(within(first).getByText('रु 2,500.00')).toBeInTheDocument();
    expect(within(screen.getByText('LE-2082/83-0002').closest('tr')).getByText('You got')).toBeInTheDocument();
  });

  it('marks voided entries and opening balances', async () => {
    mockApi(routes([entry({ status: 'voided' }), entry({ id: 'o1', type: 'opening_balance', referenceNo: 'OB-2082/83-0001', direction: 'they_owe_me', description: null })]));
    renderApp({ route: '/ledger' });
    await screen.findByText('LE-2082/83-0001');
    expect(screen.getByText('Voided')).toBeInTheDocument();
    expect(screen.getByText('Opening balance')).toBeInTheDocument();
  });

  it('filters by status and search text on the server', async () => {
    const api = mockApi(routes([entry()]));
    const user = userEvent.setup();
    renderApp({ route: '/ledger' });
    await screen.findByText('LE-2082/83-0001');
    expect(api.calledWith('GET /ledger/entries')[0].query.get('status')).toBe('posted');
    await user.selectOptions(screen.getByLabelText('Show'), 'voided');
    await waitFor(() => expect(api.lastCall('GET /ledger/entries').query.get('status')).toBe('voided'));
    await user.type(screen.getByLabelText('Search'), 'cement');
    await waitFor(() => expect(api.lastCall('GET /ledger/entries').query.get('q')).toBe('cement'));
  });

  it('also shows sales invoices and purchase bills, labelled, with a link to each document', async () => {
    mockApi(routes([
      entry({ id: 's1', type: 'sale', referenceNo: 'SI-2082/83-0005', direction: null, effect: 'debit', amount: '1130.00', description: 'Cement +1 more' }),
      entry({ id: 'p1', type: 'purchase', referenceNo: 'PB-2082/83-0002', direction: null, effect: 'credit', amount: '400.00', description: 'Stock', contact: { id: 'c2', name: 'Sita' } }),
      entry({ id: 'e1', referenceNo: 'LE-2082/83-0001' }),
    ]));
    renderApp({ route: '/ledger' });

    const sale = (await screen.findByRole('link', { name: 'SI-2082/83-0005' })).closest('tr');
    expect(sale.querySelector('a').getAttribute('href')).toBe('/sales/s1');
    expect(within(sale).getByText('Sales invoice')).toBeInTheDocument();
    expect(within(sale).getByText('रु 1,130.00')).toBeInTheDocument();
    expect(within(sale).getByText('they owe you more')).toBeInTheDocument();
    expect(within(sale).queryByText('You gave')).not.toBeInTheDocument(); // an invoice is not a "You gave" entry

    const bill = screen.getByRole('link', { name: 'PB-2082/83-0002' }).closest('tr');
    expect(bill.querySelector('a').getAttribute('href')).toBe('/purchases/p1');
    expect(within(bill).getByText('Purchase bill')).toBeInTheDocument();
    expect(within(bill).getByText('they owe you less')).toBeInTheDocument();

    expect(screen.queryByRole('link', { name: 'LE-2082/83-0001' })).not.toBeInTheDocument(); // direct entries have no page of their own
  });

  it('can be narrowed to one kind of transaction on the server', async () => {
    const api = mockApi(routes([entry()]));
    const user = userEvent.setup();
    renderApp({ route: '/ledger' });
    await screen.findByText('LE-2082/83-0001');
    expect(api.calledWith('GET /ledger/entries')[0].query.has('type')).toBe(false); // all types by default
    await user.selectOptions(screen.getByLabelText('Type'), 'sale');
    await waitFor(() => expect(api.lastCall('GET /ledger/entries').query.get('type')).toBe('sale'));
    await user.selectOptions(screen.getByLabelText('Type'), 'all');
    await waitFor(() => expect(api.lastCall('GET /ledger/entries').query.has('type')).toBe(false));
  });

  it('invites the first entry, only to someone who can add one', async () => {
    mockApi(routes([]));
    renderApp({ route: '/ledger' });
    expect(await screen.findByText('No ledger entries yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add the first entry' })).toHaveAttribute('href', '/ledger/new');
  });

  it('is closed to someone who may not view the ledger', async () => {
    mockApi(baseRoutes(sessionPayload({ roleKey: 'staff', permissions: ['business.view', 'contacts.view'] })));
    renderApp({ route: '/ledger' });
    expect(await screen.findByText(/do not have access to this page/i)).toBeInTheDocument();
  });
});

describe('Add Ledger Entry', () => {
  const saved = (overrides = {}) => ({ id: 'e9', referenceNo: 'LE-2082/83-0007', status: 'posted', ...overrides });
  const routes = (extra = {}, c = contact()) => ({
    ...as('owner'),
    'GET /contacts/c1': ok({ ...c, openingBalance: null }),
    'GET /contacts': paged([c]),
    'GET /ledger/contacts/c1': ledgerPayload([]),
    'POST /ledger/entries': ok(saved(), 201),
    ...extra,
  });
  const sentence = () => screen.getByRole('status').textContent;
  const pickDirection = (user, name) => user.click(screen.getByLabelText(new RegExp(`^${name}`)));

  it('starts with the contact filled in when opened from their page, spelling out what each choice means', async () => {
    mockApi(routes());
    renderApp({ route: '/ledger/new?contactId=c1' });
    expect(await screen.findByText('Ram Bahadur')).toBeInTheDocument();
    expect(screen.getByText('Owes you रु 5,000.00')).toBeInTheDocument();
    expect(screen.getByLabelText(/^You gave/)).toHaveAccessibleName(/Ram Bahadur owes you more/);
    expect(screen.getByLabelText(/^You got/)).toHaveAccessibleName(/Ram Bahadur owes you less/);
  });

  it('finds a contact by typing, then shows their balance', async () => {
    const api = mockApi(routes());
    const user = userEvent.setup();
    renderApp({ route: '/ledger/new' });
    await user.type(await screen.findByRole('combobox', { name: /Contact/ }), 'ram');
    await waitFor(() => expect(api.lastCall('GET /contacts').query.get('q')).toBe('ram'));
    await user.click(await screen.findByRole('button', { name: /Ram Bahadur/ }));
    expect(screen.getByText('Ram Bahadur')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change' })).toBeInTheDocument();
  });

  it('keeps the save button off until a contact is chosen', async () => {
    mockApi(routes());
    renderApp({ route: '/ledger/new' });
    expect(await screen.findByRole('button', { name: 'Save entry' })).toBeDisabled();
  });

  it('tells you the result as you type: giving raises what they owe', async () => {
    mockApi(routes());
    const user = userEvent.setup();
    renderApp({ route: '/ledger/new?contactId=c1' });
    await screen.findByText('Ram Bahadur');
    expect(sentence()).toMatch(/Choose what happened and enter an amount/);
    await pickDirection(user, 'You gave');
    await user.type(screen.getByLabelText(/^Amount/), '2000');
    expect(sentence()).toBe('You gave रु 2,000.00. Ram Bahadur will owe you रु 7,000.00.');
  });

  it('getting lowers it, can settle the account, and can turn it around so you owe them', async () => {
    mockApi(routes());
    const user = userEvent.setup();
    renderApp({ route: '/ledger/new?contactId=c1' });
    await screen.findByText('Ram Bahadur');
    await pickDirection(user, 'You got');
    const amount = screen.getByLabelText(/^Amount/);
    await user.type(amount, '2000');
    expect(sentence()).toBe('You got रु 2,000.00. Ram Bahadur will owe you रु 3,000.00.');
    await user.clear(amount);
    await user.type(amount, '5000');
    expect(sentence()).toBe("You got रु 5,000.00. Ram Bahadur's account will be settled.");
    await user.clear(amount);
    await user.type(amount, '6500.50');
    expect(sentence()).toBe('You got रु 6,500.50. You will owe Ram Bahadur रु 1,500.50.');
  });

  it('shows no sentence for an amount that is not a valid positive number', async () => {
    mockApi(routes());
    const user = userEvent.setup();
    renderApp({ route: '/ledger/new?contactId=c1' });
    await screen.findByText('Ram Bahadur');
    await pickDirection(user, 'You gave');
    for (const bad of ['abc', '0', '10.123', '-5']) {
      const amount = screen.getByLabelText(/^Amount/);
      await user.clear(amount);
      await user.type(amount, bad);
      expect(sentence(), bad).toMatch(/Choose what happened and enter an amount/);
    }
  });

  it('shows only what you did when you are not allowed to see balances', async () => {
    mockApi(routes({}, contact({ balance: null })));
    const user = userEvent.setup();
    renderApp({ route: '/ledger/new?contactId=c1' });
    await screen.findByText('Ram Bahadur');
    await pickDirection(user, 'You gave');
    await user.type(screen.getByLabelText(/^Amount/), '2000');
    expect(sentence()).toBe('You gave रु 2,000.00.');
  });

  it('saves, then shows the contact’s page', async () => {
    const api = mockApi(routes());
    const user = userEvent.setup();
    renderApp({ route: '/ledger/new?contactId=c1' });
    await screen.findByText('Ram Bahadur');
    await pickDirection(user, 'You gave');
    await user.type(screen.getByLabelText(/^Amount/), '2000');
    await user.type(screen.getByLabelText('Description'), '50 kg rice');
    await user.type(screen.getByLabelText('Your reference (optional)'), 'BILL-77');
    await user.click(screen.getByRole('button', { name: 'Save entry' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Ram Bahadur' })).toBeInTheDocument();
    expect(api.calledWith('POST /ledger/entries')[0].body).toEqual({
      contactId: 'c1', txnDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), direction: 'you_gave', amount: '2000', description: '50 kg rice', externalRef: 'BILL-77',
    });
  });

  it('"Save and add another" keeps the contact and date, clears the rest, shows the new number, and refreshes the balance', async () => {
    let balance = '5000.00';
    const api = mockApi(routes({
      'GET /contacts/c1': () => ok({ ...contact({ balance: { amount: balance, side: 'receivable' } }), openingBalance: null }),
      'POST /ledger/entries': () => { balance = '7000.00'; return ok(saved(), 201); },
    }));
    const user = userEvent.setup();
    renderApp({ route: '/ledger/new?contactId=c1' });
    await screen.findByText('Owes you रु 5,000.00');
    await pickDirection(user, 'You gave');
    await user.type(screen.getByLabelText(/^Amount/), '2000');
    await user.type(screen.getByLabelText('Description'), 'first');
    await user.click(screen.getByRole('button', { name: 'Save and add another' }));

    expect(await screen.findByText(/Saved LE-2082\/83-0007/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Amount/)).toHaveValue('');
    expect(screen.getByLabelText('Description')).toHaveValue('');
    expect(screen.getByLabelText(/^You gave/)).toBeChecked(); // same direction kept for the next one
    expect(await screen.findByText('Owes you रु 7,000.00')).toBeInTheDocument(); // fresh balance
    expect(api.calledWith('POST /ledger/entries')).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Add ledger entry' })).toBeInTheDocument(); // stayed on the form
  });

  it('puts the server’s messages next to the fields and keeps what was typed', async () => {
    mockApi(routes({
      'POST /ledger/entries': fail(400, 'VALIDATION_FAILED', 'Some fields are invalid', [
        { field: 'direction', message: 'Choose "You gave" or "You got"' },
        { field: 'amount', message: 'Amount: Enter an amount with at most 2 decimal places, e.g. 1250.50' },
      ]),
    }));
    const user = userEvent.setup();
    renderApp({ route: '/ledger/new?contactId=c1' });
    await screen.findByText('Ram Bahadur');
    await user.type(screen.getByLabelText(/^Amount/), '10.123');
    await user.click(screen.getByRole('button', { name: 'Save entry' }));
    expect(await screen.findByText('Choose "You gave" or "You got"')).toBeInTheDocument();
    expect(screen.getByText(/at most 2 decimal places/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Amount/)).toHaveValue('10.123');
  });

  it('explains an archived contact instead of failing silently', async () => {
    mockApi(routes({ 'POST /ledger/entries': fail(409, 'CONFLICT', 'This contact is archived. Unarchive it before adding entries.') }));
    const user = userEvent.setup();
    renderApp({ route: '/ledger/new?contactId=c1' });
    await screen.findByText('Ram Bahadur');
    await pickDirection(user, 'You gave');
    await user.type(screen.getByLabelText(/^Amount/), '5');
    await user.click(screen.getByRole('button', { name: 'Save entry' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Unarchive it');
  });

  it('shows a clear message when the contact in the link does not exist', async () => {
    mockApi({ ...as('owner'), 'GET /contacts/c1': fail(404, 'NOT_FOUND', 'Contact not found') });
    renderApp({ route: '/ledger/new?contactId=c1' });
    expect(await screen.findByRole('alert')).toHaveTextContent('Contact not found');
  });

  it('is closed to someone who may not add entries', async () => {
    mockApi(as('viewer'));
    renderApp({ route: '/ledger/new' });
    expect(await screen.findByText(/do not have access to this page/i)).toBeInTheDocument();
  });

  it('is reachable from the sidebar, the dashboard and the contact page', async () => {
    mockApi({ ...routes() });
    renderApp({ route: '/contacts/c1' });
    expect(await screen.findByRole('link', { name: 'Add ledger entry' })).toHaveAttribute('href', '/ledger/new?contactId=c1');
    expect(within(screen.getByRole('navigation')).getByRole('link', { name: 'Ledger' })).toBeInTheDocument();
  });
});
