import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../helpers/testApp.js';
import { TEST_PASSWORD, cleanupApiTestData, createMemberSession, loginUser, registerUser } from '../helpers/api.js';

const { app, pool, close } = createTestApp();
let owner;
let admin;

const fresh = (roleKey, extra = {}) => createMemberSession(app, pool, { businessId: owner.businessId, roleKey, ...extra });
const permissionsOf = async (session) => (await session.get('/api/auth/me')).body.data.activeBusiness?.permissions ?? null;
const auditActions = async (businessId) =>
  (await pool.query('SELECT action FROM audit_logs WHERE business_id = $1 ORDER BY id', [businessId])).rows.map((r) => r.action);

beforeAll(async () => {
  await cleanupApiTestData(pool);
  owner = await registerUser(app, { businessName: 'Members Co' });
  admin = await fresh('business_admin', { label: 'admin' });
});
afterAll(async () => {
  await cleanupApiTestData(pool);
  await close();
});

describe('listing members', () => {
  it('shows members with roles, status and what the viewer may manage', async () => {
    const staff = await fresh('staff', { label: 'listed-staff' });
    const res = await admin.get('/api/users');
    expect(res.status).toBe(200);
    const byEmail = Object.fromEntries(res.body.data.map((m) => [m.email, m]));
    expect(byEmail[owner.email]).toMatchObject({ roleKey: 'owner', isOwner: true, status: 'active', manageable: false });
    expect(byEmail[admin.email]).toMatchObject({ roleKey: 'business_admin', manageable: false }); // themselves
    expect(byEmail[staff.email]).toMatchObject({ roleKey: 'staff', manageable: true });
    expect(JSON.stringify(res.body)).not.toMatch(/password|argon2/i);
  });

  it('owner is listed first (highest rank)', async () => {
    const res = await owner.get('/api/users');
    expect(res.body.data[0].isOwner).toBe(true);
  });

  it('can be read only with users.view', async () => {
    for (const roleKey of ['accountant', 'staff', 'viewer']) {
      const s = await fresh(roleKey, { label: `nolist-${roleKey}` });
      expect((await s.get('/api/users')).status, roleKey).toBe(403);
    }
  });

  it('returns 404 for a membership of another business and 400 for a malformed id', async () => {
    const other = await registerUser(app, { businessName: 'Other Members Co' });
    expect((await owner.get(`/api/users/${await membershipId(other)}`)).status).toBe(404);
    expect((await owner.get('/api/users/not-a-uuid')).status).toBe(400);
  });
});

async function membershipId(session) {
  const { rows } = await pool.query('SELECT id FROM business_users WHERE user_id = $1 AND business_id = $2', [session.user.id, session.businessId]);
  return rows[0].id;
}

