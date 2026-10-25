import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ROLE_KEYS, ROLE_PERMISSIONS } from '@ledgernepal/shared/permissions';
import { createTestApp } from '../helpers/testApp.js';
import { cleanupApiTestData, createMemberSession, registerUser, uniqueEmail } from '../helpers/api.js';

// For every role and every contact endpoint: allowed if and only if the role's default
// permissions (shared/permissions.js, the same file the database is seeded from) include it.

const { app, pool, close } = createTestApp();
let owner;
const sessions = {}; // roleKey -> session

beforeAll(async () => {
  await cleanupApiTestData(pool);
  owner = await registerUser(app, { businessName: 'Matrix Co' });
  sessions.owner = owner;
  for (const roleKey of ROLE_KEYS.filter((r) => r !== 'owner')) {
    sessions[roleKey] = await createMemberSession(app, pool, { businessId: owner.businessId, roleKey });
  }
});
afterAll(async () => {
  await cleanupApiTestData(pool);
  await close();
});

const newContact = async () =>
  (await owner.post('/api/contacts', { name: `Matrix ${Math.random().toString(36).slice(2, 8)}`, types: ['customer'] })).body.data;
const archivedContact = async () => {
  const c = await newContact();
  await owner.post(`/api/contacts/${c.id}/archive`);
  return c;
};

const newMember = () => createMemberSession(app, pool, { businessId: owner.businessId, roleKey: 'staff', label: 'target' });
const deactivatedMember = async () => {
  const member = await newMember();
  await owner.post(`/api/users/${member.membershipId}/deactivate`);
  return member;
};
const newInvitation = async () =>
  (await owner.post('/api/users/invitations', { email: uniqueEmail('pending'), roleKey: 'viewer' })).body.data;

// Ledger: every call gets its own contact/entry, created by the owner, so the role under test only makes the one call.
const newLedgerEntry = async () => {
  const contact = await newContact();
  const entry = (await owner.post('/api/ledger/entries', { contactId: contact.id, txnDate: '2025-08-01', direction: 'you_gave', amount: '100' })).body.data;
  return { id: entry.id, contactId: contact.id };
};
const contactWithOpening = async () => {
  const contact = await newContact();
  await owner.put(`/api/contacts/${contact.id}/opening-balance`, { amount: '50', side: 'they_owe_me' });
  return contact;
};

// Sales and purchases: one set of endpoints per kind, each gated by its own permissions.
const docBody = (contactId, extra = {}) => ({ contactId, txnDate: '2025-08-01', lines: [{ description: 'Matrix item', quantity: '1', unitPrice: '10' }], ...extra });
const newDoc = (path, extra) => async () => (await owner.post(path, docBody((await newContact()).id, extra))).body.data;
const documentEndpoints = [['sales', '/api/sales'], ['purchases', '/api/purchases']].flatMap(([noun, path]) => [
  { name: `GET ${path}`, permission: `${noun}.view`, okStatus: 200, call: (s) => s.get(path) },
  { name: `GET ${path}/:id`, permission: `${noun}.view`, okStatus: 200, prepare: newDoc(path), call: (s, d) => s.get(`${path}/${d.id}`) },
  { name: `POST ${path}`, permission: `${noun}.create`, okStatus: 201, prepare: newContact, call: (s, c) => s.post(path, docBody(c.id)) },
  { name: `PATCH ${path}/:id (draft)`, permission: `${noun}.update`, okStatus: 200, prepare: newDoc(path), call: (s, d) => s.patch(`${path}/${d.id}`, { notes: 'edited' }) },
  { name: `DELETE ${path}/:id (draft)`, permission: `${noun}.update`, okStatus: 200, prepare: newDoc(path), call: (s, d) => s.delete(`${path}/${d.id}`) },
  { name: `POST ${path}/:id/post`, permission: `${noun}.create`, okStatus: 200, prepare: newDoc(path), call: (s, d) => s.post(`${path}/${d.id}/post`) },
  { name: `POST ${path}/:id/void`, permission: `${noun}.void`, okStatus: 200, prepare: newDoc(path, { post: true }), call: (s, d) => s.post(`${path}/${d.id}/void`, { reason: 'matrix test void' }) },
]);

