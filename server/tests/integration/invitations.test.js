import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../helpers/testApp.js';
import {
  TEST_PASSWORD,
  cleanupApiTestData,
  createMemberSession,
  loginUser,
  registerUser,
  sessionCookie,
  uniqueEmail,
} from '../helpers/api.js';

const { app, pool, config, close } = createTestApp();
let owner;
let admin;

const tokenOf = (inviteUrl) => new URL(inviteUrl).searchParams.get('token');
const inviteVia = async (session, roleKey = 'staff', email = uniqueEmail('invitee')) => {
  const res = await session.post('/api/users/invitations', { email, roleKey });
  return { res, email, token: res.body.data?.inviteUrl ? tokenOf(res.body.data.inviteUrl) : null };
};
const preview = (token) => request(app).post('/api/invitations/preview').send({ token });
const acceptNew = (body) => request(app).post('/api/invitations/accept-new').send(body);
const auditActions = async (businessId) =>
  (await pool.query('SELECT action FROM audit_logs WHERE business_id = $1 ORDER BY id', [businessId])).rows.map((r) => r.action);

beforeAll(async () => {
  await cleanupApiTestData(pool);
  owner = await registerUser(app, { businessName: 'Invite Co' });
  admin = await createMemberSession(app, pool, { businessId: owner.businessId, roleKey: 'business_admin', label: 'inv-admin' });
});
afterAll(async () => {
  await cleanupApiTestData(pool);
  await close();
});

describe('creating invitations', () => {
  it('returns a one-time link and stores only a hash of its token', async () => {
    const { res, token, email } = await inviteVia(owner, 'accountant');
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ email, roleKey: 'accountant', expired: false });
    expect(res.body.data.inviteUrl.startsWith(`${config.appOrigin}/accept-invite?token=`)).toBe(true);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const stored = await pool.query('SELECT token_hash FROM invitations WHERE id = $1', [res.body.data.id]);
    expect(stored.rows[0].token_hash).not.toContain(token);
    expect(stored.rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await auditActions(owner.businessId)).toContain('user.invite');
  });

  it('lists pending invitations without ever revealing a token', async () => {
    const { token } = await inviteVia(owner, 'viewer');
    const res = await owner.get('/api/users/invitations');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(JSON.stringify(res.body)).not.toContain(token);
    expect(JSON.stringify(res.body)).not.toMatch(/inviteUrl|token/i);
  });

  it('follows the rank rule: owner can invite an admin, an admin cannot', async () => {
    expect((await inviteVia(owner, 'business_admin')).res.status).toBe(201);
    for (const roleKey of ['accountant', 'staff', 'viewer']) expect((await inviteVia(admin, roleKey)).res.status, roleKey).toBe(201);
    const adminInvitingAdmin = await inviteVia(admin, 'business_admin');
    expect(adminInvitingAdmin.res.status).toBe(403);
  });

  it('nobody can invite an owner', async () => {
    const { res } = await inviteVia(owner, 'owner');
    expect(res.status).toBe(400);
  });

  it('is refused for roles without users.invite, but a granted staff member can invite below themselves only', async () => {
    for (const roleKey of ['accountant', 'staff', 'viewer']) {
      const s = await createMemberSession(app, pool, { businessId: owner.businessId, roleKey, label: `noinvite-${roleKey}` });
      expect((await inviteVia(s, 'viewer')).res.status, roleKey).toBe(403);
    }
    const granted = await createMemberSession(app, pool, { businessId: owner.businessId, roleKey: 'staff', label: 'granted-inviter', grants: ['users.invite'] });
    expect((await inviteVia(granted, 'viewer')).res.status).toBe(201);
    expect((await inviteVia(granted, 'staff')).res.status).toBe(403);
    expect((await inviteVia(granted, 'accountant')).res.status).toBe(403);
  });

  it('refuses a second pending invitation for the same email, and people who already belong', async () => {
    const first = await inviteVia(owner, 'staff');
    const again = await inviteVia(owner, 'staff', first.email.toUpperCase());
    expect(again.res.status).toBe(409);
    const member = await createMemberSession(app, pool, { businessId: owner.businessId, roleKey: 'viewer', label: 'already-in' });
    expect((await inviteVia(owner, 'staff', member.email)).res.status).toBe(409);
  });

  it('replaces an expired pending invitation instead of blocking forever', async () => {
    const first = await inviteVia(owner, 'staff');
    await pool.query("UPDATE invitations SET expires_at = now() - interval '1 minute' WHERE id = $1", [first.res.body.data.id]);
    const second = await inviteVia(owner, 'staff', first.email);
    expect(second.res.status).toBe(201);
    expect((await preview(first.token)).status).toBe(404);
    expect((await preview(second.token)).status).toBe(200);
  });

  it.each([
    ['bad email', { email: 'nope', roleKey: 'staff' }],
    ['missing role', { email: 'a@b.example' }],
    ['unknown role', { email: 'a@b.example', roleKey: 'superadmin' }],
    ['extra field', { email: 'a@b.example', roleKey: 'staff', business_id: '00000000-0000-4000-8000-000000000000' }],
  ])('rejects %s', async (_label, body) => {
    expect((await owner.post('/api/users/invitations', body)).status).toBe(400);
  });
});