describe('changing a role', () => {
  it('owner changes staff to accountant, effective immediately, and it is audited', async () => {
    const member = await fresh('staff');
    const res = await owner.patch(`/api/users/${member.membershipId}`, { roleKey: 'accountant' });
    expect(res.status).toBe(200);
    expect(res.body.data.roleKey).toBe('accountant');
    expect(await permissionsOf(member)).toContain('ledger.correct');
    expect(await auditActions(owner.businessId)).toContain('user.role_change');
  });

  it('an admin can change roles below admin', async () => {
    const member = await fresh('staff');
    expect((await admin.patch(`/api/users/${member.membershipId}`, { roleKey: 'viewer' })).status).toBe(200);
    expect((await admin.patch(`/api/users/${member.membershipId}`, { roleKey: 'accountant' })).status).toBe(200);
  });

  it('an admin cannot promote anyone to admin, or touch another admin or the owner', async () => {
    const staff = await fresh('staff');
    const otherAdmin = await fresh('business_admin', { label: 'other-admin' });
    const ownerId = await membershipId(owner);
    expect((await admin.patch(`/api/users/${staff.membershipId}`, { roleKey: 'business_admin' })).status).toBe(403);
    expect((await admin.patch(`/api/users/${otherAdmin.membershipId}`, { roleKey: 'viewer' })).status).toBe(403);
    expect((await admin.patch(`/api/users/${ownerId}`, { roleKey: 'viewer' })).status).toBe(403);
    expect((await admin.post(`/api/users/${otherAdmin.membershipId}/deactivate`)).status).toBe(403);
    expect((await admin.post(`/api/users/${ownerId}/deactivate`)).status).toBe(403);
    expect(await permissionsOf(otherAdmin)).toContain('users.manage'); // untouched
  });

  it('nobody can change their own role, including the owner and an admin promoting themselves', async () => {
    const ownerId = await membershipId(owner);
    expect((await owner.patch(`/api/users/${ownerId}`, { roleKey: 'viewer' })).status).toBe(403);
    expect((await admin.patch(`/api/users/${admin.membershipId}`, { roleKey: 'business_admin' })).status).toBe(403);
    expect((await admin.patch(`/api/users/${admin.membershipId}`, { overrides: [{ permission: 'sales.void', effect: 'grant' }] })).status).toBe(403);
    expect((await admin.post(`/api/users/${admin.membershipId}/deactivate`)).status).toBe(403);
    expect((await owner.post(`/api/users/${ownerId}/deactivate`)).status).toBe(403);
  });

  it('owner cannot be made by role change: "owner" is not an assignable role', async () => {
    const staff = await fresh('staff');
    const res = await owner.patch(`/api/users/${staff.membershipId}`, { roleKey: 'owner' });
    expect(res.status).toBe(400);
    const count = await pool.query('SELECT count(*)::int AS n FROM business_users WHERE business_id = $1 AND is_owner AND status = $2', [owner.businessId, 'active']);
    expect(count.rows[0].n).toBe(1);
  });

  it('a role change wipes old overrides so a demotion cannot keep special powers', async () => {
    const member = await fresh('accountant', { grants: ['users.view'], denies: ['reports.export'] });
    expect(await permissionsOf(member)).toContain('users.view');
    await owner.patch(`/api/users/${member.membershipId}`, { roleKey: 'viewer' });
    const perms = await permissionsOf(member);
    expect(perms).not.toContain('users.view');
    expect(perms).toContain('reports.view');
    const { rowCount } = await pool.query('SELECT 1 FROM business_user_permission_overrides WHERE business_user_id = $1', [member.membershipId]);
    expect(rowCount).toBe(0);
  });

  it('a role change plus new overrides in one request keeps exactly the new overrides', async () => {
    const member = await fresh('viewer');
    const res = await owner.patch(`/api/users/${member.membershipId}`, {
      roleKey: 'staff',
      overrides: [{ permission: 'sales.void', effect: 'grant' }],
    });
    expect(res.body.data.overrides).toEqual([{ permission: 'sales.void', effect: 'grant' }]);
  });
});

describe('per-member permission overrides', () => {
  it('owner grants and denies; the member sees it on their next request', async () => {
    const member = await fresh('staff');
    expect(await permissionsOf(member)).not.toContain('sales.void');
    const res = await owner.patch(`/api/users/${member.membershipId}`, {
      overrides: [
        { permission: 'sales.void', effect: 'grant' },
        { permission: 'contacts.update', effect: 'deny' },
      ],
    });
    expect(res.status).toBe(200);
    const perms = await permissionsOf(member);
    expect(perms).toContain('sales.void');
    expect(perms).not.toContain('contacts.update');
    expect(await auditActions(owner.businessId)).toContain('user.permissions_change');
  });

  it('an empty list clears all overrides', async () => {
    const member = await fresh('staff', { grants: ['sales.void'] });
    const res = await owner.patch(`/api/users/${member.membershipId}`, { overrides: [] });
    expect(res.body.data.overrides).toEqual([]);
    expect(await permissionsOf(member)).not.toContain('sales.void');
  });

  it('an admin can grant what they hold, but not what they lack, and never users.manage', async () => {
    const member = await fresh('staff');
    const grant = (permission) => admin.patch(`/api/users/${member.membershipId}`, { overrides: [{ permission, effect: 'grant' }] });
    expect((await grant('reports.view')).status).toBe(200);
    for (const lacking of ['sales.void', 'ledger.correct', 'payments.void']) {
      const res = await grant(lacking);
      expect(res.status, lacking).toBe(403);
      expect(res.body.error.message).toMatch(/do not have it/);
    }
    const manage = await grant('users.manage');
    expect(manage.status).toBe(403);
    expect(manage.body.error.message).toMatch(/Only the owner/);
    expect(await permissionsOf(member)).not.toContain('users.manage');
  });

  it('only the owner can hand out users.manage, and it then works within the rank rules', async () => {
    const member = await fresh('accountant');
    await owner.patch(`/api/users/${member.membershipId}`, { overrides: [{ permission: 'users.manage', effect: 'grant' }] });
    const lowly = await fresh('viewer');
    const peer = await fresh('accountant', { label: 'peer' });
    expect((await member.post(`/api/users/${lowly.membershipId}/deactivate`)).status).toBe(200); // below
    expect((await member.post(`/api/users/${peer.membershipId}/deactivate`)).status).toBe(403); // equal rank
    expect((await member.post(`/api/users/${admin.membershipId}/deactivate`)).status).toBe(403); // above
  });

  it('an admin cannot lift a restriction the owner placed on a power the admin lacks', async () => {
    const accountant = await fresh('accountant', { denies: ['sales.void'] });
    const lift = await admin.patch(`/api/users/${accountant.membershipId}`, { overrides: [] });
    expect(lift.status).toBe(403);
    expect(await permissionsOf(accountant)).not.toContain('sales.void');
    // the owner can
    expect((await owner.patch(`/api/users/${accountant.membershipId}`, { overrides: [] })).status).toBe(200);
    expect(await permissionsOf(accountant)).toContain('sales.void');
  });

  it('an admin re-saving an existing grant they do not hold themselves changes nothing and is allowed', async () => {
    const member = await fresh('staff', { grants: ['sales.void'] });
    const res = await admin.patch(`/api/users/${member.membershipId}`, { overrides: [{ permission: 'sales.void', effect: 'grant' }] });
    expect(res.status).toBe(200);
  });

  it('an admin can take permissions away', async () => {
    const member = await fresh('staff');
    const res = await admin.patch(`/api/users/${member.membershipId}`, { overrides: [{ permission: 'sales.create', effect: 'deny' }] });
    expect(res.status).toBe(200);
    expect(await permissionsOf(member)).not.toContain('sales.create');
  });

  it.each([
    ['empty body', {}],
    ['unknown permission', { overrides: [{ permission: 'sales.fly', effect: 'grant' }] }],
    ['bad effect', { overrides: [{ permission: 'sales.void', effect: 'allow' }] }],
    ['the same permission twice', { overrides: [{ permission: 'sales.void', effect: 'grant' }, { permission: 'sales.void', effect: 'deny' }] }],
    ['unknown field', { roleKey: 'staff', isOwner: true }],
    ['business_id smuggled in', { roleKey: 'staff', business_id: '00000000-0000-4000-8000-000000000000' }],
  ])('rejects %s', async (_label, body) => {
    const member = await fresh('staff');
    expect((await owner.patch(`/api/users/${member.membershipId}`, body)).status).toBe(400);
  });
});

