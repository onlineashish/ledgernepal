import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { baseRoutes, fail, invitation, member, mockApi, ok, renderApp, sessionPayload } from './helpers.jsx';

afterEach(() => vi.unstubAllGlobals());

const TOKEN = 'R'.repeat(43);
const loggedOut = { 'GET /auth/me': fail(401, 'UNAUTHENTICATED', 'You need to log in'), 'GET /health/ready': ok({ status: 'ok', database: 'ok' }) };

describe('forgot password', () => {
  it('is reachable from the login page', async () => {
    mockApi(loggedOut);
    const user = userEvent.setup();
    renderApp({ route: '/login' });
    await user.click(await screen.findByRole('link', { name: 'Forgot your password?' }));
    expect(await screen.findByRole('heading', { name: 'Forgot your password?' })).toBeInTheDocument();
  });

  it('sends the email address and shows the same "check your email" message', async () => {
    const api = mockApi({ ...loggedOut, 'POST /auth/password/forgot': ok({ accepted: true }, 202) });
    const user = userEvent.setup();
    renderApp({ route: '/forgot-password' });
    await user.type(await screen.findByLabelText('Email'), 'sita@example.com');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));

    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument();
    expect(screen.getByText(/If there is an account for/)).toBeInTheDocument(); // never claims the account exists
    expect(screen.getByText(/spam folder/)).toBeInTheDocument();
    expect(api.calledWith('POST /auth/password/forgot')[0].body).toEqual({ email: 'sita@example.com' });
  });

  it('points people without a usable email to their owner or administrator', async () => {
    mockApi(loggedOut);
    renderApp({ route: '/forgot-password' });
    expect(await screen.findByText(/Ask your business owner or administrator for a reset link/)).toBeInTheDocument();
  });

  it('shows a rate-limit message and lets the person try again later', async () => {
    mockApi({ ...loggedOut, 'POST /auth/password/forgot': fail(429, 'RATE_LIMITED', 'Too many attempts. Please wait a few minutes and try again.') });
    const user = userEvent.setup();
    renderApp({ route: '/forgot-password' });
    await user.type(await screen.findByLabelText('Email'), 'sita@example.com');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts');
    expect(screen.getByRole('button', { name: 'Send reset link' })).toBeEnabled();
  });

  it('shows an email format problem next to the field', async () => {
    mockApi({ ...loggedOut, 'POST /auth/password/forgot': fail(400, 'VALIDATION_FAILED', 'Some fields are invalid', [{ field: 'email', message: 'Enter a valid email address' }]) });
    const user = userEvent.setup();
    renderApp({ route: '/forgot-password' });
    await user.type(await screen.findByLabelText('Email'), 'nope');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument();
  });
});