describe('revoking invitations', () => {
  it('revokes, after which the link stops working', async () => {
    const { res, token } = await inviteVia(owner, 'staff');
    expect((await owner.delete(`/api/users/invitations/${res.body.data.id}`)).status).toBe(200);
    expect((await preview(token)).status).toBe(404);
    expect((await owner.delete(`/api/users/invitations/${res.body.data.id}`)).status).toBe(404); // already gone
    expect(await auditActions(owner.businessId)).toContain('user.invitation_revoke');
  });

  it('an admin cannot cancel an invitation for a role at or above their own', async () => {
    const { res, token } = await inviteVia(owner, 'business_admin');
    expect((await admin.delete(`/api/users/invitations/${res.body.data.id}`)).status).toBe(403);
    expect((await preview(token)).status).toBe(200); // still valid
  });

  it('another business cannot see or revoke it', async () => {
    const stranger = await registerUser(app, { businessName: 'Stranger Co' });
    const { res, token } = await inviteVia(owner, 'staff');
    expect((await stranger.delete(`/api/users/invitations/${res.body.data.id}`)).status).toBe(404);
    expect(JSON.stringify((await stranger.get('/api/users/invitations')).body)).not.toContain(res.body.data.email);
    expect((await preview(token)).status).toBe(200);
  });
});

describe('previewing a link (public)', () => {
  it('shows who invited you, to what, and whether the email already has an account', async () => {
    const fresh = await inviteVia(owner, 'accountant');
    const res = await preview(fresh.token);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ businessName: 'Invite Co', roleName: 'Accountant', email: fresh.email, accountExists: false });

    const existing = await registerUser(app);
    const known = await inviteVia(owner, 'viewer', existing.email);
    expect((await preview(known.token)).body.data.accountExists).toBe(true);
  });

  it('gives one identical answer for garbage, unknown, expired, revoked, used and suspended-business links', async () => {
    const expired = await inviteVia(owner, 'staff');
    await pool.query("UPDATE invitations SET expires_at = now() - interval '1 second' WHERE id = $1", [expired.res.body.data.id]);
    const revoked = await inviteVia(owner, 'staff');
    await owner.delete(`/api/users/invitations/${revoked.res.body.data.id}`);

    const suspendedBiz = await registerUser(app, { businessName: 'Suspended Inviter' });
    const inSuspended = await inviteVia(suspendedBiz, 'staff');
    await pool.query("UPDATE businesses SET status = 'suspended' WHERE id = $1", [suspendedBiz.businessId]);

    const answers = [];
    for (const token of ['x'.repeat(43), 'short', expired.token, revoked.token, inSuspended.token]) {
      const res = await preview(token);
      answers.push([res.status, res.body.error?.code, res.body.error?.message]);
    }
    const notFoundAnswer = [404, 'NOT_FOUND', 'This invitation link is not valid or has expired'];
    expect(answers[0]).toEqual(notFoundAnswer);
    expect(answers[2]).toEqual(notFoundAnswer);
    expect(answers[3]).toEqual(notFoundAnswer);
    expect(answers[4]).toEqual(notFoundAnswer);
    expect(answers[1][0]).toBe(400); // too short to be a token at all
  });

  it('needs the token in the body (never the URL), and rejects extra fields', async () => {
    expect((await request(app).post('/api/invitations/preview').send({})).status).toBe(400);
    expect((await request(app).post('/api/invitations/preview').send({ token: 'x'.repeat(43), business_id: owner.businessId })).status).toBe(400);
    expect((await request(app).get('/api/invitations/preview?token=abc')).status).toBe(404);
  });
});