describe('deactivating and reactivating', () => {
  it('a deactivated member loses this business immediately but keeps their account and other businesses', async () => {
    const member = await fresh('staff');
    expect((await member.get('/api/contacts')).status).toBe(200);
    const res = await owner.post(`/api/users/${member.membershipId}/deactivate`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'deactivated' });
    expect((await member.get('/api/contacts')).status).toBe(409);
    expect((await member.get('/api/auth/me')).status).toBe(200); // still logged in, just no business
    expect((await loginUser(app, { email: member.email })).data.activeBusiness).toBeNull();
  });

  it('can be undone, and cannot be done twice', async () => {
    const member = await fresh('accountant');
    expect((await owner.post(`/api/users/${member.membershipId}/reactivate`)).status).toBe(409);
    expect((await owner.post(`/api/users/${member.membershipId}/deactivate`)).status).toBe(200);
    expect((await owner.post(`/api/users/${member.membershipId}/deactivate`)).status).toBe(409);
    expect((await owner.post(`/api/users/${member.membershipId}/reactivate`)).status).toBe(200);
    expect((await member.get('/api/contacts')).status).toBe(200);
    expect(await auditActions(owner.businessId)).toEqual(expect.arrayContaining(['user.deactivate', 'user.reactivate']));
  });

  it('staff and viewers cannot manage anyone', async () => {
    const target = await fresh('viewer');
    for (const roleKey of ['accountant', 'staff', 'viewer']) {
      const s = await fresh(roleKey, { label: `nomanage-${roleKey}` });
      expect((await s.post(`/api/users/${target.membershipId}/deactivate`)).status, roleKey).toBe(403);
      expect((await s.patch(`/api/users/${target.membershipId}`, { roleKey: 'staff' })).status, roleKey).toBe(403);
    }
    expect((await target.get('/api/contacts')).status).toBe(200);
  });
});

describe('another business’s members are out of reach', () => {
  let other;
  let otherMember;
  beforeAll(async () => {
    other = await registerUser(app, { businessName: 'Foreign Co' });
    otherMember = await createMemberSession(app, pool, { businessId: other.businessId, roleKey: 'staff', label: 'foreign-staff' });
  });

  it('cannot read, edit, deactivate or reactivate them, and nothing changes', async () => {
    const id = otherMember.membershipId;
    const before = (await pool.query('SELECT role_id, status FROM business_users WHERE id = $1', [id])).rows[0];
    const results = [
      await owner.get(`/api/users/${id}`),
      await owner.patch(`/api/users/${id}`, { roleKey: 'viewer' }),
      await owner.patch(`/api/users/${id}`, { overrides: [] }),
      await owner.post(`/api/users/${id}/deactivate`),
      await owner.post(`/api/users/${id}/reactivate`),
    ];
    expect(results.map((r) => r.status)).toEqual([404, 404, 404, 404, 404]);
    expect((await pool.query('SELECT role_id, status FROM business_users WHERE id = $1', [id])).rows[0]).toEqual(before);
  });

  it('the member list never includes other businesses’ people', async () => {
    const emails = (await owner.get('/api/users')).body.data.map((m) => m.email);
    expect(emails).not.toContain(other.email);
    expect(emails).not.toContain(otherMember.email);
  });
});

