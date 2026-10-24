import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { MailError } from '../../src/lib/mailer.js';
import { hashToken } from '../../src/lib/tokens.js';
import { createTestApp } from '../helpers/testApp.js';
import { TEST_PASSWORD, cleanupApiTestData, createMemberSession, loginUser, registerUser, uniqueEmail } from '../helpers/api.js';

const t = createTestApp();
const { app, pool, mailer, config } = t;
const NEW_PASSWORD = 'a brand new passphrase 42';

beforeAll(() => cleanupApiTestData(pool));
afterAll(async () => {
  await cleanupApiTestData(pool);
  await t.close();
});

const tokenIn = (mail) => /token=([A-Za-z0-9_-]+)/.exec(mail.text)[1];
const forgot = (email) => request(app).post('/api/auth/password/forgot').send({ email });
const reset = (token, password = NEW_PASSWORD) => request(app).post('/api/auth/password/reset').send({ token, password });
const auditActions = async (userId) =>
  (await pool.query('SELECT action FROM audit_logs WHERE actor_user_id = $1 ORDER BY id', [userId])).rows.map((r) => r.action);

/** Asks for a reset email the way a person would and returns the token from the message. */
async function emailedToken(email) {
  mailer.clear();
  await forgot(email);
  await t.settle();
  return tokenIn(mailer.to(email)[0]);
}

describe('forgot password', () => {
  it('emails a single-use link to a real, active account and stores only a hash of the token', async () => {
    const user = await registerUser(app);
    mailer.clear();
    const res = await forgot(user.email);
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ data: { accepted: true } });
    await t.settle();

    const mails = mailer.to(user.email);
    expect(mails).toHaveLength(1);
    expect(mails[0].subject).toMatch(/Reset your LedgerNepal password/);
    expect(mails[0].text).toContain(`${config.appOrigin}/reset-password?token=`);
    expect(mails[0].text).toMatch(/30 minutes/);

    const token = tokenIn(mails[0]);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const { rows } = await pool.query('SELECT token_hash, expires_at, used_at FROM password_reset_tokens WHERE user_id = $1', [user.user.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).toBe(hashToken(token));
    expect(rows[0].used_at).toBeNull();
    const minutes = (new Date(rows[0].expires_at) - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(28);
    expect(minutes).toBeLessThanOrEqual(30);
    expect(await auditActions(user.user.id)).toContain('auth.password_reset_requested');
  });

  it('gives the same answer for an unknown address and sends nothing', async () => {
    const real = await registerUser(app);
    mailer.clear();
    const known = await forgot(real.email);
    const unknown = await forgot(uniqueEmail('nobody'));
    await t.settle();
    expect(unknown.status).toBe(known.status);
    expect(unknown.body).toEqual(known.body);
    expect(mailer.outbox).toHaveLength(1); // only the real account got mail
  });

  it('ignores letter case in the address', async () => {
    const user = await registerUser(app);
    mailer.clear();
    await forgot(user.email.toUpperCase());
    await t.settle();
    expect(mailer.to(user.email)).toHaveLength(1);
  });

  it('says nothing and sends nothing for a suspended account', async () => {
    const user = await registerUser(app);
    await pool.query("UPDATE users SET status = 'suspended' WHERE id = $1", [user.user.id]);
    mailer.clear();
    const res = await forgot(user.email);
    await t.settle();
    expect(res.status).toBe(202);
    expect(mailer.outbox).toHaveLength(0);
  });

  it('a newer request cancels the older link', async () => {
    const user = await registerUser(app);
    const first = await emailedToken(user.email);
    const second = await emailedToken(user.email);
    expect((await reset(first)).status).toBe(400);
    expect((await reset(second)).status).toBe(200);
  });

  it('still answers 202 when the email service fails, and tells the person nothing', async () => {
    const user = await registerUser(app);
    const original = mailer.send;
    mailer.send = async () => { throw new MailError('Email service refused the message (HTTP 401)'); };
    try {
      const res = await forgot(user.email);
      await t.settle();
      expect(res.status).toBe(202);
      expect(JSON.stringify(res.body)).not.toMatch(/HTTP|refused|mail/i);
    } finally {
      mailer.send = original;
    }
  });

  it('with no mail provider configured, answers 202 and creates no token', async () => {
    const noMail = createTestApp({ configOverrides: { mail: { provider: 'none' } } });
    try {
      const user = await registerUser(noMail.app);
      const res = await request(noMail.app).post('/api/auth/password/forgot').send({ email: user.email });
      await noMail.settle();
      expect(res.status).toBe(202);
      expect((await pool.query('SELECT 1 FROM password_reset_tokens WHERE user_id = $1', [user.user.id])).rowCount).toBe(0);
    } finally {
      await noMail.close();
    }
  });

  it('limits requests per address so an inbox cannot be flooded, for known and unknown emails alike', async () => {
    const limited = createTestApp({ rateLimit: { passwordForgotMax: 2, passwordForgotWindowMs: 60_000 } });
    try {
      const send = (email) => request(limited.app).post('/api/auth/password/forgot').send({ email });
      for (const email of [uniqueEmail('a'), uniqueEmail('a')]) expect((await send(email)).status).toBe(202);
      const target = uniqueEmail('flooded');
      expect((await send(target)).status).toBe(202);
      expect((await send(target)).status).toBe(202);
      expect((await send(target)).status).toBe(429);
      expect((await send(uniqueEmail('other'))).status).toBe(202); // a different address is not affected
      await limited.settle();
    } finally {
      await limited.close();
    }
  });

  it('validates input and refuses other origins', async () => {
    expect((await forgot('not-an-email')).status).toBe(400);
    expect((await request(app).post('/api/auth/password/forgot').send({ email: 'a@b.example', extra: 1 })).status).toBe(400);
    const crossSite = await request(app).post('/api/auth/password/forgot').set('Origin', 'https://evil.example').send({ email: 'a@b.example' });
    expect(crossSite.status).toBe(403);
  });
});