describe('accepting with a new account', () => {
  it('creates the account with the invited email, joins with the invited role, and starts a session', async () => {
    const { token, email } = await inviteVia(owner, 'accountant');
    const res = await acceptNew({ token, fullName: 'New Hire', password: TEST_PASSWORD });
    expect(res.status).toBe(201);
    expect(res.body.data.user).toMatchObject({ email, fullName: 'New Hire', isPlatformAdmin: false });
    expect(res.body.data.activeBusiness).toMatchObject({ id: owner.businessId, roleKey: 'accountant' });
    expect(sessionCookie(res)).toBeTruthy();

    const { rows } = await pool.query('SELECT password_hash FROM users WHERE email = $1', [email]);
    expect(rows[0].password_hash).toMatch(/^\$argon2id\$/);
    const accepted = await pool.query('SELECT accepted_at FROM invitations WHERE email = $1', [email]);
    expect(accepted.rows[0].accepted_at).not.toBeNull();

    // the new session really works inside that business
    const cookie = sessionCookie(res);
    const me = await request(app).get('/api/contacts').set('Cookie', `ln_session=${cookie}`);
    expect(me.status).toBe(200);
    expect(await auditActions(owner.businessId)).toEqual(expect.arrayContaining(['user.invitation_accept']));
  });

  it('works once only', async () => {
    const { token } = await inviteVia(owner, 'staff');
    expect((await acceptNew({ token, fullName: 'First', password: TEST_PASSWORD })).status).toBe(201);
    expect((await acceptNew({ token, fullName: 'Second', password: TEST_PASSWORD })).status).toBe(404);
  });

  it('applies the normal password rules, including against the invited email', async () => {
    const { token, email } = await inviteVia(owner, 'staff');
    for (const password of ['short', 'Password123', email]) {
      const res = await acceptNew({ token, fullName: 'Weak', password });
      expect(res.status, password).toBe(400);
      expect(res.body.error.details[0].field).toBe('password');
    }
    expect((await pool.query('SELECT 1 FROM users WHERE email = $1', [email])).rowCount).toBe(0);
    expect((await acceptNew({ token, fullName: 'Strong', password: TEST_PASSWORD })).status).toBe(201); // link still good
  });

  it('refuses when the email already has an account, leaving the invitation usable', async () => {
    const existing = await registerUser(app);
    const { token } = await inviteVia(owner, 'viewer', existing.email);
    const res = await acceptNew({ token, fullName: 'Hijack', password: 'another long passphrase here' });
    expect(res.status).toBe(409);
    expect((await preview(token)).status).toBe(200);
    const login = await request(app).post('/api/auth/login').send({ email: existing.email, password: 'another long passphrase here' });
    expect(login.status).toBe(401); // the existing account's password was not changed
  });

  it('cannot smuggle in other fields such as a different email or role', async () => {
    const { token } = await inviteVia(owner, 'viewer');
    for (const extra of [{ email: 'me@elsewhere.example' }, { roleKey: 'owner' }, { business_id: owner.businessId }]) {
      expect((await acceptNew({ token, fullName: 'Sneaky', password: TEST_PASSWORD, ...extra })).status).toBe(400);
    }
  });
});

