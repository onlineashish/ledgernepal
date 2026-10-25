import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { baseRoutes, fail, mockApi, ok, renderApp, sessionPayload } from './helpers.jsx';
import { settingsPayload } from './fixtures.jsx';

afterEach(() => vi.unstubAllGlobals());

const routes = (extra = {}, { role = 'owner', data } = {}) => ({
  ...baseRoutes(sessionPayload({ roleKey: role })),
  'GET /settings': settingsPayload(data),
  ...extra,
});
const card = (name) => within(screen.getByRole('heading', { name }).closest('section'));

describe('Settings', () => {
  it('shows the business details and the current settings', async () => {
    mockApi(routes({}, { data: { business: { name: 'Kathmandu Traders', panNumber: '123456789' }, settings: { isVatRegistered: true, defaultVatRate: '13.00', defaultCreditDays: 30, dateDisplay: 'AD' } } }));
    renderApp({ route: '/settings' });
    expect(await screen.findByLabelText('Business name')).toHaveValue('Kathmandu Traders');
    expect(screen.getByLabelText('PAN number')).toHaveValue('123456789');
    expect(screen.getByLabelText('My business is registered for VAT')).toBeChecked();
    expect(screen.getByLabelText('Default VAT rate (%)')).toHaveValue('13'); // no trailing ".00"
    expect(screen.getByLabelText('Default credit days')).toHaveValue('30');
    expect(screen.getByLabelText('Gregorian (AD)')).toBeChecked();
    expect(screen.getByLabelText('Sales invoices')).toHaveValue('SI');
  });

  it('does not assume a VAT rate for a new business', async () => {
    mockApi(routes());
    renderApp({ route: '/settings' });
    expect(await screen.findByLabelText('Default VAT rate (%)')).toHaveValue('');
    expect(screen.getByLabelText('My business is registered for VAT')).not.toBeChecked();
    expect(screen.getByText(/No rate is assumed/)).toBeInTheDocument();
  });

  it('saves the business details, including clearing optional ones', async () => {
    const api = mockApi(routes({ 'PATCH /businesses/current': ok({}) }, { data: { business: { panNumber: '111', address: 'Old Road' } } }));
    const user = userEvent.setup();
    renderApp({ route: '/settings' });
    const pan = await screen.findByLabelText('PAN number');
    await user.clear(pan);
    await user.clear(screen.getByLabelText('Address'));
    await user.type(screen.getByLabelText('Address'), 'Thamel');
    await user.type(screen.getByLabelText('VAT registration number'), '987');
    await user.click(screen.getByRole('button', { name: 'Save details' }));
    expect(await screen.findByText('Business details saved.')).toBeInTheDocument();
    expect(api.calledWith('PATCH /businesses/current')[0].body).toEqual({
      name: 'Test Traders', legalName: '', address: 'Thamel', phone: '', email: '', panNumber: '', vatNumber: '987',
    });
  });

  it('shows the server’s message next to the field and keeps what was typed', async () => {
    mockApi(routes({ 'PATCH /businesses/current': fail(400, 'VALIDATION_FAILED', 'Some fields are invalid', [{ field: 'email', message: 'Enter a valid email address' }]) }));
    const user = userEvent.setup();
    renderApp({ route: '/settings' });
    await user.type(await screen.findByLabelText('Email'), 'nope');
    await user.click(screen.getByRole('button', { name: 'Save details' }));
    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveValue('nope');
  });

  it('turns VAT on with a rate, sets credit days and a prefix, and sends it all in one go', async () => {
    const api = mockApi(routes({ 'PATCH /settings': ok({}) }));
    const user = userEvent.setup();
    renderApp({ route: '/settings' });
    await user.click(await screen.findByLabelText('My business is registered for VAT'));
    await user.type(screen.getByLabelText('Default VAT rate (%)'), '13');
    await user.type(screen.getByLabelText('Default credit days'), '45');
    const sales = screen.getByLabelText('Sales invoices');
    await user.clear(sales);
    await user.type(sales, 'INV');
    await user.click(screen.getByLabelText('Bikram Sambat (BS)').closest('fieldset').parentElement.querySelector('input[value="AD"]'));
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(await screen.findByText('Settings saved.')).toBeInTheDocument();
    expect(api.calledWith('PATCH /settings')[0].body).toEqual({
      dateDisplay: 'AD',
      isVatRegistered: true,
      defaultVatRate: '13',
      defaultCreditDays: 45,
      invoiceFooter: '',
      prefixes: { sale: 'INV', purchase: 'PB', receipt: 'RC', payment: 'PM', ledgerEntry: 'LE', openingBalance: 'OB' },
    });
  });

  it('clearing the VAT rate and credit days sends null (no rate, no due date)', async () => {
    const api = mockApi(routes({ 'PATCH /settings': ok({}) }, { data: { settings: { defaultVatRate: '13.00', defaultCreditDays: 30 } } }));
    const user = userEvent.setup();
    renderApp({ route: '/settings' });
    await user.clear(await screen.findByLabelText('Default VAT rate (%)'));
    await user.clear(screen.getByLabelText('Default credit days'));
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(api.calledWith('PATCH /settings')).toHaveLength(1));
    expect(api.calledWith('PATCH /settings')[0].body).toMatchObject({ defaultVatRate: null, defaultCreditDays: null });
  });

  it('refreshes the session after saving, so dates and the business name change straight away', async () => {
    const api = mockApi(routes({ 'PATCH /settings': ok({}) }));
    const user = userEvent.setup();
    renderApp({ route: '/settings' });
    await user.click(await screen.findByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(api.calledWith('GET /auth/me').length).toBeGreaterThan(1));
  });

  it('puts a prefix, rate or credit-day problem next to the right input', async () => {
    mockApi(routes({
      'PATCH /settings': fail(400, 'VALIDATION_FAILED', 'Some fields are invalid', [
        { field: 'prefixes.sale', message: 'Sales invoice prefix must be 1 to 6 letters or digits' },
        { field: 'defaultVatRate', message: 'Default VAT rate must be between 0 and 100 with at most 2 decimal places' },
        { field: 'defaultCreditDays', message: 'Credit days cannot be negative' },
      ]),
    }));
    const user = userEvent.setup();
    renderApp({ route: '/settings' });
    await user.click(await screen.findByRole('button', { name: 'Save settings' }));
    expect(await screen.findByText('Sales invoice prefix must be 1 to 6 letters or digits')).toBeInTheDocument();
    expect(screen.getByText(/must be between 0 and 100/)).toBeInTheDocument();
    expect(screen.getByText('Credit days cannot be negative')).toBeInTheDocument();
  });

  it('is read-only for someone who may view but not change: no save buttons, a clear note', async () => {
    mockApi(routes({}, { role: 'accountant' }));
    renderApp({ route: '/settings' });
    expect(await screen.findByLabelText('Business name')).toBeDisabled();
    expect(screen.getByLabelText('Default VAT rate (%)')).toBeDisabled();
    expect(screen.queryByRole('button', { name: /^Save/ })).not.toBeInTheDocument();
    expect(screen.getAllByText(/You can view this but not change it/)).toHaveLength(2);
  });

  it('an administrator can change both, with the buttons shown', async () => {
    mockApi(routes({}, { role: 'business_admin' }));
    renderApp({ route: '/settings' });
    expect(await screen.findByRole('button', { name: 'Save details' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save settings' })).toBeInTheDocument();
  });

  it('shows an error if the settings cannot be loaded', async () => {
    mockApi({ ...baseRoutes(), 'GET /settings': fail(500, 'INTERNAL_ERROR', 'Something went wrong. Please try again.') });
    renderApp({ route: '/settings' });
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');
  });
});