describe('choosing a new password from a link', () => {
  it('explains a link with no code and offers a new request', async () => {
    mockApi(loggedOut);
    renderApp({ route: '/reset-password' });
    expect(await screen.findByRole('heading', { name: 'Reset link incomplete' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Request a new link' })).toHaveAttribute('href', '/forgot-password');
  });

  it('sends the token in the body with the new password, then points to log in', async () => {
    const api = mockApi({ ...loggedOut, 'POST /auth/password/reset': ok({ reset: true }) });
    const user = userEvent.setup();
    renderApp({ route: `/reset-password?token=${TOKEN}` });
    await user.type(await screen.findByLabelText('New password'), 'a brand new passphrase 42');
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    expect(await screen.findByRole('heading', { name: 'Password changed' })).toBeInTheDocument();
    expect(api.calledWith('POST /auth/password/reset')[0].body).toEqual({ token: TOKEN, password: 'a brand new passphrase 42' });
    expect(api.calls.every((c) => !c.key.includes(TOKEN))).toBe(true); // never in a URL
    expect(screen.getByRole('link', { name: 'Go to log in' })).toHaveAttribute('href', '/login');
  });

  it('shows a weak-password message and keeps the form so the link can be reused', async () => {
    mockApi({ ...loggedOut, 'POST /auth/password/reset': fail(400, 'VALIDATION_FAILED', 'Some fields are invalid', [{ field: 'password', message: 'This password is too common. Choose something less guessable' }]) });
    const user = userEvent.setup();
    renderApp({ route: `/reset-password?token=${TOKEN}` });
    await user.type(await screen.findByLabelText('New password'), 'Password123');
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText(/too common/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change password' })).toBeEnabled();
  });

  it('for an expired or used link, says so and offers a new one instead of retrying', async () => {
    mockApi({ ...loggedOut, 'POST /auth/password/reset': fail(400, 'INVALID_RESET_TOKEN', 'This reset link is not valid or has expired. Request a new one.') });
    const user = userEvent.setup();
    renderApp({ route: `/reset-password?token=${TOKEN}` });
    await user.type(await screen.findByLabelText('New password'), 'a brand new passphrase 42');
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('not valid or has expired');
    expect(screen.getByRole('button', { name: 'Change password' })).toBeDisabled();
    expect(screen.getByRole('link', { name: 'Request a new link' })).toBeInTheDocument();
  });
});

describe('account & security page', () => {
  const sessions = [
    { id: 's1', createdAt: '2026-10-25T10:00:00Z', lastSeenAt: new Date().toISOString(), ip: '127.0.0.1', current: true, userAgent: 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit Chrome/156.0 Safari/537.36' },
    { id: 's2', createdAt: '2026-10-20T10:00:00Z', lastSeenAt: new Date(Date.now() - 3 * 3_600_000).toISOString(), ip: '10.0.0.5', current: false, userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/150.0 Mobile Safari/537.36' },
  ];
  const routes = (extra = {}) => ({ ...baseRoutes(), 'GET /auth/sessions': ok(sessions), ...extra });

  it('is linked from the sidebar', async () => {
    mockApi(routes());
    renderApp();
    expect(await screen.findByRole('link', { name: 'Account & security' })).toHaveAttribute('href', '/account');
  });

  it('lists devices in plain words and marks this one', async () => {
    mockApi(routes());
    renderApp({ route: '/account' });
    expect(await screen.findByText('Chrome on Windows')).toBeInTheDocument();
    expect(screen.getByText('Chrome on Android')).toBeInTheDocument();
    expect(screen.getByText('This device')).toBeInTheDocument();
    expect(screen.getByText(/3 hours ago/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Log out Chrome/ })).toHaveLength(1); // not offered for this device
  });

  it('logs out another device', async () => {
    const api = mockApi(routes({ 'DELETE /auth/sessions/s2': ok({ revoked: true }) }));
    const user = userEvent.setup();
    renderApp({ route: '/account' });
    await user.click(await screen.findByRole('button', { name: 'Log out Chrome on Android' }));
    expect(api.calledWith('DELETE /auth/sessions/s2')).toHaveLength(1);
  });

  it('logs out all other devices', async () => {
    const api = mockApi(routes({ 'POST /auth/sessions/revoke-others': ok({ ended: 1 }) }));
    const user = userEvent.setup();
    renderApp({ route: '/account' });
    await user.click(await screen.findByRole('button', { name: 'Log out all other devices' }));
    expect(api.calledWith('POST /auth/sessions/revoke-others')).toHaveLength(1);
  });

  it('hides "log out all other devices" when there are none', async () => {
    mockApi(routes({ 'GET /auth/sessions': ok([sessions[0]]) }));
    renderApp({ route: '/account' });
    await screen.findByText('This device');
    expect(screen.queryByRole('button', { name: 'Log out all other devices' })).not.toBeInTheDocument();
  });

  it('changes the password and says other devices were logged out', async () => {
    const api = mockApi(routes({ 'POST /auth/password/change': ok({ changed: true }) }));
    const user = userEvent.setup();
    renderApp({ route: '/account' });
    await user.type(await screen.findByLabelText('Current password'), 'old passphrase here');
    await user.type(screen.getByLabelText('New password'), 'a brand new passphrase 42');
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Password changed');
    expect(api.calledWith('POST /auth/password/change')[0].body).toEqual({ currentPassword: 'old passphrase here', newPassword: 'a brand new passphrase 42' });
    expect(screen.getByLabelText('Current password')).toHaveValue(''); // fields cleared
  });

  it('shows a wrong current password on that field, and a weak new one on its field', async () => {
    mockApi(routes({ 'POST /auth/password/change': fail(403, 'INVALID_PASSWORD', 'Your current password is not correct') }));
    const user = userEvent.setup();
    renderApp({ route: '/account' });
    await user.type(await screen.findByLabelText('Current password'), 'wrong');
    await user.type(screen.getByLabelText('New password'), 'a brand new passphrase 42');
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText('Your current password is not correct')).toBeInTheDocument();
    expect(screen.getByLabelText('Current password')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows a weak new password next to the new-password field', async () => {
    mockApi(routes({ 'POST /auth/password/change': fail(400, 'VALIDATION_FAILED', 'Some fields are invalid', [{ field: 'newPassword', message: 'Password must be at least 10 characters' }]) }));
    const user = userEvent.setup();
    renderApp({ route: '/account' });
    await user.type(await screen.findByLabelText('Current password'), 'old passphrase here');
    await user.type(screen.getByLabelText('New password'), 'short');
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText('Password must be at least 10 characters')).toBeInTheDocument();
    expect(screen.getByLabelText('New password')).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('team page: password reset link', () => {
  const owner = member({ membershipId: 'm0', userId: 'u1', fullName: 'Sita Sharma', email: 'sita@example.com', roleKey: 'owner', roleName: 'Business Owner', isOwner: true, manageable: false });
  const teamRoutes = (extra = {}) => ({
    ...baseRoutes(),
    'GET /users': ok([owner, member()]),
    'GET /users/invitations': ok([invitation()]),
    ...extra,
  });
  const resetUrl = `https://ledger.example/reset-password?token=${TOKEN}`;

  it('creates a one-time link, shows it with copy and WhatsApp, and discards it when done', async () => {
    const api = mockApi(teamRoutes({ 'POST /users/m1/password-reset-link': ok({ fullName: 'Hari Prasad', email: 'hari@example.com', resetUrl, expiresInHours: 24 }, 201) }));
    const user = userEvent.setup();
    renderApp({ route: '/team' });
    await user.click(await screen.findByRole('button', { name: 'Create password reset link for Hari Prasad' }));

    const field = await screen.findByLabelText('Link');
    expect(field).toHaveValue(resetUrl);
    expect(screen.getByText(/shown only once/i)).toBeInTheDocument();
    expect(screen.getByText(/24 hours/)).toBeInTheDocument();
    expect(screen.getByText(/they then choose their own password/i)).toBeInTheDocument();
    expect(api.calledWith('POST /users/m1/password-reset-link')).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(await navigator.clipboard.readText()).toBe(resetUrl);
    expect(decodeURIComponent(screen.getByRole('link', { name: 'Share on WhatsApp' }).getAttribute('href'))).toContain(resetUrl);

    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByLabelText('Link')).not.toBeInTheDocument();
  });

  it('shows the server’s reason when the person belongs to other businesses', async () => {
    mockApi(teamRoutes({ 'POST /users/m1/password-reset-link': fail(409, 'CONFLICT', 'This person also belongs to other businesses, so only they can reset their own password. Ask them to use "Forgot password" on the login page.') }));
    const user = userEvent.setup();
    renderApp({ route: '/team' });
    await user.click(await screen.findByRole('button', { name: 'Create password reset link for Hari Prasad' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('other businesses');
    expect(screen.queryByLabelText('Link')).not.toBeInTheDocument();
  });

  it('offers no reset link for the owner, for yourself, or for a deactivated member', async () => {
    mockApi(teamRoutes({ 'GET /users': ok([owner, member({ status: 'deactivated' })]) }));
    renderApp({ route: '/team' });
    await screen.findByText('Hari Prasad');
    expect(screen.queryByRole('button', { name: /Create password reset link/ })).not.toBeInTheDocument();
  });

  it('never offers it to someone who cannot manage members', async () => {
    mockApi({
      ...teamRoutes(),
      'GET /auth/me': ok(sessionPayload({ roleKey: 'staff', permissions: ['business.view', 'users.view'] })),
      'GET /users': ok([owner, member({ manageable: false })]),
    });
    renderApp({ route: '/team' });
    await screen.findByText('Hari Prasad');
    expect(screen.queryByRole('button', { name: /Create password reset link/ })).not.toBeInTheDocument();
  });
});
