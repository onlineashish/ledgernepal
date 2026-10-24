import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { baseRoutes, fail, invitation, member, mockApi, ok, renderApp, sessionPayload } from './helpers.jsx';

afterEach(() => vi.unstubAllGlobals());

const owner = member({ membershipId: 'm0', userId: 'u1', fullName: 'Sita Sharma', email: 'sita@example.com', roleKey: 'owner', roleName: 'Business Owner', isOwner: true, manageable: false });
const staff = member();
const teamRoutes = (extra = {}, roleKey = 'owner') => ({
  ...baseRoutes(sessionPayload({ roleKey })),
  'GET /users': ok([owner, staff]),
  'GET /users/invitations': ok([invitation()]),
  ...extra,
});
const rowOf = async (name) => (await screen.findByText(name)).closest('tr');

describe('team page: members', () => {
  it('lists members with role and status, marking the current user', async () => {
    mockApi(teamRoutes());
    renderApp({ route: '/team' });
    const row = await rowOf('Sita Sharma');
    expect(within(row).getByText('(you)')).toBeInTheDocument();
    expect(within(row).getByText('Business Owner')).toBeInTheDocument();
    expect(within(await rowOf('Hari Prasad')).getByText('Active')).toBeInTheDocument();
  });

  it('gives no controls for the owner or for oneself (the server marked them not manageable)', async () => {
    mockApi(teamRoutes());
    renderApp({ route: '/team' });
    const row = await rowOf('Sita Sharma');
    expect(within(row).queryByRole('combobox')).not.toBeInTheDocument();
    expect(within(row).queryByRole('button')).not.toBeInTheDocument();
  });

  it('changes a role and refreshes the list', async () => {
    let roleKey = 'staff';
    const api = mockApi(teamRoutes({
      'GET /users': () => ok([owner, member({ roleKey, roleName: roleKey })]),
      'PATCH /users/m1': ({ body }) => { roleKey = body.roleKey; return ok(member({ roleKey })); },
    }));
    const user = userEvent.setup();
    renderApp({ route: '/team' });
    const select = within(await rowOf('Hari Prasad')).getByLabelText('Role for Hari Prasad');
    await user.selectOptions(select, 'accountant');
    expect(api.calledWith('PATCH /users/m1')[0].body).toEqual({ roleKey: 'accountant' });
    expect(await within(await rowOf('Hari Prasad')).findByLabelText('Role for Hari Prasad')).toHaveValue('accountant');
  });

  it('offers an administrator only the roles below administrator', async () => {
    mockApi(teamRoutes({}, 'business_admin'));
    renderApp({ route: '/team' });
    const select = within(await rowOf('Hari Prasad')).getByLabelText('Role for Hari Prasad');
    const enabled = within(select).getAllByRole('option').filter((o) => !o.disabled).map((o) => o.textContent);
    expect(enabled).toEqual(['Accountant', 'Staff', 'Viewer']);
    expect(enabled).not.toContain('Business Administrator');
    expect(enabled).not.toContain('Business Owner');
  });

  it('asks for confirmation before deactivating, and can be cancelled', async () => {
    const api = mockApi(teamRoutes({ 'POST /users/m1/deactivate': ok(member({ status: 'deactivated' })) }));
    const user = userEvent.setup();
    renderApp({ route: '/team' });
    const row = await rowOf('Hari Prasad');
    await user.click(within(row).getByRole('button', { name: 'Deactivate' }));
    expect(api.calledWith('POST /users/m1/deactivate')).toHaveLength(0); // nothing yet
    await user.click(within(row).getByRole('button', { name: 'Cancel' }));
    expect(api.calledWith('POST /users/m1/deactivate')).toHaveLength(0);

    await user.click(within(row).getByRole('button', { name: 'Deactivate' }));
    await user.click(within(row).getByRole('button', { name: 'Confirm deactivate' }));
    expect(api.calledWith('POST /users/m1/deactivate')).toHaveLength(1);
  });

  it('reactivates a deactivated member without a confirmation step', async () => {
    const api = mockApi(teamRoutes({
      'GET /users': ok([owner, member({ status: 'deactivated' })]),
      'POST /users/m1/reactivate': ok(member()),
    }));
    const user = userEvent.setup();
    renderApp({ route: '/team' });
    await user.click(within(await rowOf('Hari Prasad')).getByRole('button', { name: 'Reactivate' }));
    expect(api.calledWith('POST /users/m1/reactivate')).toHaveLength(1);
  });

  it('shows the server’s refusal instead of pretending it worked', async () => {
    mockApi(teamRoutes({ 'PATCH /users/m1': fail(403, 'FORBIDDEN', 'You can only manage members ranked below you') }));
    const user = userEvent.setup();
    renderApp({ route: '/team' });
    await user.selectOptions(within(await rowOf('Hari Prasad')).getByLabelText('Role for Hari Prasad'), 'viewer');
    expect(await screen.findByRole('alert')).toHaveTextContent('ranked below you');
  });
});

