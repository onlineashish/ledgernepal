import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { baseRoutes, contact, fail, mockApi, ok, paged, renderApp, sessionPayload } from './helpers.jsx';
import { openDoc, posted, settlement } from './fixtures.jsx';

afterEach(() => vi.unstubAllGlobals());

const as = (roleKey) => baseRoutes(sessionPayload({ roleKey }));

describe('the list', () => {
  it('shows receipts, with the advance, and switches to payments', async () => {
    const api = mockApi({
      ...as('owner'),
      'GET /receipts': paged([settlement(), settlement({ id: 'r2', referenceNo: 'RC-2082/83-0002', amount: '100.00', unallocated: '0.00', method: 'esewa' })]),
      'GET /payments': paged([settlement({ id: 'p1', type: 'payment', referenceNo: 'PM-2082/83-0001' })]),
    });
    const user = userEvent.setup();
    renderApp({ route: '/receipts-payments' });
    const first = (await screen.findByRole('link', { name: 'RC-2082/83-0001' })).closest('tr');
    expect(first.querySelector('a').getAttribute('href')).toBe('/receipts-payments/receipts/r1');
    expect(within(first).getByText('Cash')).toBeInTheDocument();
    expect(within(first).getAllByText('रु 400.00')).toHaveLength(2); // amount and advance
    expect(screen.getByRole('link', { name: 'Record receipt' })).toHaveAttribute('href', '/receipts-payments/new-receipt');

    await user.click(screen.getByRole('tab', { name: 'Payments' }));
    expect(await screen.findByRole('link', { name: 'PM-2082/83-0001' })).toHaveAttribute('href', '/receipts-payments/payments/p1');
    expect(screen.getByRole('link', { name: 'Record payment' })).toBeInTheDocument();
    expect(api.calledWith('GET /payments')).not.toHaveLength(0);
  });

  it('staff see receipts only (they may not view payments)', async () => {
    mockApi({ ...as('staff'), 'GET /receipts': paged([settlement()]) });
    renderApp({ route: '/receipts-payments' });
    await screen.findByRole('link', { name: 'RC-2082/83-0001' });
    expect(screen.queryByRole('tab', { name: 'Payments' })).not.toBeInTheDocument();
  });

  it('a viewer sees them with no record button', async () => {
    mockApi({ ...as('viewer'), 'GET /receipts': paged([settlement()]) });
    renderApp({ route: '/receipts-payments' });
    await screen.findByRole('link', { name: 'RC-2082/83-0001' });
    expect(screen.queryByRole('link', { name: 'Record receipt' })).not.toBeInTheDocument();
  });
});