describe('accepting with an existing account', () => {
  it('joins the business, which becomes the active one', async () => {
    const person = await registerUser(app, { businessName: 'Their Own Co' });
    const { token } = await inviteVia(owner, 'accountant', person.email);
    const res = await person.post('/api/invitations/accept', { token });
    expect(res.status).toBe(200);
    expect(res.body.data.activeBusiness).toMatchObject({ id: owner.businessId, roleKey: 'accountant' });
    expect(res.body.data.memberships.map((m) => m.businessName).sort()).toEqual(['Invite Co', 'Their Own Co']);
    expect((await person.get('/api/contacts')).status).toBe(200);
    // and they still have their own business to switch back to
    expect((await person.post('/api/auth/active-business', { businessId: person.businessId })).status).toBe(200);
  });

  it('refuses a logged-in user whose email differs, and keeps the invitation open', async () => {
    const wrongPerson = await registerUser(app);
    const { token } = await inviteVia(owner, 'staff');
    const res = await wrongPerson.post('/api/invitations/accept', { token });
    expect(res.status).toBe(403);
    expect(res.body.error.message).not.toContain('@'); // does not leak the invited address
    expect((await preview(token)).status).toBe(200);
    expect((await wrongPerson.get('/api/contacts')).body.data).toEqual([]);
  });

  it('needs a login and a CSRF token', async () => {
    const { token } = await inviteVia(owner, 'staff');
    expect((await request(app).post('/api/invitations/accept').send({ token })).status).toBe(401);
    const person = await registerUser(app);
    const noCsrf = await request(app).post('/api/invitations/accept').set('Cookie', `ln_session=${person.cookie}`).send({ token });
    expect(noCsrf.status).toBe(403);
  });

  it('brings back a removed member with the invited role and without their old special powers', async () => {
    const old = await createMemberSession(app, pool, { businessId: owner.businessId, roleKey: 'accountant', label: 'returning', grants: ['users.view'] });
    await owner.post(`/api/users/${old.membershipId}/deactivate`);
    expect((await old.get('/api/contacts')).status).toBe(409);

    const { token } = await inviteVia(owner, 'viewer', old.email);
    const back = await old.post('/api/invitations/accept', { token });
    expect(back.status).toBe(200);
    expect(back.body.data.activeBusiness.roleKey).toBe('viewer');
    expect(back.body.data.activeBusiness.permissions).not.toContain('users.view');
    expect((await pool.query('SELECT status FROM business_users WHERE id = $1', [old.membershipId])).rows[0].status).toBe('active');
    expect((await pool.query('SELECT 1 FROM business_user_permission_overrides WHERE business_user_id = $1', [old.membershipId])).rowCount).toBe(0);
  });

  it('refuses someone who is already an active member', async () => {
    const member = await createMemberSession(app, pool, { businessId: owner.businessId, roleKey: 'viewer', label: 'dupe-member' });
    // an invitation to a current member cannot be created, so create it directly and try to use it
    const token = 'dupe-' + 'x'.repeat(40);
    const { createHash } = await import('node:crypto');
    await pool.query(
      `INSERT INTO invitations (business_id, email, role_id, token_hash, invited_by, expires_at)
       VALUES ($1, $2, (SELECT id FROM roles WHERE key = 'staff'), $3, $4, now() + interval '1 day')`,
      [owner.businessId, member.email, createHash('sha256').update(token).digest('hex'), owner.user.id],
    );
    expect((await member.post('/api/invitations/accept', { token })).status).toBe(409);
    expect((await pool.query('SELECT r.key FROM business_users bu JOIN roles r ON r.id = bu.role_id WHERE bu.id = $1', [member.membershipId])).rows[0].key).toBe('viewer');
  });
});

describe('an invitation can never be used to escape its business or role', () => {
  it('only ever grants the one role in that one business', async () => {
    const { token, email } = await inviteVia(admin, 'staff');
    const res = await acceptNew({ token, fullName: 'Scoped', password: TEST_PASSWORD });
    const { rows } = await pool.query(
      `SELECT bu.business_id, r.key, bu.is_owner FROM business_users bu JOIN roles r ON r.id = bu.role_id
        JOIN users u ON u.id = bu.user_id WHERE u.email = $1`,
      [email],
    );
    expect(rows).toEqual([{ business_id: owner.businessId, key: 'staff', is_owner: false }]);
    expect(res.body.data.memberships).toHaveLength(1);
    const session = await loginUser(app, { email, password: TEST_PASSWORD });
    expect((await session.get('/api/users')).status).toBe(403); // staff cannot list members
  });
});

describe('rate limiting of the public endpoints', () => {
  it('slows token guessing per address', async () => {
    const { createTestApp: make } = await import('../helpers/testApp.js');
    const limited = make({ rateLimit: { invitationMax: 3, invitationWindowMs: 60_000 } });
    try {
      for (let i = 0; i < 3; i += 1) {
        expect((await request(limited.app).post('/api/invitations/preview').send({ token: 'g'.repeat(43) })).status).toBe(404);
      }
      expect((await request(limited.app).post('/api/invitations/preview').send({ token: 'g'.repeat(43) })).status).toBe(429);
    } finally {
      await limited.close();
    }
  });
});