describe('team page: invitations', () => {
  it('creates an invitation and shows the one-time link with copy and WhatsApp options', async () => {
    const link = 'https://ledger.example/accept-invite?token=' + 'A'.repeat(43);
    const api = mockApi(teamRoutes({ 'POST /users/invitations': ok({ ...invitation({ email: 'ram@example.com', roleKey: 'viewer', roleName: 'Viewer' }), inviteUrl: link }, 201) }));
    const user = userEvent.setup();
    renderApp({ route: '/team' });

    await user.type(await screen.findByLabelText('Their email'), 'ram@example.com');
    await user.selectOptions(screen.getByLabelText('Role'), 'viewer');
    await user.click(screen.getByRole('button', { name: 'Create invite link' }));

    expect(api.calledWith('POST /users/invitations')[0].body).toEqual({ email: 'ram@example.com', roleKey: 'viewer' });
    const field = await screen.findByLabelText('Link');
    expect(field).toHaveValue(link);
    expect(screen.getByText(/shown only once/i)).toBeInTheDocument();
    expect(screen.getByText(/No email is sent/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(await navigator.clipboard.readText()).toBe(link);
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();

    const whatsapp = screen.getByRole('link', { name: 'Share on WhatsApp' });
    expect(whatsapp.getAttribute('href')).toMatch(/^https:\/\/wa\.me\/\?text=/);
    expect(decodeURIComponent(whatsapp.getAttribute('href'))).toContain(link);

    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByLabelText('Link')).not.toBeInTheDocument(); // gone for good
  });

  it('defaults to, and limits the choice to, roles below the inviter’s own', async () => {
    mockApi(teamRoutes({}, 'business_admin'));
    renderApp({ route: '/team' });
    const select = await screen.findByLabelText('Role');
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['Accountant', 'Staff', 'Viewer']);
    expect(select).toHaveValue('viewer'); // least privilege by default
  });

  it('shows an email problem next to the field', async () => {
    mockApi(teamRoutes({ 'POST /users/invitations': fail(400, 'VALIDATION_FAILED', 'Some fields are invalid', [{ field: 'email', message: 'Enter a valid email address' }]) }));
    const user = userEvent.setup();
    renderApp({ route: '/team' });
    await user.type(await screen.findByLabelText('Their email'), 'nope');
    await user.click(screen.getByRole('button', { name: 'Create invite link' }));
    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument();
  });

  it('shows a duplicate-invitation conflict as a message', async () => {
    mockApi(teamRoutes({ 'POST /users/invitations': fail(409, 'CONFLICT', 'This email already has a pending invitation. Revoke it first to send a new link.') }));
    const user = userEvent.setup();
    renderApp({ route: '/team' });
    await user.type(await screen.findByLabelText('Their email'), 'new@example.com');
    await user.click(screen.getByRole('button', { name: 'Create invite link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('pending invitation');
  });

  it('lists pending invitations without any link, and revokes one', async () => {
    const api = mockApi(teamRoutes({ 'DELETE /users/invitations/i1': ok({ revoked: true }) }));
    const user = userEvent.setup();
    renderApp({ route: '/team' });
    expect(await screen.findByText('new@example.com')).toBeInTheDocument();
    expect(screen.queryByLabelText('Link')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Revoke' }));
    expect(api.calledWith('DELETE /users/invitations/i1')).toHaveLength(1);
  });

  it('marks expired invitations', async () => {
    mockApi(teamRoutes({ 'GET /users/invitations': ok([invitation({ expired: true })]) }));
    renderApp({ route: '/team' });
    expect(await screen.findByText(/expired/)).toBeInTheDocument();
  });

  it('hides the invite form and revoke buttons from someone who can view but not invite', async () => {
    mockApi({
      ...teamRoutes(),
      'GET /auth/me': ok(sessionPayload({ roleKey: 'staff', permissions: ['business.view', 'users.view'] })),
    });
    renderApp({ route: '/team' });
    expect(await screen.findByText('new@example.com')).toBeInTheDocument();
    expect(screen.queryByLabelText('Their email')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument();
  });
});