describe('resetting with a link', () => {
  it('sets the new password, ends every session, clears a lockout, and burns the link', async () => {
    const user = await registerUser(app);
    const other = await loginUser(app, { email: user.email }); // a second device
    await pool.query("UPDATE users SET failed_login_count = 7, locked_until = now() + interval '1 hour' WHERE id = $1", [user.user.id]);
    const token = await emailedToken(user.email);
    mailer.clear();

    const res = await reset(token);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ reset: true });

    expect((await user.get('/api/auth/me')).status).toBe(401);
    expect((await other.get('/api/auth/me')).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({ email: user.email, password: TEST_PASSWORD })).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({ email: user.email, password: NEW_PASSWORD })).status).toBe(200);

    expect((await reset(token, 'yet another long passphrase')).status).toBe(400); // single use
    expect(await auditActions(user.user.id)).toContain('auth.password_reset');
    await t.settle();
    expect(mailer.to(user.email)[0]?.subject).toMatch(/password was changed/);
    const { rows } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [user.user.id]);
    expect(rows[0].password_hash).toMatch(/^\$argon2id\$/);
  });

  it('refuses unknown, malformed and expired links with one message', async () => {
    const user = await registerUser(app);
    const expired = await emailedToken(user.email);
    await pool.query("UPDATE password_reset_tokens SET expires_at = now() - interval '1 minute' WHERE user_id = $1", [user.user.id]);

    const answers = [await reset('x'.repeat(43)), await reset(expired)];
    for (const res of answers) {
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_RESET_TOKEN');
    }
    expect(answers[0].body.error.message).toBe(answers[1].body.error.message);
    expect((await reset('short')).status).toBe(400);
    expect((await request(app).post('/api/auth/login').send({ email: user.email, password: TEST_PASSWORD })).status).toBe(200); // unchanged
  });

  it('applies the password rules and keeps the link usable after a rejected password', async () => {
    const user = await registerUser(app);
    const token = await emailedToken(user.email);
    for (const password of ['short', 'Password123', user.email]) {
      const res = await reset(token, password);
      expect(res.status, password).toBe(400);
      expect(res.body.error.details[0].field).toBe('password');
    }
    expect((await reset(token)).status).toBe(200);
  });

  it('cannot be aimed at a different account, and does not touch other accounts’ links', async () => {
    const alice = await registerUser(app);
    const bob = await registerUser(app);
    const aliceToken = await emailedToken(alice.email);
    const bobToken = await emailedToken(bob.email);
    expect((await request(app).post('/api/auth/password/reset').send({ token: aliceToken, password: NEW_PASSWORD, email: bob.email })).status).toBe(400);
    expect((await reset(aliceToken)).status).toBe(200);
    expect((await request(app).post('/api/auth/login').send({ email: bob.email, password: TEST_PASSWORD })).status).toBe(200); // Bob unchanged
    expect((await reset(bobToken)).status).toBe(200); // and Bob's own link still works
  });

  it('limits attempts per address', async () => {
    const limited = createTestApp({ rateLimit: { passwordResetMax: 2, passwordResetWindowMs: 60_000 } });
    try {
      const attempt = () => request(limited.app).post('/api/auth/password/reset').send({ token: 'z'.repeat(43), password: NEW_PASSWORD });
      expect((await attempt()).status).toBe(400);
      expect((await attempt()).status).toBe(400);
      expect((await attempt()).status).toBe(429);
    } finally {
      await limited.close();
    }
  });
});

