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

// `prepare` creates whatever the call needs, using the owner, so the role under test only makes the one call.
const ENDPOINTS = [
  { name: 'GET /contacts', permission: 'contacts.view', okStatus: 200, call: (s) => s.get('/api/contacts') },
  { name: 'GET /contacts/:id', permission: 'contacts.view', okStatus: 200, prepare: newContact, call: (s, c) => s.get(`/api/contacts/${c.id}`) },
  { name: 'POST /contacts', permission: 'contacts.create', okStatus: 201, call: (s) => s.post('/api/contacts', { name: 'Made by role', types: ['supplier'] }) },
  { name: 'PATCH /contacts/:id', permission: 'contacts.update', okStatus: 200, prepare: newContact, call: (s, c) => s.patch(`/api/contacts/${c.id}`, { notes: 'edited' }) },
  { name: 'POST /contacts/:id/archive', permission: 'contacts.archive', okStatus: 200, prepare: newContact, call: (s, c) => s.post(`/api/contacts/${c.id}/archive`) },
  { name: 'POST /contacts/:id/unarchive', permission: 'contacts.archive', okStatus: 200, prepare: archivedContact, call: (s, c) => s.post(`/api/contacts/${c.id}/unarchive`) },

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

describe('/api/auth/me reports the same permissions the server enforces', () => {
  it.each(ROLE_KEYS)('%s', async (roleKey) => {
    const res = await sessions[roleKey].get('/api/auth/me');
    expect(res.body.data.activeBusiness.roleKey).toBe(roleKey);
    expect(res.body.data.activeBusiness.permissions).toEqual([...ROLE_PERMISSIONS[roleKey]].sort());
  });
});