describe('transferring ownership', () => {
  const transfer = (session, membershipId, password = TEST_PASSWORD) =>
    session.post('/api/businesses/current/transfer-ownership', { membershipId, password });

  it('only the owner can, whatever permissions anyone holds', async () => {
    const boss = await registerUser(app, { businessName: 'Transfer Guard Co' });
    const adminOfBoss = await createMemberSession(app, pool, { businessId: boss.businessId, roleKey: 'business_admin', label: 'tg-admin', grants: [] });
    const staff = await createMemberSession(app, pool, { businessId: boss.businessId, roleKey: 'staff', label: 'tg-staff' });
    expect((await transfer(adminOfBoss, staff.membershipId)).status).toBe(403);
    expect((await transfer(staff, adminOfBoss.membershipId)).status).toBe(403);
    expect((await boss.get('/api/users')).body.data.find((m) => m.isOwner).email).toBe(boss.email);
  });

  it('needs the correct password, and a wrong one counts toward the account lock', async () => {
    const boss = await registerUser(app, { businessName: 'Transfer Password Co' });
    const heir = await createMemberSession(app, pool, { businessId: boss.businessId, roleKey: 'business_admin', label: 'heir' });
    const res = await transfer(boss, heir.membershipId, 'not my password');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('INVALID_PASSWORD');
    const { rows } = await pool.query('SELECT failed_login_count FROM users WHERE id = $1', [boss.user.id]);
    expect(rows[0].failed_login_count).toBe(1);
    expect((await boss.get('/api/users')).body.data.find((m) => m.isOwner).email).toBe(boss.email);
  });

  it('moves ownership: new owner has everything, old owner becomes an admin, exactly one owner remains', async () => {
    const boss = await registerUser(app, { businessName: 'Transfer Success Co' });
    const heir = await createMemberSession(app, pool, { businessId: boss.businessId, roleKey: 'accountant', label: 'heir2', denies: ['reports.export'] });
    const res = await transfer(boss, heir.membershipId);
    expect(res.status).toBe(200);
    expect(res.body.data.newOwner.email).toBe(heir.email);

    const owners = await pool.query("SELECT user_id FROM business_users WHERE business_id = $1 AND is_owner AND status = 'active'", [boss.businessId]);
    expect(owners.rows.map((r) => r.user_id)).toEqual([heir.user.id]);

    const heirPerms = await permissionsOf(heir);
    expect(heirPerms).toContain('users.manage');
    expect(heirPerms).toContain('reports.export'); // old deny cleared; owner has everything
    const oldMe = (await boss.get('/api/auth/me')).body.data.activeBusiness;
    expect(oldMe.roleKey).toBe('business_admin');
    expect(oldMe.permissions).not.toContain('ledger.correct');

    expect((await transfer(boss, heir.membershipId)).status).toBe(403); // no longer the owner
    expect(await auditActions(boss.businessId)).toContain('business.transfer_ownership');
  });

  it('refuses a deactivated member, yourself, someone else’s member, and malformed input', async () => {
    const boss = await registerUser(app, { businessName: 'Transfer Edge Co' });
    const gone = await createMemberSession(app, pool, { businessId: boss.businessId, roleKey: 'business_admin', label: 'gone' });
    await boss.post(`/api/users/${gone.membershipId}/deactivate`);
    const foreign = await createMemberSession(app, pool, { businessId: owner.businessId, roleKey: 'staff', label: 'foreign' });
    const bossMembership = await membershipId(boss);

    expect((await transfer(boss, gone.membershipId)).status).toBe(409);
    expect((await transfer(boss, bossMembership)).status).toBe(400);
    expect((await transfer(boss, foreign.membershipId)).status).toBe(404);
    expect((await boss.post('/api/businesses/current/transfer-ownership', { membershipId: 'x', password: TEST_PASSWORD })).status).toBe(400);
    expect((await boss.post('/api/businesses/current/transfer-ownership', { membershipId: bossMembership })).status).toBe(400);
    expect((await boss.get('/api/users')).body.data.find((m) => m.isOwner).email).toBe(boss.email);
  });
});