describe('owner-assisted reset link', () => {
  let owner;
  let admin;
  beforeAll(async () => {
    owner = await registerUser(app, { businessName: 'Assisted Co' });
    admin = await createMemberSession(app, pool, { businessId: owner.businessId, roleKey: 'business_admin', label: 'assist-admin' });
  });
  const link = (session, membershipId) => session.post(`/api/users/${membershipId}/password-reset-link`);
  const tokenOf = (resetUrl) => new URL(resetUrl).searchParams.get('token');

  it('gives the owner a one-time link; the PERSON then chooses their own password and old sessions end', async () => {
    const staff = await createMemberSession(app, pool, { businessId: owner.businessId, roleKey: 'staff', label: 'assist-staff' });
    const res = await link(owner, staff.membershipId);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ fullName: 'Test assist-staff', email: staff.email, expiresInHours: 24 });
    const token = tokenOf(res.body.data.resetUrl);
    expect(res.body.data.resetUrl.startsWith(`${config.appOrigin}/reset-password?token=`)).toBe(true);
    expect((await pool.query('SELECT token_hash FROM password_reset_tokens WHERE user_id = $1', [staff.user.id])).rows[0].token_hash).toBe(hashToken(token));
    expect(JSON.stringify(res.body)).not.toMatch(/password_hash|argon2/i);

    expect((await reset(token, 'the staff member chose this one')).status).toBe(200);
    expect((await staff.get('/api/auth/me')).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({ email: staff.email, password: 'the staff member chose this one' })).status).toBe(200);

    const { rows } = await pool.query("SELECT actor_user_id, business_id FROM audit_logs WHERE action = 'user.password_reset_link' AND metadata->>'email' = $1", [staff.email]);
    expect(rows).toEqual([{ actor_user_id: owner.user.id, business_id: owner.businessId }]);
  });

  it('a newer link replaces the older one', async () => {
    const staff = await createMemberSession(app, pool, { businessId: owner.businessId, roleKey: 'staff', label: 'assist-twice' });
    const first = tokenOf((await link(owner, staff.membershipId)).body.data.resetUrl);
    const second = tokenOf((await link(owner, staff.membershipId)).body.data.resetUrl);
    expect((await reset(first)).status).toBe(400);
    expect((await reset(second)).status).toBe(200);
  });

  it('follows the rank rules: an admin may help an accountant, but not an admin, the owner, or themselves', async () => {
    const accountant = await createMemberSession(app, pool, { businessId: owner.businessId, roleKey: 'accountant', label: 'assist-acc' });
    const otherAdmin = await createMemberSession(app, pool, { businessId: owner.businessId, roleKey: 'business_admin', label: 'assist-admin2' });
    const ownerMembership = (await pool.query('SELECT id FROM business_users WHERE user_id = $1 AND business_id = $2', [owner.user.id, owner.businessId])).rows[0].id;
    expect((await link(admin, accountant.membershipId)).status).toBe(201);
    expect((await link(admin, otherAdmin.membershipId)).status).toBe(403);
    expect((await link(admin, ownerMembership)).status).toBe(403);
    expect((await link(admin, admin.membershipId)).status).toBe(403);
    expect((await link(owner, ownerMembership)).status).toBe(403);
  });

  it('refuses when the person also belongs to another business (so a link could not unlock that one)', async () => {
    const shared = await createMemberSession(app, pool, { businessId: owner.businessId, roleKey: 'staff', label: 'assist-shared' });
    const elsewhere = await registerUser(app, { businessName: 'Elsewhere Co' });
    await pool.query(`INSERT INTO business_users (business_id, user_id, role_id) VALUES ($1, $2, (SELECT id FROM roles WHERE key = 'viewer'))`, [elsewhere.businessId, shared.user.id]);

    const res = await link(owner, shared.membershipId);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/other businesses/);
    expect((await pool.query('SELECT 1 FROM password_reset_tokens WHERE user_id = $1', [shared.user.id])).rowCount).toBe(0);
  });

  it('also counts a deactivated membership elsewhere', async () => {
    const shared = await createMemberSession(app, pool, { businessId: owner.businessId, roleKey: 'staff', label: 'assist-old' });
    const elsewhere = await registerUser(app, { businessName: 'Old Elsewhere Co' });
    await pool.query(
      `INSERT INTO business_users (business_id, user_id, role_id, status, deactivated_at) VALUES ($1, $2, (SELECT id FROM roles WHERE key = 'viewer'), 'deactivated', now())`,
      [elsewhere.businessId, shared.user.id],
    );
    expect((await link(owner, shared.membershipId)).status).toBe(409);
  });

  it('refuses a deactivated member and a platform administrator', async () => {
    const gone = await createMemberSession(app, pool, { businessId: owner.businessId, roleKey: 'staff', label: 'assist-gone' });
    await owner.post(`/api/users/${gone.membershipId}/deactivate`);
    expect((await link(owner, gone.membershipId)).status).toBe(409);

    const platformAdmin = await createMemberSession(app, pool, { businessId: owner.businessId, roleKey: 'staff', label: 'assist-padmin' });
    await pool.query('UPDATE users SET is_platform_admin = true WHERE id = $1', [platformAdmin.user.id]);
    expect((await link(owner, platformAdmin.membershipId)).status).toBe(409);
  });

  it('cannot be used on a member of another business', async () => {
    const stranger = await registerUser(app, { businessName: 'Stranger Assist Co' });
    const theirStaff = await createMemberSession(app, pool, { businessId: stranger.businessId, roleKey: 'staff', label: 'stranger-staff' });
    expect((await link(owner, theirStaff.membershipId)).status).toBe(404);
    expect((await pool.query('SELECT 1 FROM password_reset_tokens WHERE user_id = $1', [theirStaff.user.id])).rowCount).toBe(0);
  });
});

