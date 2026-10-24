import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { baseRoutes, fail, member, mockApi, ok, renderApp, sessionPayload } from './helpers.jsx';

afterEach(() => vi.unstubAllGlobals());

const loggedOut = { 'GET /auth/me': fail(401, 'UNAUTHENTICATED', 'You need to log in'), 'GET /health/ready': ok({ status: 'ok', database: 'ok' }) };

async function fillAndSubmitLogin(user, email = 'sita@example.com', password = 'a long passphrase') {
  await user.type(await screen.findByLabelText('Email'), email);
  await user.type(screen.getByLabelText('Password'), password);
  await user.click(screen.getByRole('button', { name: 'Log in' }));
}

describe('protected routes', () => {
  it('sends a logged-out visitor to the login page', async () => {
    mockApi(loggedOut);
    renderApp({ route: '/' });
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('does not fetch any business data while logged out', async () => {
    const api = mockApi(loggedOut);
    renderApp({ route: '/team' });
    await screen.findByRole('heading', { name: 'Log in' });
    expect(api.calls.map((c) => c.key)).toEqual(['GET /auth/me']);
  });

  it('says so, instead of a blank page, when the server cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    renderApp();
    expect(await screen.findByText(/could not reach the server/i)).toBeInTheDocument();
  });

  it('takes a logged-in person away from the login and register pages', async () => {
    mockApi(baseRoutes());
    renderApp({ route: '/login' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
  });
});

describe('logging in', () => {
  it('sends the credentials, then shows the dashboard', async () => {
    const api = mockApi({ ...loggedOut, 'POST /auth/login': ok(sessionPayload()), 'GET /auth/me': fail(401, 'UNAUTHENTICATED', 'x') });
    const user = userEvent.setup();
    renderApp({ route: '/login' });
    await fillAndSubmitLogin(user);
    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
    expect(api.calledWith('POST /auth/login')[0].body).toEqual({ email: 'sita@example.com', password: 'a long passphrase' });
  });

  it('returns to the page they were trying to open', async () => {
    mockApi({
      ...loggedOut,
      'POST /auth/login': ok(sessionPayload()),
      'GET /users': ok([member()]),
      'GET /users/invitations': ok([]),
    });
    const user = userEvent.setup();
    renderApp({ route: '/team' });
    await fillAndSubmitLogin(user);
    expect(await screen.findByRole('heading', { level: 1, name: 'Team' })).toBeInTheDocument();
  });

  it('sends the CSRF token with later changes', async () => {
    const api = mockApi({ ...loggedOut, 'POST /auth/login': ok(sessionPayload()), 'POST /auth/logout': ok({ loggedOut: true }) });
    const user = userEvent.setup();
    renderApp({ route: '/login' });
    await fillAndSubmitLogin(user);
    await user.click(await screen.findByRole('button', { name: 'Log out' }));
    expect(api.calledWith('POST /auth/logout')[0].headers['X-CSRF-Token']).toBe('csrf-token-1');
  });

  it('shows the server’s message for wrong credentials and stays on the page', async () => {
    mockApi({ ...loggedOut, 'POST /auth/login': fail(401, 'INVALID_CREDENTIALS', 'Incorrect email or password, or too many attempts. Please try again later.') });
    const user = userEvent.setup();
    renderApp({ route: '/login' });
    await fillAndSubmitLogin(user);
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect email or password');
    expect(screen.getByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Log in' })).toBeEnabled(); // can try again
  });

  it('shows field-level messages next to the right field', async () => {
    mockApi({ ...loggedOut, 'POST /auth/login': fail(400, 'VALIDATION_FAILED', 'Some fields are invalid', [{ field: 'email', message: 'Enter a valid email address' }]) });
    const user = userEvent.setup();
    renderApp({ route: '/login' });
    await fillAndSubmitLogin(user, 'bad');
    const email = await screen.findByLabelText('Email');
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Enter a valid email address')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument(); // not duplicated as a banner
  });

  it('shows a suspended-account message', async () => {
    mockApi({ ...loggedOut, 'POST /auth/login': fail(403, 'FORBIDDEN', 'This account has been suspended. Contact support.') });
    const user = userEvent.setup();
    renderApp({ route: '/login' });
    await fillAndSubmitLogin(user);
    expect(await screen.findByRole('alert')).toHaveTextContent('suspended');
  });
});

describe('creating an account', () => {
  const fillRegister = async (user, overrides = {}) => {
    const v = { name: 'Sita Sharma', business: 'Sita Traders', email: 'sita@example.com', password: 'a long passphrase', ...overrides };
    await user.type(await screen.findByLabelText('Your name'), v.name);
    await user.type(screen.getByLabelText('Business name'), v.business);
    await user.type(screen.getByLabelText('Email'), v.email);
    await user.type(screen.getByLabelText('Password'), v.password);
    await user.click(screen.getByRole('button', { name: 'Create account' }));
  };

  it('registers and lands on the dashboard of the new business', async () => {
    const api = mockApi({ ...loggedOut, 'POST /auth/register': ok(sessionPayload({ businessName: 'Sita Traders' }), 201) });
    const user = userEvent.setup();
    renderApp({ route: '/register' });
    await fillRegister(user);
    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
    expect(within(await screen.findByRole('navigation')).getByText('Sita Traders')).toBeInTheDocument();
    expect(api.calledWith('POST /auth/register')[0].body).toEqual({
      fullName: 'Sita Sharma', businessName: 'Sita Traders', email: 'sita@example.com', password: 'a long passphrase',
    });
  });

  it('shows password and duplicate-email problems from the server', async () => {
    mockApi({ ...loggedOut, 'POST /auth/register': fail(400, 'VALIDATION_FAILED', 'Some fields are invalid', [{ field: 'password', message: 'Password must be at least 10 characters' }]) });
    const user = userEvent.setup();
    renderApp({ route: '/register' });
    await fillRegister(user, { password: 'short' });
    expect(await screen.findByText('Password must be at least 10 characters')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toHaveAttribute('aria-invalid', 'true');
  });

  it('shows a conflict as a banner', async () => {
    mockApi({ ...loggedOut, 'POST /auth/register': fail(409, 'CONFLICT', 'An account with this email already exists') });
    const user = userEvent.setup();
    renderApp({ route: '/register' });
    await fillRegister(user);
    expect(await screen.findByRole('alert')).toHaveTextContent('already exists');
  });
});

describe('several businesses', () => {
  const other = { businessId: 'b2', businessName: 'Second Shop', roleKey: 'accountant', roleName: 'Accountant' };

  it('makes the person choose one before showing any business page', async () => {
    mockApi(baseRoutes(sessionPayload({ withActiveBusiness: false, otherBusinesses: [other] })));
    renderApp({ route: '/contacts' });
    expect(await screen.findByRole('heading', { name: 'Choose a business' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Test Traders/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Second Shop/ })).toBeInTheDocument();
  });

  it('switches business, then shows that business’s dashboard', async () => {
    const api = mockApi({
      ...baseRoutes(sessionPayload({ withActiveBusiness: false, otherBusinesses: [other] })),
      'POST /auth/active-business': ok(sessionPayload({ businessId: 'b2', businessName: 'Second Shop', roleKey: 'accountant', otherBusinesses: [{ businessId: 'b1', businessName: 'Test Traders', roleKey: 'owner', roleName: 'Business Owner' }] })),
    });
    const user = userEvent.setup();
    renderApp();
    await user.click(await screen.findByRole('button', { name: /Second Shop/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
    expect(api.calledWith('POST /auth/active-business')[0].body).toEqual({ businessId: 'b2' });
    expect(within(screen.getByRole('navigation')).getByText(/Accountant/)).toBeInTheDocument();
  });

  it('forgets everything cached from the old business when switching (no tenant data carries over)', async () => {
    mockApi({
      ...baseRoutes(sessionPayload({ otherBusinesses: [other] })),
      'POST /auth/active-business': ok(sessionPayload({ businessId: 'b2', businessName: 'Second Shop', roleKey: 'accountant' })),
    });
    const user = userEvent.setup();
    const { queryClient } = renderApp();
    queryClient.setQueryData(['team', 'members'], [member({ fullName: 'Member Of First Business' })]);
    await user.selectOptions(await screen.findByLabelText('Switch business'), 'b2');
    await waitFor(() => expect(within(screen.getByRole('navigation')).getByText(/Accountant/)).toBeInTheDocument());
    expect(queryClient.getQueryData(['team', 'members'])).toBeUndefined();
  });

  it('shows a switcher only when there is more than one business', async () => {
    mockApi(baseRoutes());
    renderApp();
    await screen.findByRole('navigation');
    expect(screen.queryByLabelText('Switch business')).not.toBeInTheDocument();
  });

  it('tells a person with no active business what happened, and lets them log out', async () => {
    mockApi(baseRoutes({ ...sessionPayload(), memberships: [], activeBusiness: null }));
    renderApp();
    expect(await screen.findByText(/not part of any active business/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Log out' })).toBeInTheDocument();
  });
});

describe('logging out and expired sessions', () => {
  it('logs out, returns to the login page, and clears cached data', async () => {
    const api = mockApi({ ...baseRoutes(), 'POST /auth/logout': ok({ loggedOut: true }) });
    const user = userEvent.setup();
    const { queryClient } = renderApp();
    queryClient.setQueryData(['team', 'members'], [member()]);
    await user.click(await screen.findByRole('button', { name: 'Log out' }));
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(api.calledWith('POST /auth/logout')).toHaveLength(1);
    expect(queryClient.getQueryData(['team', 'members'])).toBeUndefined();
  });

  it('still logs out locally if the server cannot be reached', async () => {
    mockApi({ ...baseRoutes(), 'POST /auth/logout': fail(500, 'INTERNAL_ERROR', 'Something went wrong') });
    const user = userEvent.setup();
    renderApp();
    await user.click(await screen.findByRole('button', { name: 'Log out' }));
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
  });

  it('sends the person to log in when the server says the session has ended', async () => {
    mockApi({ ...baseRoutes(), 'GET /health/ready': fail(401, 'UNAUTHENTICATED', 'You need to log in') });
    renderApp();
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
  });
});
