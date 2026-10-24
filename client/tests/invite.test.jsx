import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { baseRoutes, fail, mockApi, ok, renderApp, sessionPayload } from './helpers.jsx';

afterEach(() => vi.unstubAllGlobals());

const TOKEN = 'T'.repeat(43);
const LINK = `/accept-invite?token=${TOKEN}`;
const loggedOut = { 'GET /auth/me': fail(401, 'UNAUTHENTICATED', 'You need to log in'), 'GET /health/ready': ok({ status: 'ok', database: 'ok' }) };
const preview = (overrides = {}) => ({
  businessName: 'Kathmandu Traders',
  roleName: 'Accountant',
  email: 'ram@example.com',
  invitedBy: 'Sita Sharma',
  accountExists: false,
  ...overrides,
});

describe('opening an invitation link', () => {
  it('explains a link with no code', async () => {
    mockApi(loggedOut);
    renderApp({ route: '/accept-invite' });
    expect(await screen.findByRole('heading', { name: 'Invitation link incomplete' })).toBeInTheDocument();
  });

  it('says a bad, expired or used link is not valid, without saying which', async () => {
    mockApi({ ...loggedOut, 'POST /invitations/preview': fail(404, 'NOT_FOUND', 'This invitation link is not valid or has expired') });
    renderApp({ route: LINK });
    expect(await screen.findByRole('heading', { name: 'This invitation is not valid' })).toBeInTheDocument();
    expect(screen.getByText(/ask the person who invited you/i)).toBeInTheDocument();
  });

  it('sends the token in a POST body, never in a URL that could be logged', async () => {
    const api = mockApi({ ...loggedOut, 'POST /invitations/preview': ok(preview()) });
    renderApp({ route: LINK });
    await screen.findByText(/invited you to join/i);
    expect(api.calledWith('POST /invitations/preview')[0].body).toEqual({ token: TOKEN });
    expect(api.calls.every((c) => !c.key.includes(TOKEN))).toBe(true);
  });
});

describe('a new person accepting', () => {
  it('sees who invited them, to what, and creates an account with the invited email', async () => {
    const api = mockApi({
      ...loggedOut,
      'POST /invitations/preview': ok(preview()),
      'POST /invitations/accept-new': ok(sessionPayload({ businessName: 'Kathmandu Traders', roleKey: 'accountant', user: { id: 'u9', email: 'ram@example.com', fullName: 'Ram Thapa', isPlatformAdmin: false } }), 201),
    });
    const user = userEvent.setup();
    renderApp({ route: LINK });

    expect(await screen.findByText('Sita Sharma invited you to join Kathmandu Traders as Accountant.')).toBeInTheDocument();
    expect(screen.getByText('ram@example.com')).toBeInTheDocument();
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument(); // the email is fixed by the invitation

    await user.type(screen.getByLabelText('Your name'), 'Ram Thapa');
    await user.type(screen.getByLabelText('Choose a password'), 'a long passphrase');
    await user.click(screen.getByRole('button', { name: 'Create account and join' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
    expect(api.calledWith('POST /invitations/accept-new')[0].body).toEqual({ token: TOKEN, fullName: 'Ram Thapa', password: 'a long passphrase' });
    expect(screen.queryByRole('button', { name: /Accept and join/ })).not.toBeInTheDocument();
  });

  it('shows a weak-password message from the server and keeps the form', async () => {
    mockApi({
      ...loggedOut,
      'POST /invitations/preview': ok(preview()),
      'POST /invitations/accept-new': fail(400, 'VALIDATION_FAILED', 'Some fields are invalid', [{ field: 'password', message: 'This password is too common. Choose something less guessable' }]),
    });
    const user = userEvent.setup();
    renderApp({ route: LINK });
    await user.type(await screen.findByLabelText('Your name'), 'Ram');
    await user.type(screen.getByLabelText('Choose a password'), 'Password123');
    await user.click(screen.getByRole('button', { name: 'Create account and join' }));
    expect(await screen.findByText(/too common/)).toBeInTheDocument();
    expect(screen.getByLabelText('Your name')).toHaveValue('Ram');
  });
});

describe('someone who already has an account', () => {
  it('is asked to log in, and comes back to the invitation afterwards', async () => {
    let loggedIn = false;
    const api = mockApi({
      'GET /auth/me': () => (loggedIn ? ok(sessionPayload({ businessName: 'Own Shop', user: { id: 'u9', email: 'ram@example.com', fullName: 'Ram Thapa', isPlatformAdmin: false } })) : fail(401, 'UNAUTHENTICATED', 'x')),
      'GET /health/ready': ok({ status: 'ok', database: 'ok' }),
      'POST /invitations/preview': ok(preview({ accountExists: true })),
      'POST /auth/login': () => {
        loggedIn = true;
        return ok(sessionPayload({ businessName: 'Own Shop', user: { id: 'u9', email: 'ram@example.com', fullName: 'Ram Thapa', isPlatformAdmin: false } }));
      },
      'POST /invitations/accept': ok(sessionPayload({ businessName: 'Kathmandu Traders', roleKey: 'accountant', businessId: 'b2', user: { id: 'u9', email: 'ram@example.com', fullName: 'Ram Thapa', isPlatformAdmin: false } })),
    });
    const user = userEvent.setup();
    renderApp({ route: LINK });

    await user.click(await screen.findByRole('link', { name: 'Log in to accept' }));
    await user.type(await screen.findByLabelText('Email'), 'ram@example.com');
    await user.type(screen.getByLabelText('Password'), 'a long passphrase');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    // back on the invitation, now with the accept button (the token survived the detour)
    await user.click(await screen.findByRole('button', { name: 'Accept and join Kathmandu Traders' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
    expect(api.calledWith('POST /invitations/accept')[0].body).toEqual({ token: TOKEN });
    expect(within(screen.getByRole('navigation')).getByText('Kathmandu Traders')).toBeInTheDocument();
  });

  it('is told when they are logged in as someone else, and not offered to accept', async () => {
    mockApi({ ...baseRoutes(sessionPayload()), 'POST /invitations/preview': ok(preview({ email: 'ram@example.com', accountExists: true })) });
    renderApp({ route: LINK });
    expect(await screen.findByText(/This invitation is for/)).toHaveTextContent('ram@example.com');
    expect(screen.getByText(/sita@example.com/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Accept and join/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Log out and switch account' })).toBeInTheDocument();
  });

  it('shows the server’s reason if accepting is refused', async () => {
    mockApi({
      ...baseRoutes(sessionPayload({ user: { id: 'u9', email: 'ram@example.com', fullName: 'Ram', isPlatformAdmin: false } })),
      'POST /invitations/preview': ok(preview()),
      'POST /invitations/accept': fail(409, 'CONFLICT', 'You already belong to this business'),
    });
    const user = userEvent.setup();
    renderApp({ route: LINK });
    await user.click(await screen.findByRole('button', { name: /Accept and join/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('already belong');
  });
});

// (imported lazily to keep the top of the file focused)
import { within } from '@testing-library/react';