// `prepare` creates whatever the call needs, using the owner, so the role under test only makes the one call.
const ENDPOINTS = [
  { name: 'GET /contacts', permission: 'contacts.view', okStatus: 200, call: (s) => s.get('/api/contacts') },
  { name: 'GET /contacts/:id', permission: 'contacts.view', okStatus: 200, prepare: newContact, call: (s, c) => s.get(`/api/contacts/${c.id}`) },
  { name: 'POST /contacts', permission: 'contacts.create', okStatus: 201, call: (s) => s.post('/api/contacts', { name: 'Made by role', types: ['supplier'] }) },
  { name: 'PATCH /contacts/:id', permission: 'contacts.update', okStatus: 200, prepare: newContact, call: (s, c) => s.patch(`/api/contacts/${c.id}`, { notes: 'edited' }) },
  { name: 'POST /contacts/:id/archive', permission: 'contacts.archive', okStatus: 200, prepare: newContact, call: (s, c) => s.post(`/api/contacts/${c.id}/archive`) },
  { name: 'POST /contacts/:id/unarchive', permission: 'contacts.archive', okStatus: 200, prepare: archivedContact, call: (s, c) => s.post(`/api/contacts/${c.id}/unarchive`) },

  // Ledger and opening balances.
  { name: 'GET /ledger/entries', permission: 'ledger.view', okStatus: 200, call: (s) => s.get('/api/ledger/entries') },
  { name: 'GET /ledger/entries/:id', permission: 'ledger.view', okStatus: 200, prepare: newLedgerEntry, call: (s, e) => s.get(`/api/ledger/entries/${e.id}`) },
  { name: 'GET /ledger/contacts/:contactId', permission: 'ledger.view', okStatus: 200, prepare: newContact, call: (s, c) => s.get(`/api/ledger/contacts/${c.id}`) },
  { name: 'POST /ledger/entries', permission: 'ledger.create', okStatus: 201, prepare: newContact, call: (s, c) => s.post('/api/ledger/entries', { contactId: c.id, txnDate: '2025-08-01', direction: 'you_got', amount: '25' }) },
  { name: 'PATCH /ledger/entries/:id', permission: 'ledger.correct', okStatus: 200, prepare: newLedgerEntry, call: (s, e) => s.patch(`/api/ledger/entries/${e.id}`, { notes: 'checked' }) },
  { name: 'POST /ledger/entries/:id/void', permission: 'ledger.correct', okStatus: 200, prepare: newLedgerEntry, call: (s, e) => s.post(`/api/ledger/entries/${e.id}/void`, { reason: 'matrix test void' }) },
  { name: 'POST /ledger/entries/:id/correct', permission: 'ledger.correct', okStatus: 201, prepare: newLedgerEntry, call: (s, e) => s.post(`/api/ledger/entries/${e.id}/correct`, { amount: '1', reason: 'matrix test fix' }) },
  { name: 'PUT /contacts/:id/opening-balance (first one)', permission: 'ledger.create', okStatus: 200, prepare: newContact, call: (s, c) => s.put(`/api/contacts/${c.id}/opening-balance`, { amount: '10', side: 'they_owe_me' }) },
  { name: 'DELETE /contacts/:id/opening-balance', permission: 'ledger.correct', okStatus: 200, prepare: contactWithOpening, call: (s, c) => s.delete(`/api/contacts/${c.id}/opening-balance`) },

  ...documentEndpoints,

  // Settings and the business profile.
  { name: 'GET /settings', permission: 'business.view', okStatus: 200, call: (s) => s.get('/api/settings') },
  { name: 'PATCH /settings', permission: 'settings.manage', okStatus: 200, call: (s) => s.patch('/api/settings', { invoiceFooter: 'matrix footer' }) },
  { name: 'PATCH /businesses/current', permission: 'business.update', okStatus: 200, call: (s) => s.patch('/api/businesses/current', { phone: '01-5555555' }) },

  // Members and invitations. Targets are fresh Staff members / Viewer invitations, which every role that
  // holds the permission is also senior enough to manage, so the permission is the only variable.
  { name: 'GET /users', permission: 'users.view', okStatus: 200, call: (s) => s.get('/api/users') },
  { name: 'GET /users/:id', permission: 'users.view', okStatus: 200, prepare: newMember, call: (s, m) => s.get(`/api/users/${m.membershipId}`) },
  { name: 'GET /users/invitations', permission: 'users.view', okStatus: 200, call: (s) => s.get('/api/users/invitations') },
  { name: 'POST /users/invitations', permission: 'users.invite', okStatus: 201, call: (s) => s.post('/api/users/invitations', { email: uniqueEmail('inv'), roleKey: 'viewer' }) },
  { name: 'DELETE /users/invitations/:id', permission: 'users.invite', okStatus: 200, prepare: newInvitation, call: (s, i) => s.delete(`/api/users/invitations/${i.id}`) },
  { name: 'PATCH /users/:id', permission: 'users.manage', okStatus: 200, prepare: newMember, call: (s, m) => s.patch(`/api/users/${m.membershipId}`, { overrides: [] }) },
  { name: 'POST /users/:id/deactivate', permission: 'users.manage', okStatus: 200, prepare: newMember, call: (s, m) => s.post(`/api/users/${m.membershipId}/deactivate`) },
  { name: 'POST /users/:id/password-reset-link', permission: 'users.manage', okStatus: 201, prepare: newMember, call: (s, m) => s.post(`/api/users/${m.membershipId}/password-reset-link`) },
  { name: 'POST /users/:id/reactivate', permission: 'users.manage', okStatus: 200, prepare: deactivatedMember, call: (s, m) => s.post(`/api/users/${m.membershipId}/reactivate`) },
];