describe('recording a receipt', () => {
  const routes = (extra = {}) => ({
    ...as('owner'),
    'GET /contacts/c1': ok(contact()),
    'GET /receipts/open-documents': ok([
      openDoc({ id: 'new', referenceNo: 'SI-2082/83-0002', txnDate: '2025-08-09', total: '300.00', outstanding: '300.00' }),
      openDoc({ id: 'old', referenceNo: 'SI-2082/83-0001', txnDate: '2025-08-01', total: '500.00', outstanding: '500.00', overdue: true }),
    ]),
    'POST /receipts': ok(settlement(), 201),
    'GET /receipts/r1': ok(settlement()),
    ...extra,
  });

  it('applies oldest first, and says what is applied', async () => {
    mockApi(routes());
    const user = userEvent.setup();
    renderApp({ route: '/receipts-payments/new-receipt?contactId=c1' });
    await user.type(await screen.findByLabelText(/Amount/), '600');
    await user.click(await screen.findByRole('button', { name: 'Apply oldest first' }));
    expect(screen.getByLabelText('Apply to SI-2082/83-0001')).toHaveValue('500.00');
    expect(screen.getByLabelText('Apply to SI-2082/83-0002')).toHaveValue('100.00');
    expect(screen.getByText(/Applied रु 600.00/)).toBeInTheDocument();
    expect(screen.getByText('Overdue')).toBeInTheDocument();
  });

  it('sends only the documents with an amount, then opens the receipt', async () => {
    const api = mockApi(routes());
    const user = userEvent.setup();
    renderApp({ route: '/receipts-payments/new-receipt?contactId=c1' });
    await user.type(await screen.findByLabelText(/Amount/), '400');
    await user.type(await screen.findByLabelText('Apply to SI-2082/83-0001'), '250');
    expect(await screen.findByText(/रु 150.00 stays as an advance/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save receipt' }));
    await waitFor(() => expect(api.calledWith('POST /receipts')).toHaveLength(1));
    expect(api.lastCall('POST /receipts').body).toMatchObject({ contactId: 'c1', amount: '400', method: 'cash', allocations: [{ invoiceId: 'old', amount: '250' }] });
    expect(await screen.findByText('Advance (not applied)')).toBeInTheDocument(); // landed on the receipt page
  });

  it('will not let you apply more than the amount', async () => {
    const api = mockApi(routes());
    const user = userEvent.setup();
    renderApp({ route: '/receipts-payments/new-receipt?contactId=c1' });
    await user.type(await screen.findByLabelText(/Amount/), '100');
    await user.type(await screen.findByLabelText('Apply to SI-2082/83-0001'), '250');
    expect(await screen.findByText(/more than the रु 100.00 received/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save receipt' })).toBeDisabled();
    expect(api.calledWith('POST /receipts')).toHaveLength(0);
  });

  it('shows the server’s reason against the document', async () => {
    mockApi(routes({ 'POST /receipts': fail(400, 'VALIDATION_FAILED', 'Check the form', [{ field: 'allocations.0.amount', message: 'Only 300.00 is still outstanding on SI-2082/83-0002' }]) }));
    const user = userEvent.setup();
    renderApp({ route: '/receipts-payments/new-receipt?contactId=c1' });
    await user.type(await screen.findByLabelText(/Amount/), '900');
    await user.type(await screen.findByLabelText('Apply to SI-2082/83-0002'), '300');
    await user.click(screen.getByRole('button', { name: 'Save receipt' }));
    expect(await screen.findByText('Only 300.00 is still outstanding on SI-2082/83-0002')).toBeInTheDocument();
  });

  it('with no open invoices, keeps it as an advance', async () => {
    mockApi(routes({ 'GET /receipts/open-documents': ok([]) }));
    renderApp({ route: '/receipts-payments/new-receipt?contactId=c1' });
    expect(await screen.findByText(/no unpaid sales invoices/)).toBeInTheDocument();
  });

  it('coming from an invoice, starts with that invoice fully applied', async () => {
    mockApi(routes());
    renderApp({ route: '/receipts-payments/new-receipt?contactId=c1&documentId=old' });
    await waitFor(() => expect(screen.getByLabelText(/Amount/)).toHaveValue('500.00'));
    expect(screen.getByLabelText('Apply to SI-2082/83-0001')).toHaveValue('500.00');
  });

  it('payments use supplier wording and their own endpoints', async () => {
    const api = mockApi({
      ...as('owner'),
      'GET /contacts/c1': ok(contact({ name: 'Hari Supplier' })),
      'GET /payments/open-documents': ok([openDoc({ referenceNo: 'PB-2082/83-0001' })]),
    });
    renderApp({ route: '/receipts-payments/new-payment?contactId=c1' });
    expect(await screen.findByText('Apply to purchase bills')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save payment' })).toBeInTheDocument();
    expect(api.calledWith('GET /receipts/open-documents')).toHaveLength(0);
  });

  it('is closed to someone who may not record it', async () => {
    mockApi(as('viewer'));
    renderApp({ route: '/receipts-payments/new-receipt' });
    expect(await screen.findByText('You do not have access to this page')).toBeInTheDocument();
  });
});

describe('a receipt page', () => {
  const withAllocation = settlement({
    allocated: '400.00', unallocated: '0.00',
    allocations: [{ id: 'a1', amount: '400.00', document: { id: 'd1', type: 'sale', referenceNo: 'SI-2082/83-0001', txnDate: '2025-08-01', total: '1000.00' } }],
  });

  it('lists what it paid, linking to the invoice', async () => {
    mockApi({ ...as('owner'), 'GET /receipts/r1': ok(withAllocation) });
    renderApp({ route: '/receipts-payments/receipts/r1' });
    expect(await screen.findByRole('link', { name: 'SI-2082/83-0001' })).toHaveAttribute('href', '/sales/d1');
    expect(screen.queryByRole('button', { name: /Apply advance/ })).not.toBeInTheDocument();
  });

  it('offers to apply an advance, and refreshes', async () => {
    let applied = false;
    const api = mockApi({
      ...as('owner'),
      'GET /receipts/r1': () => ok(applied ? withAllocation : settlement()),
      'POST /receipts/r1/auto-allocate': () => { applied = true; return ok(withAllocation); },
    });
    const user = userEvent.setup();
    renderApp({ route: '/receipts-payments/receipts/r1' });
    await user.click(await screen.findByRole('button', { name: 'Apply advance to open documents' }));
    expect(await screen.findByRole('link', { name: 'SI-2082/83-0001' })).toBeInTheDocument();
    expect(api.calledWith('POST /receipts/r1/auto-allocate')).toHaveLength(1);
  });

  it('voids with a reason, warning that the invoices become unpaid', async () => {
    const api = mockApi({ ...as('owner'), 'GET /receipts/r1': ok(withAllocation), 'POST /receipts/r1/void': ok(settlement({ status: 'voided' })) });
    const user = userEvent.setup();
    renderApp({ route: '/receipts-payments/receipts/r1' });
    await user.click(await screen.findByRole('button', { name: 'Void' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/become unpaid again/)).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText(/Reason/), 'Cheque bounced');
    await user.click(within(dialog).getByRole('button', { name: 'Void' }));
    await waitFor(() => expect(api.calledWith('POST /receipts/r1/void')).toHaveLength(1));
    expect(api.lastCall('POST /receipts/r1/void').body).toEqual({ reason: 'Cheque bounced' });
  });

  it('a viewer cannot void or edit', async () => {
    mockApi({ ...as('viewer'), 'GET /receipts/r1': ok(withAllocation) });
    renderApp({ route: '/receipts-payments/receipts/r1' });
    await screen.findByRole('link', { name: 'SI-2082/83-0001' });
    expect(screen.queryByRole('button', { name: 'Void' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit notes and reference' })).not.toBeInTheDocument();
  });
});

describe('paid status on invoices', () => {
  it('the invoice page shows paid, outstanding, the receipts applied and a way to record another', async () => {
    mockApi({
      ...as('owner'),
      'GET /sales/d1': ok(posted({
        total: '200.00', paid: '50.00', outstanding: '150.00', paymentStatus: 'partially_paid', overdue: true,
        payments: [{ id: 'a1', amount: '50.00', payment: { id: 'r1', type: 'receipt', referenceNo: 'RC-2082/83-0001', txnDate: '2025-08-10', method: 'cash' } }],
      })),
    });
    renderApp({ route: '/sales/d1' });
    expect(await screen.findByRole('link', { name: 'RC-2082/83-0001' })).toHaveAttribute('href', '/receipts-payments/receipts/r1');
    expect(screen.getByText('Part paid')).toBeInTheDocument();
    expect(screen.getByText('Overdue')).toBeInTheDocument();
    expect(screen.getByText('Outstanding').closest('div')).toHaveTextContent('रु 150.00');
    expect(screen.getByRole('link', { name: 'Record receipt' })).toHaveAttribute('href', '/receipts-payments/new-receipt?contactId=c1&documentId=d1');
  });

  it('a fully paid invoice offers no further receipt', async () => {
    mockApi({ ...as('owner'), 'GET /sales/d1': ok(posted({ paid: '200.00', outstanding: '0.00', paymentStatus: 'paid' })) });
    renderApp({ route: '/sales/d1' });
    expect(await screen.findByText('Paid', { selector: 'span' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Record receipt' })).not.toBeInTheDocument();
  });

  it('the list can filter by payment and shows what is outstanding', async () => {
    const api = mockApi({ ...as('owner'), 'GET /sales': paged([{ ...posted({ id: 'a' }), outstanding: '75.00', paymentStatus: 'partially_paid' }]) });
    const user = userEvent.setup();
    renderApp({ route: '/sales' });
    expect(await screen.findByText('रु 75.00')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Payment'), 'overdue');
    await waitFor(() => expect(api.lastCall('GET /sales').query.get('payment')).toBe('overdue'));
  });
});