describe('changing your own password', () => {
  const change = (session, body) => session.post('/api/auth/password/change', body);

  it('needs the current password; a wrong one counts toward the account lock', async () => {
    const user = await registerUser(app);
    const res = await change(user, { currentPassword: 'not my password', newPassword: NEW_PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('INVALID_PASSWORD');
    expect((await pool.query('SELECT failed_login_count FROM users WHERE id = $1', [user.user.id])).rows[0].failed_login_count).toBe(1);
    expect((await request(app).post('/api/auth/login').send({ email: user.email, password: NEW_PASSWORD })).status).toBe(401);
  });

  it('changes it, keeps this session, ends the others, and emails a notice', async () => {
    const user = await registerUser(app);
    const otherDevice = await loginUser(app, { email: user.email });
    mailer.clear();
    const res = await change(user, { currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(200);

    expect((await user.get('/api/auth/me')).status).toBe(200); // still logged in here
    expect((await otherDevice.get('/api/auth/me')).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({ email: user.email, password: TEST_PASSWORD })).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({ email: user.email, password: NEW_PASSWORD })).status).toBe(200);
    await t.settle();
    expect(mailer.to(user.email)[0].subject).toMatch(/password was changed/);
    const audit = (await pool.query("SELECT metadata FROM audit_logs WHERE actor_user_id = $1 AND action = 'auth.password_change'", [user.user.id])).rows;
    expect(audit[0].metadata.otherSessionsEnded).toBe(1);
  });

  it('retires any outstanding reset link', async () => {
    const user = await registerUser(app);
    const token = await emailedToken(user.email);
    await change(user, { currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD });
    expect((await reset(token)).status).toBe(400);
  });

  it('applies the password rules and refuses reusing the current password', async () => {
    const user = await registerUser(app);
    for (const newPassword of ['short', 'Password123', user.email, TEST_PASSWORD]) {
      const res = await change(user, { currentPassword: TEST_PASSWORD, newPassword });
      expect(res.status, newPassword).toBe(400);
      expect(res.body.error.details[0].field).toBe('newPassword');
    }
  });

  it('requires a login and a CSRF token, and rejects extra fields', async () => {
    const user = await registerUser(app);
    const body = { currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD };
    expect((await request(app).post('/api/auth/password/change').send(body)).status).toBe(401);
    expect((await request(app).post('/api/auth/password/change').set('Cookie', `ln_session=${user.cookie}`).send(body)).status).toBe(403);
    expect((await change(user, { ...body, email: 'someone@else.example' })).status).toBe(400);
  });
});

describe('your sessions', () => {
  it('lists only your own active sessions, flags the current one, and exposes no secrets', async () => {
    const user = await registerUser(app);
    await loginUser(app, { email: user.email });
    const stranger = await registerUser(app);
    const res = await user.get('/api/auth/sessions');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data.filter((s) => s.current)).toHaveLength(1);
    expect(Object.keys(res.body.data[0]).sort()).toEqual(['createdAt', 'current', 'id', 'ip', 'lastSeenAt', 'userAgent']);
    expect(JSON.stringify(res.body)).not.toMatch(new RegExp(`${user.cookie}|${user.csrf}|token`, 'i'));
    const strangerIds = (await stranger.get('/api/auth/sessions')).body.data.map((s) => s.id);
    expect(res.body.data.some((s) => strangerIds.includes(s.id))).toBe(false);
  });

  it('does not list revoked or expired sessions', async () => {
    const user = await registerUser(app);
    const second = await loginUser(app, { email: user.email });
    await pool.query("UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND token_hash = $2", [user.user.id, hashToken(second.cookie)]);
    const third = await loginUser(app, { email: user.email });
    await pool.query("UPDATE sessions SET expires_at = now() - interval '1 second' WHERE user_id = $1 AND token_hash = $2", [user.user.id, hashToken(third.cookie)]);
    expect((await user.get('/api/auth/sessions')).body.data).toHaveLength(1);
  });

  it('ends another of your sessions, but not the one you are using', async () => {
    const user = await registerUser(app);
    const other = await loginUser(app, { email: user.email });
    const otherId = (await user.get('/api/auth/sessions')).body.data.find((s) => !s.current).id;
    const currentId = (await user.get('/api/auth/sessions')).body.data.find((s) => s.current).id;

    expect((await user.delete(`/api/auth/sessions/${currentId}`)).status).toBe(400);
    expect((await user.delete(`/api/auth/sessions/${otherId}`)).status).toBe(200);
    expect((await other.get('/api/auth/me')).status).toBe(401);
    expect((await user.get('/api/auth/me')).status).toBe(200);
    expect((await user.delete(`/api/auth/sessions/${otherId}`)).status).toBe(404); // already gone
  });

  it('cannot end somebody else’s session: it looks exactly like one that does not exist', async () => {
    const victim = await registerUser(app);
    const attacker = await registerUser(app);
    const victimSessionId = (await victim.get('/api/auth/sessions')).body.data[0].id;
    const foreign = await attacker.delete(`/api/auth/sessions/${victimSessionId}`);
    const missing = await attacker.delete('/api/auth/sessions/00000000-0000-4000-8000-000000000000');
    expect(foreign.status).toBe(404);
    expect(foreign.body.error.message).toBe(missing.body.error.message);
    expect((await victim.get('/api/auth/me')).status).toBe(200);
    expect((await attacker.delete('/api/auth/sessions/not-a-uuid')).status).toBe(400);
  });

  it('"log out other devices" keeps only the current session', async () => {
    const user = await registerUser(app);
    const a = await loginUser(app, { email: user.email });
    const b = await loginUser(app, { email: user.email });
    const res = await user.post('/api/auth/sessions/revoke-others');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ ended: 2 });
    expect((await a.get('/api/auth/me')).status).toBe(401);
    expect((await b.get('/api/auth/me')).status).toBe(401);
    expect((await user.get('/api/auth/me')).status).toBe(200);
  });

  it('needs a login, and a CSRF token for changes', async () => {
    const user = await registerUser(app);
    expect((await request(app).get('/api/auth/sessions')).status).toBe(401);
    expect((await request(app).post('/api/auth/sessions/revoke-others').set('Cookie', `ln_session=${user.cookie}`)).status).toBe(403);
  });
});