describe.each(ROLE_KEYS)('role: %s', (roleKey) => {
  it.each(ENDPOINTS)('$name', async ({ permission, okStatus, prepare, call }) => {
    const target = prepare ? await prepare() : undefined;
    const res = await call(sessions[roleKey], target);
    const allowed = ROLE_PERMISSIONS[roleKey].includes(permission);
    expect(res.status, `${roleKey} -> ${permission}`).toBe(allowed ? okStatus : 403);
  });
});

describe('a denied request changes nothing', () => {
  it('a viewer’s blocked write attempts leave the contact untouched', async () => {
    const c = await newContact();
    const before = (await pool.query('SELECT * FROM contacts WHERE id = $1', [c.id])).rows[0];
    const viewer = sessions.viewer;
    await viewer.patch(`/api/contacts/${c.id}`, { name: 'Defaced' });
    await viewer.post(`/api/contacts/${c.id}/archive`);
    expect((await pool.query('SELECT * FROM contacts WHERE id = $1', [c.id])).rows[0]).toEqual(before);
  });

  it('a forbidden request is refused before its body is even examined (no validation hints for outsiders)', async () => {
    const res = await sessions.viewer.post('/api/contacts', { totally: 'invalid' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(res.body.error.details).toBeUndefined();
  });
});

describe('per-member overrides', () => {
  it('a grant adds a permission the role lacks', async () => {
    const staff = await createMemberSession(app, pool, { businessId: owner.businessId, roleKey: 'staff', label: 'granted', grants: ['contacts.archive'] });
    const c = await newContact();
    expect((await staff.post(`/api/contacts/${c.id}/archive`)).status).toBe(200);
  });

  it('a deny removes a permission the role has, without touching the others', async () => {
    const accountant = await createMemberSession(app, pool, { businessId: owner.businessId, roleKey: 'accountant', label: 'denied', denies: ['contacts.create'] });
    expect((await accountant.post('/api/contacts', { name: 'Blocked', types: ['customer'] })).status).toBe(403);
    expect((await accountant.get('/api/contacts')).status).toBe(200);
  });

  it('a member cannot hold both a grant and a deny for the same permission (one override per permission)', async () => {
    const staff = await createMemberSession(app, pool, { businessId: owner.businessId, roleKey: 'staff', label: 'both', grants: ['contacts.archive'] });
    await expect(
      pool.query(
        `INSERT INTO business_user_permission_overrides (business_id, business_user_id, permission_id, effect)
         VALUES ($1, $2, (SELECT id FROM permissions WHERE key = 'contacts.archive'), 'deny')`,
        [owner.businessId, staff.membershipId],
      ),
    ).rejects.toMatchObject({ code: '23505' });
    // (If it ever were possible, effectivePermissions() lets a deny win: see unit tests.)
  });

  it('the owner cannot be locked out by an override', async () => {
    await pool.query(
      `INSERT INTO business_user_permission_overrides (business_id, business_user_id, permission_id, effect)
       SELECT bu.business_id, bu.id, p.id, 'deny' FROM business_users bu, permissions p
        WHERE bu.business_id = $1 AND bu.is_owner AND p.key IN ('contacts.create', 'users.manage')`,
      [owner.businessId],
    );
    expect((await owner.post('/api/contacts', { name: 'Owner still can', types: ['customer'] })).status).toBe(201);
    expect((await owner.get('/api/auth/me')).body.data.activeBusiness.permissions).toContain('users.manage');
  });

  it('a new grant applies on the next request without logging in again', async () => {
    const viewer = await createMemberSession(app, pool, { businessId: owner.businessId, roleKey: 'viewer', label: 'live' });
    const c = await newContact();
    expect((await viewer.patch(`/api/contacts/${c.id}`, { notes: 'x' })).status).toBe(403);
    await pool.query(
      `INSERT INTO business_user_permission_overrides (business_id, business_user_id, permission_id, effect)
       VALUES ($1, $2, (SELECT id FROM permissions WHERE key = 'contacts.update'), 'grant')`,
      [owner.businessId, viewer.membershipId],
    );
    expect((await viewer.patch(`/api/contacts/${c.id}`, { notes: 'x' })).status).toBe(200);
  });
});

describe('money rules that combine permissions', () => {
  it('staff can enter a first opening balance but not replace or remove it (that needs ledger.correct)', async () => {
    const staff = await createMemberSession(app, pool, { businessId: owner.businessId, roleKey: 'staff', label: 'opening-staff' });
    const contact = await newContact();
    const open = (amount) => staff.put(`/api/contacts/${contact.id}/opening-balance`, { amount, side: 'they_owe_me' });
    expect((await open('100')).status).toBe(200);
    const replace = await open('999');
    expect(replace.status).toBe(403);
    expect((await staff.delete(`/api/contacts/${contact.id}/opening-balance`)).status).toBe(403);
    const balance = (await owner.get(`/api/contacts/${contact.id}`)).body.data.balance;
    expect(balance.amount).toBe('100.00'); // unchanged
    // a person with ledger.correct can
    expect((await owner.put(`/api/contacts/${contact.id}/opening-balance`, { amount: '999', side: 'they_owe_me' })).status).toBe(200);
  });

  it('a new contact can carry an opening balance only if the creator may also create ledger entries', async () => {
    const noLedger = await createMemberSession(app, pool, { businessId: owner.businessId, roleKey: 'staff', label: 'no-ledger-create', denies: ['ledger.create'] });
    const name = `Opening Denied ${Math.random().toString(36).slice(2, 8)}`;
    const refused = await noLedger.post('/api/contacts', { name, types: ['customer'], openingBalance: { amount: '500', side: 'they_owe_me' } });
    expect(refused.status).toBe(403);
    expect((await pool.query('SELECT 1 FROM contacts WHERE name = $1', [name])).rowCount).toBe(0); // nothing half-created
    expect((await noLedger.post('/api/contacts', { name, types: ['customer'] })).status).toBe(201); // without it, fine
  });

  it('someone denied ledger.view sees no balances and no ledger, but still sees the contact', async () => {
    const blind = await createMemberSession(app, pool, { businessId: owner.businessId, roleKey: 'staff', label: 'no-ledger-view', denies: ['ledger.view'] });
    const contact = await contactWithOpening();
    const detail = await blind.get(`/api/contacts/${contact.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.balance).toBeNull();
    expect(detail.body.data.openingBalance).toBeNull();
    const list = await blind.get('/api/contacts?pageSize=100');
    expect(list.body.data.every((c) => c.balance === null)).toBe(true);
    expect(JSON.stringify(list.body)).not.toContain('50.00');
    expect((await blind.get(`/api/ledger/contacts/${contact.id}`)).status).toBe(403);
    expect((await blind.get('/api/ledger/entries')).status).toBe(403);
  });

  it('an accountant denied ledger.correct cannot void or correct, but can still add entries', async () => {
    const limited = await createMemberSession(app, pool, { businessId: owner.businessId, roleKey: 'accountant', label: 'no-correct', denies: ['ledger.correct'] });
    const { id, contactId } = await newLedgerEntry();
    expect((await limited.post(`/api/ledger/entries/${id}/void`, { reason: 'should not work' })).status).toBe(403);
    expect((await limited.post(`/api/ledger/entries/${id}/correct`, { amount: '1', reason: 'should not work' })).status).toBe(403);
    expect((await limited.post('/api/ledger/entries', { contactId, txnDate: '2025-08-01', direction: 'you_gave', amount: '5' })).status).toBe(201);
    expect((await owner.get(`/api/ledger/entries/${id}`)).body.data.status).toBe('posted');
  });
});

describe('/api/auth/me reports the same permissions the server enforces', () => {
  it.each(ROLE_KEYS)('%s', async (roleKey) => {
    const res = await sessions[roleKey].get('/api/auth/me');
    expect(res.body.data.activeBusiness.roleKey).toBe(roleKey);
    expect(res.body.data.activeBusiness.permissions).toEqual([...ROLE_PERMISSIONS[roleKey]].sort());
  });
});
