import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { formatDay } from '../src/lib/format.js';
import { baseRoutes, contact, fail, ledgerPayload, ledgerRow, mockApi, ok, paged, renderApp, sessionPayload } from './helpers.jsx';
import { doc, docLine, listRow, posted, settingsPayload } from './fixtures.jsx';

afterEach(() => vi.unstubAllGlobals());

const as = (roleKey, extra = {}) => baseRoutes(sessionPayload({ roleKey, ...extra }));

describe('the list', () => {
  const rows = [
    listRow({ id: 'a', status: 'posted', referenceNo: 'SI-2082/83-0002', txnDate: '2025-08-10', dueDate: '2025-09-10', total: '1500.00', contact: { id: 'c1', name: 'Ram Bahadur' }, description: 'Cement +1 more' }),
    listRow({ id: 'b', status: 'draft', referenceNo: null, total: '300.00', contact: { id: 'c2', name: 'Sita Stores' } }),
    listRow({ id: 'c', status: 'voided', referenceNo: 'SI-2082/83-0001', total: '90.00' }),
  ];

  it('shows the number (or "Draft"), contact, due date, total and status, and links to each document', async () => {
    mockApi({ ...as('owner'), 'GET /sales': paged(rows) });
    renderApp({ route: '/sales' });
    const first = (await screen.findByRole('link', { name: 'SI-2082/83-0002' })).closest('tr');
    expect(first.querySelector('a').getAttribute('href')).toBe('/sales/a');
    expect(within(first).getByText('Cement +1 more')).toBeInTheDocument();
    expect(within(first).getByRole('link', { name: 'Ram Bahadur' })).toHaveAttribute('href', '/contacts/c1');
    expect(within(first).getByText(formatDay('2025-09-10', 'BS'))).toBeInTheDocument();
    expect(within(first).getByText('रु 1,500.00')).toBeInTheDocument();
    expect(within(first).getByText('Posted')).toBeInTheDocument();

    const draft = screen.getByRole('link', { name: 'Draft' }).closest('tr');
    expect(within(draft).getByText('Draft', { selector: 'span' })).toBeInTheDocument();
    expect(within(screen.getByRole('link', { name: 'SI-2082/83-0001' }).closest('tr')).getByText('Voided')).toBeInTheDocument();
  });

  it('offers to create one, to those who may', async () => {
    mockApi({ ...as('owner'), 'GET /sales': paged(rows) });
    renderApp({ route: '/sales' });
    expect(await screen.findByRole('link', { name: 'New sales invoice' })).toHaveAttribute('href', '/sales/new');
  });

  it('filters by status and search on the server', async () => {
    const api = mockApi({ ...as('owner'), 'GET /sales': paged(rows) });
    const user = userEvent.setup();
    renderApp({ route: '/sales' });
    await screen.findByRole('link', { name: 'SI-2082/83-0002' });
    expect(api.calledWith('GET /sales')[0].query.get('status')).toBe('all');
    await user.selectOptions(screen.getByLabelText('Show'), 'draft');
    await waitFor(() => expect(api.lastCall('GET /sales').query.get('status')).toBe('draft'));
    await user.type(screen.getByLabelText('Search'), 'cement');
    await waitFor(() => expect(api.lastCall('GET /sales').query.get('q')).toBe('cement'));
  });

  it('has an empty state with a button, only for those who may create', async () => {
    mockApi({ ...as('owner'), 'GET /sales': paged([]) });
    renderApp({ route: '/sales' });
    expect(await screen.findByText('No sales yet')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'New sales invoice' })).toHaveLength(2); // in the header and in the empty state
  });

  it('a viewer sees the list with no create button', async () => {
    mockApi({ ...as('viewer'), 'GET /sales': paged(rows) });
    renderApp({ route: '/sales' });
    await screen.findByRole('link', { name: 'SI-2082/83-0002' });
    expect(screen.queryByRole('link', { name: 'New sales invoice' })).not.toBeInTheDocument();
  });

  it('purchases use supplier wording and their own endpoint', async () => {
    mockApi({ ...as('owner'), 'GET /purchases': paged([listRow({ id: 'p', status: 'posted', referenceNo: 'PB-2082/83-0001' })]) });
    renderApp({ route: '/purchases' });
    expect(await screen.findByRole('link', { name: 'PB-2082/83-0001' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Purchases' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Supplier' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Record purchase bill' })).toHaveAttribute('href', '/purchases/new');
  });

  it('is closed to someone who may not view sales', async () => {
    mockApi({ ...baseRoutes(sessionPayload({ roleKey: 'staff', permissions: ['business.view'] })) });
    renderApp({ route: '/sales' });
    expect(await screen.findByText(/do not have access to this page/i)).toBeInTheDocument();
  });
});

describe('the form', () => {
  const ram = contact({ id: 'c1', name: 'Ram Bahadur', balance: { amount: '5000.00', side: 'receivable' } });
  const routes = (extra = {}, { settings, role = 'owner', kind = 'sales' } = {}) => ({
    ...as(role),
    'GET /settings': settingsPayload(settings),
    'GET /contacts': paged([ram]),
    'GET /contacts/c1': ok({ ...ram, openingBalance: null }),
    'POST /sales': ok(doc({ id: 'new1' }), 201),
    'GET /sales/new1': ok(doc({ id: 'new1' })),
    'GET /purchases/new1': ok(doc({ id: 'new1', type: 'purchase' })),
    ...extra,
  });
  const line = (n = 1) => within(screen.getByRole('group', { name: `Line ${n}` }));
  const fillLine = async (user, n, { item, qty, price, discount }) => {
    const row = line(n);
    if (item !== undefined) await user.type(row.getByLabelText('Item'), item);
    if (qty !== undefined) { await user.clear(row.getByLabelText('Quantity')); await user.type(row.getByLabelText('Quantity'), qty); }
    if (price !== undefined) await user.type(row.getByLabelText('Unit price'), price);
    if (discount !== undefined) await user.type(row.getByLabelText('Discount'), discount);
  };
  const totals = () => within(screen.getByRole('definition', { hidden: false }).closest('dl') ?? document.body);
  const pickRam = async (user) => {
    await user.type(await screen.findByRole('combobox', { name: /Customer/ }), 'ra');
    await user.click(await screen.findByRole('button', { name: /Ram Bahadur/ }));
  };

  it('starts with one empty row, and cannot be saved until a customer and a valid line exist', async () => {
    mockApi(routes());
    const user = userEvent.setup();
    renderApp({ route: '/sales/new' });
    expect(await screen.findByRole('heading', { level: 1, name: 'New sales invoice' })).toBeInTheDocument();
    expect(screen.getAllByRole('group', { name: /^Line / })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();
    expect(screen.getByText('Choose a customer to continue.')).toBeInTheDocument();
    await pickRam(user);
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled(); // still no line
    expect(screen.getByText('Add a line to see the total')).toBeInTheDocument();
    await fillLine(user, 1, { item: 'Rice', price: '100' });
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeEnabled();
  });

  it('adds up as you type: lines, line discount, and the discount on the whole document', async () => {
    mockApi(routes());
    const user = userEvent.setup();
    renderApp({ route: '/sales/new' });
    await screen.findByRole('heading', { level: 1, name: 'New sales invoice' });
    await fillLine(user, 1, { item: 'Rice', qty: '3', price: '100', discount: '20' });
    expect(line(1).getByText('रु 280.00')).toBeInTheDocument(); // 300 - 20
    await user.click(screen.getByRole('button', { name: 'Add line' }));
    await fillLine(user, 2, { item: 'Oil', qty: '1', price: '220' });
    const panel = within(screen.getByLabelText('Totals'));
    expect(panel.getByText('रु 520.00')).toBeInTheDocument(); // subtotal: 300 + 220
    expect(panel.getByText('रु 20.00')).toBeInTheDocument(); // the line discount
    expect(panel.getByText('रु 500.00')).toBeInTheDocument(); // total: 280 + 220
    await user.type(screen.getByLabelText('Discount on the whole document'), '20');
    expect(within(screen.getByLabelText('Totals')).getByText('रु 40.00')).toBeInTheDocument(); // both discounts
    expect(within(screen.getByLabelText('Totals')).getByText('रु 480.00')).toBeInTheDocument(); // total: 500 - 20
  });

  it('removes a line, but never the last one', async () => {
    mockApi(routes());
    const user = userEvent.setup();
    renderApp({ route: '/sales/new' });
    await screen.findByRole('heading', { level: 1, name: 'New sales invoice' });
    expect(screen.queryByRole('button', { name: 'Remove line 1' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add line' }));
    await user.click(screen.getByRole('button', { name: 'Remove line 2' }));
    expect(screen.getAllByRole('group', { name: /^Line / })).toHaveLength(1);
  });

  it('hides VAT controls and totals for a business that is not registered for VAT', async () => {
    mockApi(routes());
    renderApp({ route: '/sales/new' });
    await screen.findByRole('heading', { level: 1, name: 'New sales invoice' });
    expect(screen.queryByLabelText('Charge VAT')).not.toBeInTheDocument();
    expect(screen.queryByText('VAT', { selector: 'dt' })).not.toBeInTheDocument();
  });

  it('with VAT on: the worked example adds up to 508.48, with taxable, VAT and total shown apart', async () => {
    mockApi(routes({}, { settings: { settings: { isVatRegistered: true, defaultVatRate: '13.00' } } }));
    const user = userEvent.setup();
    renderApp({ route: '/sales/new' });
    await screen.findByRole('heading', { level: 1, name: 'New sales invoice' });
    await fillLine(user, 1, { item: 'Goods', qty: '2.5', price: '199.99', discount: '50' });
    await user.click(line(1).getByLabelText('Charge VAT'));
    expect(line(1).getByLabelText('VAT rate %')).toHaveAttribute('placeholder', '13'); // the business default
    const panel = within(screen.getByLabelText('Totals'));
    expect(panel.getByText('Taxable amount')).toBeInTheDocument();
    expect(panel.getByText('रु 449.98')).toBeInTheDocument();
    expect(panel.getByText('रु 58.50')).toBeInTheDocument();
    expect(panel.getAllByText('रु 508.48').length).toBeGreaterThan(0);
  });

  it('uses a rate typed on the line instead of the default', async () => {
    mockApi(routes({}, { settings: { settings: { isVatRegistered: true, defaultVatRate: '13.00' } } }));
    const user = userEvent.setup();
    renderApp({ route: '/sales/new' });
    await screen.findByRole('heading', { level: 1, name: 'New sales invoice' });
    await fillLine(user, 1, { item: 'Goods', qty: '1', price: '1000' });
    await user.click(line(1).getByLabelText('Charge VAT'));
    await user.type(line(1).getByLabelText('VAT rate %'), '5');
    expect(within(screen.getByLabelText('Totals')).getByText('रु 50.00')).toBeInTheDocument();
  });

  it('asks for a rate when VAT is on but no default rate exists', async () => {
    mockApi(routes({}, { settings: { settings: { isVatRegistered: true, defaultVatRate: null } } }));
    const user = userEvent.setup();
    renderApp({ route: '/sales/new' });
    await screen.findByRole('heading', { level: 1, name: 'New sales invoice' });
    await fillLine(user, 1, { item: 'Goods', price: '100' });
    await user.click(line(1).getByLabelText('Charge VAT'));
    expect(within(screen.getByRole('group', { name: 'Line 1' })).getByRole('alert')).toHaveTextContent(/Enter a VAT rate/);
    expect(screen.getByText('Fix the highlighted lines to see the total')).toBeInTheDocument();
  });

  it('points at a line whose discount is more than its amount, and holds back the total', async () => {
    mockApi(routes());
    const user = userEvent.setup();
    renderApp({ route: '/sales/new' });
    await screen.findByRole('heading', { level: 1, name: 'New sales invoice' });
    await fillLine(user, 1, { item: 'Rice', qty: '1', price: '100', discount: '150' });
    expect(line(1).getByRole('alert')).toHaveTextContent('discount cannot be more than the line amount');
  });

  it('says what posting will do to the contact’s account', async () => {
    mockApi(routes());
    const user = userEvent.setup();
    renderApp({ route: '/sales/new?contactId=c1' });
    await screen.findByText('Ram Bahadur');
    await fillLine(user, 1, { item: 'Rice', qty: '2', price: '100' });
    expect(screen.getByRole('status')).toHaveTextContent('After posting: Ram Bahadur will owe you रु 5,200.00.');
    expect(screen.getByText(/Posting adds this to Ram Bahadur's account/)).toBeInTheDocument();
  });

  it('for a purchase it lowers the balance instead, in supplier words', async () => {
    mockApi(routes({ 'POST /purchases': ok(doc({ id: 'new1', type: 'purchase' }), 201) }));
    const user = userEvent.setup();
    renderApp({ route: '/purchases/new?contactId=c1' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Record purchase bill' })).toBeInTheDocument();
    await fillLine(user, 1, { item: 'Stock', qty: '1', price: '6000' });
    expect(screen.getByRole('status')).toHaveTextContent('After posting: You will owe Ram Bahadur रु 1,000.00.');
    expect(screen.getByLabelText("Supplier's bill number")).toBeInTheDocument();
    expect(screen.getByText(/^Bill date/)).toBeInTheDocument();
  });

  it('shows the due date that will apply when the business has credit days', async () => {
    mockApi(routes({}, { settings: { settings: { defaultCreditDays: 30 } } }));
    renderApp({ route: '/sales/new' });
    expect(await screen.findByText(/If left empty: due .* \(30 days\)/)).toBeInTheDocument();
  });

  it('saves a draft: sends only the rows that were filled in, with the right fields, then opens the document', async () => {
    const api = mockApi(routes());
    const user = userEvent.setup();
    renderApp({ route: '/sales/new?contactId=c1' });
    await screen.findByText('Ram Bahadur');
    await user.click(screen.getByRole('button', { name: 'Add line' })); // an empty row in the middle
    await user.click(screen.getByRole('button', { name: 'Add line' }));
    await fillLine(user, 1, { item: 'Rice', qty: '2', price: '100' });
    await fillLine(user, 3, { item: 'Oil', qty: '1', price: '250', discount: '10' });
    await user.type(screen.getByLabelText('Discount on the whole document'), '5');
    await user.type(screen.getByLabelText('Your reference (optional)'), 'PO-77');
    await user.type(screen.getByLabelText('Notes'), 'deliver Friday');
    await user.click(screen.getByRole('button', { name: 'Save draft' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Draft sales invoice' })).toBeInTheDocument();
    expect(api.calledWith('POST /sales')[0].body).toEqual({
      contactId: 'c1',
      txnDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      externalRef: 'PO-77',
      notes: 'deliver Friday',
      lines: [
        { description: 'Rice', quantity: '2', unit: '', unitPrice: '100', taxable: false },
        { description: 'Oil', quantity: '1', unit: '', unitPrice: '250', discount: '10', taxable: false },
      ],
      invoiceDiscount: '5',
      post: false,
    });
  });

  it('"Save and post" sends post: true', async () => {
    const api = mockApi(routes());
    const user = userEvent.setup();
    renderApp({ route: '/sales/new?contactId=c1' });
    await screen.findByText('Ram Bahadur');
    await fillLine(user, 1, { item: 'Rice', price: '100' });
    await user.click(screen.getByRole('button', { name: 'Save and post' }));
    await screen.findByRole('heading', { level: 1 });
    expect(api.calledWith('POST /sales')[0].body.post).toBe(true);
  });

  it('sends VAT fields only when VAT is on and the line is marked', async () => {
    const api = mockApi(routes({}, { settings: { settings: { isVatRegistered: true, defaultVatRate: '13.00' } } }));
    const user = userEvent.setup();
    renderApp({ route: '/sales/new?contactId=c1' });
    await screen.findByText('Ram Bahadur');
    await fillLine(user, 1, { item: 'Taxed', price: '100' });
    await user.click(line(1).getByLabelText('Charge VAT'));
    await user.click(screen.getByRole('button', { name: 'Add line' }));
    await fillLine(user, 2, { item: 'Exempt', price: '50' });
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    await screen.findByRole('heading', { level: 1 });
    const sent = api.calledWith('POST /sales')[0].body.lines;
    expect(sent[0]).toMatchObject({ taxable: true });
    expect(sent[0]).not.toHaveProperty('taxRate'); // the server applies the business default
    expect(sent[1]).toMatchObject({ taxable: false });
  });

  it('puts the server’s line message on the right row even when blank rows were skipped', async () => {
    mockApi(routes({
      'POST /sales': fail(400, 'VALIDATION_FAILED', 'Some fields are invalid', [
        { field: 'lines.0.quantity', message: 'Quantity must be above zero with at most 3 decimal places' },
        { field: 'contactId', message: 'Choose a customer' },
      ]),
    }));
    const user = userEvent.setup();
    renderApp({ route: '/sales/new?contactId=c1' });
    await screen.findByText('Ram Bahadur');
    await user.click(screen.getByRole('button', { name: 'Add line' }));
    await fillLine(user, 2, { item: 'Second row only', price: '10' }); // row 1 stays blank
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await line(2).findByText('Quantity must be above zero with at most 3 decimal places')).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Line 1' })).queryByText(/Quantity must/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Item', { selector: '#' + line(2).getByLabelText('Item').id })).toHaveValue('Second row only'); // nothing lost
  });

  it('shows a general line message (like a discount problem) above the items', async () => {
    mockApi(routes({ 'POST /sales': fail(400, 'VALIDATION_FAILED', 'Some fields are invalid', [{ field: 'lines', message: 'Line 1: discount cannot be more than the line amount' }]) }));
    const user = userEvent.setup();
    renderApp({ route: '/sales/new?contactId=c1' });
    await screen.findByText('Ram Bahadur');
    await fillLine(user, 1, { item: 'Rice', price: '10' });
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Line 1: discount cannot be more');
  });

  it('opens a draft for editing with its values, sends the change, and can post it', async () => {
    const draft = doc({
      id: 'd9', notes: 'old note', externalRef: 'PO-1', dueDate: '2025-09-01',
      lines: [docLine({ description: 'Rice', quantity: '2.500', unit: 'kg', unitPrice: '100.00', discount: '10.00' }), docLine({ lineNo: 2, description: 'Oil', quantity: '1.000', unit: null, unitPrice: '300.00' })],
    });
    const api = mockApi(routes({ 'GET /sales/d9': ok(draft), 'PATCH /sales/d9': ok(draft), 'POST /sales/d9/post': ok(posted({ id: 'd9' })) }));
    const user = userEvent.setup();
    renderApp({ route: '/sales/d9/edit' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Edit draft sales invoice' })).toBeInTheDocument();
    expect(line(1).getByLabelText('Item')).toHaveValue('Rice');
    expect(line(1).getByLabelText('Quantity')).toHaveValue('2.5');
    expect(line(1).getByLabelText('Unit')).toHaveValue('kg');
    expect(line(1).getByLabelText('Discount')).toHaveValue('10.00');
    expect(line(2).getByLabelText('Discount')).toHaveValue('');
    expect(screen.getByLabelText('Notes')).toHaveValue('old note');

    await user.clear(line(2).getByLabelText('Unit price'));
    await user.type(line(2).getByLabelText('Unit price'), '350');
    await user.click(screen.getByRole('button', { name: 'Save and post' }));
    await waitFor(() => expect(api.calledWith('POST /sales/d9/post')).toHaveLength(1));
    const sent = api.calledWith('PATCH /sales/d9')[0].body;
    expect(sent.lines[1]).toMatchObject({ description: 'Oil', unitPrice: '350' });
    expect(sent).toMatchObject({ contactId: 'c1', externalRef: 'PO-1', dueDate: '2025-09-01', notes: 'old note' });
  });

  it('refuses to edit a document that is already posted, and says what to do instead', async () => {
    mockApi(routes({ 'GET /sales/d9': ok(posted({ id: 'd9' })) }));
    renderApp({ route: '/sales/d9/edit' });
    expect(await screen.findByText(/Only a draft can be edited/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to the document' })).toHaveAttribute('href', '/sales/d9');
  });

  it('is closed to a viewer', async () => {
    mockApi(routes({}, { role: 'viewer' }));
    renderApp({ route: '/sales/new' });
    expect(await screen.findByText(/do not have access to this page/i)).toBeInTheDocument();
  });
});

describe('a document page', () => {
  const routes = (document, extra = {}, role = 'owner') => ({
    ...as(role),
    [`GET /${document.type === 'purchase' ? 'purchases' : 'sales'}/${document.id}`]: ok(document),
    'GET /sales': paged([]),
    ...extra,
  });

  it('a draft: explains it is a draft, and offers Post, Edit and Delete', async () => {
    mockApi(routes(doc()));
    renderApp({ route: '/sales/d1' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Draft sales invoice' })).toBeInTheDocument();
    expect(screen.getByText(/has no number yet and does not change any balance/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Post' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Edit' })).toHaveAttribute('href', '/sales/d1/edit');
    expect(screen.getByRole('button', { name: 'Delete draft' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Void' })).not.toBeInTheDocument();
  });

  it('shows the items and the totals breakdown', async () => {
    mockApi(routes(doc({
      totals: { subtotal: '600.00', discount: '60.00', taxable: '540.00', nonTaxable: '0.00', tax: '70.20', total: '610.20' },
      lines: [docLine({ description: 'Goods', quantity: '3.000', unit: 'pcs', unitPrice: '200.00', grossAmount: '600.00', discount: '50.00', invoiceDiscountShare: '10.00', taxable: true, taxRate: '13.00', taxableAmount: '540.00', taxAmount: '70.20', lineTotal: '610.20' })],
    })));
    renderApp({ route: '/sales/d1' });
    const row = (await screen.findByText('Goods')).closest('tr');
    expect(within(row).getByText('3 pcs')).toBeInTheDocument();
    expect(within(row).getByText('रु 60.00')).toBeInTheDocument(); // 50 line discount + 10 share
    expect(within(row).getByText(/13% ·/)).toBeInTheDocument();
    const totals = within(screen.getByLabelText('Totals'));
    expect(totals.getByText('Taxable amount')).toBeInTheDocument();
    expect(totals.getByText('रु 70.20')).toBeInTheDocument();
    expect(totals.getByText('रु 610.20')).toBeInTheDocument();
  });

  it('leaves the VAT columns out for a document with no VAT', async () => {
    mockApi(routes(doc()));
    renderApp({ route: '/sales/d1' });
    await screen.findByText('Rice');
    expect(screen.queryByRole('columnheader', { name: 'VAT' })).not.toBeInTheDocument();
    expect(screen.queryByText('Taxable amount')).not.toBeInTheDocument();
  });

  it('posts after a confirmation that explains what it means', async () => {
    const api = mockApi(routes(doc(), { 'POST /sales/d1/post': ok(posted()) }));
    const user = userEvent.setup();
    renderApp({ route: '/sales/d1' });
    await user.click(await screen.findByRole('button', { name: 'Post' }));
    const dialog = screen.getByRole('dialog', { name: 'Post this sales invoice?' });
    expect(within(dialog).getByText(/only the notes and reference can be edited/)).toBeInTheDocument();
    expect(api.calledWith('POST /sales/d1/post')).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: 'Post' }));
    await waitFor(() => expect(api.calledWith('POST /sales/d1/post')).toHaveLength(1));
  });

  it('shows why posting failed', async () => {
    mockApi(routes(doc(), { 'POST /sales/d1/post': fail(409, 'CONFLICT', 'This contact is archived. Unarchive it before adding entries.') }));
    const user = userEvent.setup();
    renderApp({ route: '/sales/d1' });
    await user.click(await screen.findByRole('button', { name: 'Post' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Post' }));
    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent('Unarchive it');
  });

  it('deletes a draft only after a confirmation, then returns to the list', async () => {
    const api = mockApi(routes(doc(), { 'DELETE /sales/d1': ok({ deleted: true }) }));
    const user = userEvent.setup();
    renderApp({ route: '/sales/d1' });
    await user.click(await screen.findByRole('button', { name: 'Delete draft' }));
    expect(api.calledWith('DELETE /sales/d1')).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Confirm delete' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Sales' })).toBeInTheDocument();
    expect(api.calledWith('DELETE /sales/d1')).toHaveLength(1);
  });

  it('a posted document: shows its number, and offers only Void and "Edit notes and reference"', async () => {
    mockApi(routes(posted()));
    renderApp({ route: '/sales/d1' });
    expect(await screen.findByRole('heading', { level: 1, name: 'SI-2082/83-0001' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Void' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit notes and reference' })).toBeInTheDocument();
    for (const name of ['Post', 'Delete draft']) expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Edit' })).not.toBeInTheDocument();
  });

  it('voids with a reason', async () => {
    const api = mockApi(routes(posted(), { 'POST /sales/d1/void': ok(posted({ status: 'voided' })) }));
    const user = userEvent.setup();
    renderApp({ route: '/sales/d1' });
    await user.click(await screen.findByRole('button', { name: 'Void' }));
    const dialog = screen.getByRole('dialog', { name: 'Void SI-2082/83-0001?' });
    await user.type(within(dialog).getByLabelText(/Reason/), 'Customer returned everything');
    await user.click(within(dialog).getByRole('button', { name: 'Void' }));
    await waitFor(() => expect(api.calledWith('POST /sales/d1/void')).toHaveLength(1));
    expect(api.calledWith('POST /sales/d1/void')[0].body).toEqual({ reason: 'Customer returned everything' });
  });

  it('shows a missing reason from the server inside the dialog', async () => {
    mockApi(routes(posted(), { 'POST /sales/d1/void': fail(400, 'VALIDATION_FAILED', 'Some fields are invalid', [{ field: 'reason', message: 'Give a reason (at least 3 characters)' }]) }));
    const user = userEvent.setup();
    renderApp({ route: '/sales/d1' });
    await user.click(await screen.findByRole('button', { name: 'Void' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Void' }));
    expect(await screen.findByText('Give a reason (at least 3 characters)')).toBeInTheDocument();
  });

  it('edits only the notes and reference of a posted document', async () => {
    const api = mockApi(routes(posted({ notes: 'first', externalRef: 'A-1' }), { 'PATCH /sales/d1': ok(posted()) }));
    const user = userEvent.setup();
    renderApp({ route: '/sales/d1' });
    await user.click(await screen.findByRole('button', { name: 'Edit notes and reference' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/Amounts, items and dates of a posted document cannot be changed/)).toBeInTheDocument();
    const notes = within(dialog).getByLabelText('Notes');
    expect(notes).toHaveValue('first');
    await user.clear(notes);
    await user.type(notes, 'second');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.calledWith('PATCH /sales/d1')).toHaveLength(1));
    expect(api.calledWith('PATCH /sales/d1')[0].body).toEqual({ notes: 'second', externalRef: 'A-1' });
  });

  it('a voided document: shows the reason and offers nothing', async () => {
    mockApi(routes(posted({ status: 'voided', voidedAt: '2026-10-05T00:00:00Z', voidReason: 'Customer returned everything' })));
    renderApp({ route: '/sales/d1' });
    expect(await screen.findByText(/Customer returned everything/)).toBeInTheDocument();
    expect(screen.getByText(/no longer counts toward the balance but stays on record/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Void|Post|Delete|Edit/ })).not.toBeInTheDocument();
  });

  it('a viewer can read it but not change it', async () => {
    mockApi(routes(posted(), {}, 'viewer'));
    renderApp({ route: '/sales/d1' });
    await screen.findByRole('heading', { level: 1, name: 'SI-2082/83-0001' });
    expect(screen.queryByRole('button', { name: /Void|Edit notes/ })).not.toBeInTheDocument();
  });

  it('staff can post but cannot void (only the owner and accountant can)', async () => {
    mockApi(routes(posted(), {}, 'staff'));
    renderApp({ route: '/sales/d1' });
    await screen.findByRole('heading', { level: 1, name: 'SI-2082/83-0001' });
    expect(screen.queryByRole('button', { name: 'Void' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit notes and reference' })).toBeInTheDocument();
  });

  it('a purchase uses its own endpoint and wording', async () => {
    mockApi(routes(doc({ id: 'p1', type: 'purchase', externalRef: 'SUP-9' }), { 'GET /purchases': paged([]) }));
    renderApp({ route: '/purchases/p1' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Draft purchase bill' })).toBeInTheDocument();
    expect(screen.getByText("Supplier's bill number")).toBeInTheDocument();
    expect(screen.getByText('SUP-9')).toBeInTheDocument();
  });

  it('says so, with a way back, when the document is not there', async () => {
    mockApi({ ...as('owner'), 'GET /sales/d1': fail(404, 'NOT_FOUND', 'Sales invoice not found') });
    renderApp({ route: '/sales/d1' });
    expect(await screen.findByRole('heading', { name: 'Sales invoice not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to sales' })).toBeInTheDocument();
  });
});

describe('invoices in the contact’s account', () => {
  it('appear in the contact ledger with a badge, linking to the document', async () => {
    mockApi({
      ...as('owner'),
      'GET /contacts/c1': ok({ ...contact(), openingBalance: null }),
      'GET /ledger/contacts/c1': ledgerPayload([
        ledgerRow({ id: 's1', type: 'sale', referenceNo: 'SI-2082/83-0001', description: 'Cement +1 more', debit: '900.00', balance: '900.00' }),
        ledgerRow({ id: 'p1', type: 'purchase', referenceNo: 'PB-2082/83-0001', description: 'Stock', debit: null, credit: '300.00', balance: '600.00' }),
        ledgerRow({ id: 'e1', type: 'ledger_entry', referenceNo: 'LE-2082/83-0001', description: 'Cash given', debit: '50.00', balance: '650.00' }),
      ]),
    });
    renderApp({ route: '/contacts/c1' });
    expect(await screen.findByRole('link', { name: 'SI-2082/83-0001' })).toHaveAttribute('href', '/sales/s1');
    expect(screen.getByRole('link', { name: 'PB-2082/83-0001' })).toHaveAttribute('href', '/purchases/p1');
    expect(screen.queryByRole('link', { name: 'LE-2082/83-0001' })).not.toBeInTheDocument(); // direct entries have no page of their own
    expect(screen.getByText('Sales invoice')).toBeInTheDocument();
    expect(screen.getByText('Purchase bill')).toBeInTheDocument();
    // invoices are voided from their own page, not from the ledger
    expect(screen.queryByRole('button', { name: 'Void SI-2082/83-0001' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Void LE-2082/83-0001' })).toBeInTheDocument();
  });

  it('the contact page offers to start an invoice or a bill for that contact', async () => {
    mockApi({ ...as('owner'), 'GET /contacts/c1': ok({ ...contact(), openingBalance: null }), 'GET /ledger/contacts/c1': ledgerPayload([]) });
    renderApp({ route: '/contacts/c1' });
    expect(await screen.findByRole('link', { name: 'New sales invoice' })).toHaveAttribute('href', '/sales/new?contactId=c1');
    expect(screen.getByRole('link', { name: 'Record purchase' })).toHaveAttribute('href', '/purchases/new?contactId=c1');
  });

  it('…but not to someone who may not create them', async () => {
    mockApi({ ...as('viewer'), 'GET /contacts/c1': ok({ ...contact(), openingBalance: null }), 'GET /ledger/contacts/c1': ledgerPayload([]) });
    renderApp({ route: '/contacts/c1' });
    await screen.findByRole('heading', { level: 1, name: 'Ram Bahadur' });
    expect(screen.queryByRole('link', { name: 'New sales invoice' })).not.toBeInTheDocument();
  });
});
