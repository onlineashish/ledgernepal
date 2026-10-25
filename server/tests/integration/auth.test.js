import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../helpers/testApp.js';
import {
  TEST_PASSWORD,
  cleanupApiTestData,
  loginUser,
  registerUser,
  sessionCookie,
  uniqueEmail,
} from '../helpers/api.js';

const { app, pool, config, close } = createTestApp({
  // Lock after 3 wrong passwords so the lockout test stays quick.
  configOverrides: { auth: { maxFailedLogins: 3, lockMs: 15 * 60_000 } },
});

beforeAll(() => cleanupApiTestData(pool));
afterAll(async () => {
  await cleanupApiTestData(pool);
  await close();
});

const auditActions = async (userId) =>
  (await pool.query('SELECT action, metadata FROM audit_logs WHERE actor_user_id = $1 ORDER BY id', [userId])).rows;

describe('POST /api/auth/register', () => {
  it('creates the user, a business with settings, an Owner membership and a logged-in session', async () => {
    const email = uniqueEmail('owner');
    const res = await request(app)
      .post('/api/auth/register')
      .send({ fullName: '  Sita Sharma ', email: email.toUpperCase(), password: TEST_PASSWORD, businessName: ' Sita Traders ' });

    expect(res.status).toBe(201);
    const { data } = res.body;
    expect(data.user).toMatchObject({ email, fullName: 'Sita Sharma', isPlatformAdmin: false });
    expect(data.activeBusiness).toMatchObject({ name: 'Sita Traders', roleKey: 'owner', dateDisplay: 'BS' });
    expect(data.activeBusiness.permissions).toContain('users.manage');
    expect(data.csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(data.memberships).toHaveLength(1);

    const db = await pool.query(
      `SELECT bu.is_owner, bu.status, bs.date_display, bs.default_vat_rate
         FROM business_users bu JOIN business_settings bs ON bs.business_id = bu.business_id
        WHERE bu.user_id = $1`,
      [data.user.id],
    );
    expect(db.rows).toEqual([{ is_owner: true, status: 'active', date_display: 'BS', default_vat_rate: null }]);
  });

  it('sets an HttpOnly, SameSite=Lax cookie scoped to /api, and never returns the password hash', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ fullName: 'Cookie Check', email: uniqueEmail(), password: TEST_PASSWORD, businessName: 'B' });
    const setCookie = res.headers['set-cookie'].find((c) => c.startsWith('ln_session='));
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toMatch(/Path=\/api/);
    expect(setCookie).not.toMatch(/Secure/i); // only in production (config.isProduction)
    expect(JSON.stringify(res.body)).not.toMatch(/argon2|password_hash|passwordHash/i);
    // the cookie holds the raw token; only its hash is in the database
    const raw = sessionCookie(res);
    const stored = await pool.query('SELECT 1 FROM sessions WHERE token_hash = $1', [raw]);
    expect(stored.rowCount).toBe(0);
  });

  it('stores an Argon2id hash, not the password', async () => {
    const user = await registerUser(app);
    const { rows } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [user.user.id]);
    expect(rows[0].password_hash).toMatch(/^\$argon2id\$/);
    expect(rows[0].password_hash).not.toContain(TEST_PASSWORD);
  });

  it('rejects a duplicate email, ignoring letter case', async () => {
    const first = await registerUser(app);
    const res = await request(app)
      .post('/api/auth/register')
      .send({ fullName: 'Dup', email: first.email.toUpperCase(), password: TEST_PASSWORD, businessName: 'B' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('does not leave a half-created account behind when it fails', async () => {
    const email = uniqueEmail();
    const orphanName = `Orphan Co ${email}`; // unique to this test, so other test files cannot interfere
    await registerUser(app, { email });
    const second = await request(app).post('/api/auth/register').send({ fullName: 'X', email, password: TEST_PASSWORD, businessName: orphanName });
    expect(second.status).toBe(409);
    // the failed registration rolled back completely: no business, no stray membership or session
    expect((await pool.query('SELECT 1 FROM businesses WHERE name = $1', [orphanName])).rowCount).toBe(0);
    const owned = await pool.query('SELECT count(*)::int AS n FROM business_users bu JOIN users u ON u.id = bu.user_id WHERE u.email = $1', [email]);
    expect(owned.rows[0].n).toBe(1); // only the first registration's membership
  });

  it.each([
    ['missing business name', { businessName: '' }, 'businessName'],
    ['blank name', { fullName: '   ' }, 'fullName'],
    ['invalid email', { email: 'not-an-email' }, 'email'],
    ['short password', { password: 'short' }, 'password'],
    ['common password', { password: 'Password123' }, 'password'],
    ['password equal to email', { password: 'same.person@example.com', email: 'same.person@example.com' }, 'password'],
  ])('rejects %s with a field-level message', async (_label, override, field) => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ fullName: 'Valid Name', email: uniqueEmail(), password: TEST_PASSWORD, businessName: 'Biz', ...override });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.details.map((d) => d.field)).toContain(field);
  });

  it.each([
    ['isPlatformAdmin', true],
    ['is_platform_admin', true],
    ['role', 'owner'],
    ['business_id', '00000000-0000-0000-0000-000000000000'],
    ['status', 'active'],
  ])('refuses to let a client smuggle in "%s" (mass assignment)', async (key, value) => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ fullName: 'Hacker', email: uniqueEmail(), password: TEST_PASSWORD, businessName: 'Biz', [key]: value });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('writes audit entries for the registration', async () => {
    const user = await registerUser(app);
    const actions = (await auditActions(user.user.id)).map((a) => a.action);
    expect(actions).toEqual(['auth.register', 'business.create']);
  });
});

describe('POST /api/auth/login', () => {
  let account;
  beforeAll(async () => {
    account = await registerUser(app);
  });

  it('logs in with correct credentials (email is case-insensitive) and sets a new session', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: account.email.toUpperCase(), password: TEST_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.data.user.id).toBe(account.user.id);
    expect(res.body.data.activeBusiness.id).toBe(account.businessId); // single business: selected automatically
    expect(sessionCookie(res)).toBeTruthy();
    expect(sessionCookie(res)).not.toBe(account.cookie); // a fresh session, not the registration one
  });

  it('gives the same answer for a wrong password and an unknown email', async () => {
    const wrong = await request(app).post('/api/auth/login').send({ email: account.email, password: 'definitely wrong password' });
    const unknown = await request(app).post('/api/auth/login').send({ email: uniqueEmail('nobody'), password: 'definitely wrong password' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(wrong.body.error.message).toBe(unknown.body.error.message);
    expect(wrong.headers['set-cookie']).toBeUndefined();
  });

  it('records failed and successful logins in the audit log (never the password)', async () => {
    await request(app).post('/api/auth/login').send({ email: account.email, password: 'wrong password here' });
    const rows = await auditActions(account.user.id);
    expect(rows.map((r) => r.action)).toContain('auth.login_failed');
    expect(JSON.stringify(rows)).not.toContain('wrong password here');
    expect(JSON.stringify(rows)).not.toContain(TEST_PASSWORD);
  });

  it('validates input and rejects extra fields', async () => {
    expect((await request(app).post('/api/auth/login').send({ email: 'bad', password: 'x' })).status).toBe(400);
    expect((await request(app).post('/api/auth/login').send({ email: account.email })).status).toBe(400);
    expect((await request(app).post('/api/auth/login').send({ email: account.email, password: TEST_PASSWORD, remember: true })).status).toBe(400);
  });

  it('refuses non-JSON bodies (cross-site form posts)', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .type('form')
      .send({ email: account.email, password: TEST_PASSWORD });
    expect(res.status).toBe(415);
  });

  it('refuses requests from another origin', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Origin', 'https://evil.example')
      .send({ email: account.email, password: TEST_PASSWORD });
    expect(res.status).toBe(403);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('accepts the app origin', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Origin', config.appOrigin)
      .send({ email: account.email, password: TEST_PASSWORD });
    expect(res.status).toBe(200);
  });
});

describe('account lockout and suspension', () => {
  it('locks after repeated failures, then refuses even the correct password until it expires', async () => {
    const user = await registerUser(app);
    for (let i = 0; i < 3; i += 1) {
      const res = await request(app).post('/api/auth/login').send({ email: user.email, password: `wrong password ${i}` });
      expect(res.status).toBe(401);
    }
    const locked = await request(app).post('/api/auth/login').send({ email: user.email, password: TEST_PASSWORD });
    expect(locked.status).toBe(401);
    expect(locked.body.error.code).toBe('INVALID_CREDENTIALS'); // does not reveal that it is locked
    expect((await auditActions(user.user.id)).map((a) => a.action)).toContain('auth.account_locked');

    // Time passes (we move the lock into the past instead of waiting).
    await pool.query("UPDATE users SET locked_until = now() - interval '1 minute' WHERE id = $1", [user.user.id]);
    const ok = await request(app).post('/api/auth/login').send({ email: user.email, password: TEST_PASSWORD });
    expect(ok.status).toBe(200);
    const { rows } = await pool.query('SELECT failed_login_count, locked_until FROM users WHERE id = $1', [user.user.id]);
    expect(rows[0]).toEqual({ failed_login_count: 0, locked_until: null });
  });

  it('a successful login resets the failure counter', async () => {
    const user = await registerUser(app);
    await request(app).post('/api/auth/login').send({ email: user.email, password: 'wrong password 1' });
    await request(app).post('/api/auth/login').send({ email: user.email, password: 'wrong password 2' });
    expect((await request(app).post('/api/auth/login').send({ email: user.email, password: TEST_PASSWORD })).status).toBe(200);
    const { rows } = await pool.query('SELECT failed_login_count FROM users WHERE id = $1', [user.user.id]);
    expect(rows[0].failed_login_count).toBe(0);
  });

  it('refuses a suspended user at login (only after the right password)', async () => {
    const user = await registerUser(app);
    await pool.query("UPDATE users SET status = 'suspended' WHERE id = $1", [user.user.id]);
    const right = await request(app).post('/api/auth/login').send({ email: user.email, password: TEST_PASSWORD });
    expect(right.status).toBe(403);
    const wrong = await request(app).post('/api/auth/login').send({ email: user.email, password: 'wrong password here' });
    expect(wrong.status).toBe(401);
  });

  it('cuts off an already logged-in user the moment they are suspended', async () => {
    const user = await registerUser(app);
    expect((await user.get('/api/auth/me')).status).toBe(200);
    await pool.query("UPDATE users SET status = 'suspended' WHERE id = $1", [user.user.id]);
    expect((await user.get('/api/auth/me')).status).toBe(401);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM sessions WHERE user_id = $1 AND revoked_at IS NULL', [user.user.id]);
    expect(rows[0].n).toBe(0); // all their sessions were revoked
  });
});

describe('GET /api/auth/me and session rules', () => {
  it('returns 401 with no cookie, a garbage cookie, or an oversized cookie', async () => {
    expect((await request(app).get('/api/auth/me')).status).toBe(401);
    expect((await request(app).get('/api/auth/me').set('Cookie', 'ln_session=garbage')).status).toBe(401);
    expect((await request(app).get('/api/auth/me').set('Cookie', `ln_session=${'a'.repeat(500)}`)).status).toBe(401);
  });

  it('describes the current user, business, role and permissions', async () => {
    const user = await registerUser(app);
    const res = await user.get('/api/auth/me');
    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe(user.email);
    expect(res.body.data.csrfToken).toBe(user.csrf);
    expect(res.body.data.activeBusiness.roleKey).toBe('owner');
    expect(res.body.data.needsBusinessSelection).toBe(false);
  });

  it('rejects an expired session', async () => {
    const user = await registerUser(app);
    await pool.query("UPDATE sessions SET expires_at = now() - interval '1 second' WHERE user_id = $1", [user.user.id]);
    expect((await user.get('/api/auth/me')).status).toBe(401);
  });

  it('rejects a session that has been idle too long', async () => {
    const user = await registerUser(app);
    await pool.query("UPDATE sessions SET last_seen_at = now() - interval '8 days' WHERE user_id = $1", [user.user.id]);
    expect((await user.get('/api/auth/me')).status).toBe(401);
  });

  it('rejects a revoked session', async () => {
    const user = await registerUser(app);
    await pool.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1', [user.user.id]);
    expect((await user.get('/api/auth/me')).status).toBe(401);
  });
});

describe('CSRF protection and logout', () => {
  it('rejects state-changing requests without a valid CSRF token', async () => {
    const user = await registerUser(app);
    const noToken = await request(app).post('/api/auth/logout').set('Cookie', `ln_session=${user.cookie}`);
    const wrongToken = await request(app).post('/api/auth/logout').set('Cookie', `ln_session=${user.cookie}`).set('X-CSRF-Token', 'x'.repeat(43));
    expect(noToken.status).toBe(403);
    expect(wrongToken.status).toBe(403);
    expect((await user.get('/api/auth/me')).status).toBe(200); // still logged in
  });

  it("one session's CSRF token does not work for another session", async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    const res = await request(app).post('/api/auth/logout').set('Cookie', `ln_session=${a.cookie}`).set('X-CSRF-Token', b.csrf);
    expect(res.status).toBe(403);
  });

  it('logout revokes the session server-side and clears the cookie', async () => {
    const user = await registerUser(app);
    const res = await user.post('/api/auth/logout');
    expect(res.status).toBe(200);
    expect(res.headers['set-cookie'].find((c) => c.startsWith('ln_session='))).toMatch(/Expires=Thu, 01 Jan 1970/);
    // Replaying the old cookie no longer works: the session is dead on the server, not just in the browser.
    expect((await user.get('/api/auth/me')).status).toBe(401);
    expect((await auditActions(user.user.id)).map((a) => a.action)).toContain('auth.logout');
  });

  it('logging out one session leaves the same user’s other session working', async () => {
    const first = await registerUser(app);
    const second = await loginUser(app, { email: first.email });
    await first.post('/api/auth/logout');
    expect((await second.get('/api/auth/me')).status).toBe(200);
  });
});

describe('active business', () => {
  it('requires the user to choose when they belong to several businesses', async () => {
    const owner = await registerUser(app, { businessName: 'First Co' });
    const second = await registerUser(app, { businessName: 'Second Co' });
    // Make `owner` a member of the second business as well (invitations arrive in step 3c).
    await pool.query(
      `INSERT INTO business_users (business_id, user_id, role_id) VALUES ($1, $2, (SELECT id FROM roles WHERE key = 'accountant'))`,
      [second.businessId, owner.user.id],
    );

    const login = await loginUser(app, { email: owner.email });
    expect(login.data.activeBusiness).toBeNull();
    expect(login.data.needsBusinessSelection).toBe(true);
    expect(login.data.memberships.map((m) => m.businessName).sort()).toEqual(['First Co', 'Second Co']);

    const switched = await login.post('/api/auth/active-business', { businessId: second.businessId });
    expect(switched.status).toBe(200);
    expect(switched.body.data.activeBusiness).toMatchObject({ id: second.businessId, roleKey: 'accountant' });
    expect(switched.body.data.activeBusiness.permissions).not.toContain('users.manage');

    // The choice sticks for later requests on the same session.
    expect((await login.get('/api/auth/me')).body.data.activeBusiness.id).toBe(second.businessId);
  });

  it("refuses to switch to someone else's business, and gives the same answer as a nonexistent one", async () => {
    const mine = await registerUser(app);
    const theirs = await registerUser(app);
    const foreign = await mine.post('/api/auth/active-business', { businessId: theirs.businessId });
    const missing = await mine.post('/api/auth/active-business', { businessId: '00000000-0000-4000-8000-000000000000' });
    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(foreign.body.error.message).toBe(missing.body.error.message);
    expect((await mine.get('/api/auth/me')).body.data.activeBusiness.id).toBe(mine.businessId); // unchanged
  });

  it('rejects a malformed business id and extra fields', async () => {
    const user = await registerUser(app);
    expect((await user.post('/api/auth/active-business', { businessId: 'abc' })).status).toBe(400);
    expect((await user.post('/api/auth/active-business', { businessId: user.businessId, role: 'owner' })).status).toBe(400);
  });

  it('drops the active business immediately when the membership is deactivated', async () => {
    const owner = await registerUser(app);
    const member = await registerUser(app);
    await pool.query(
      `INSERT INTO business_users (business_id, user_id, role_id) VALUES ($1, $2, (SELECT id FROM roles WHERE key = 'staff'))`,
      [owner.businessId, member.user.id],
    );
    const session = await loginUser(app, { email: member.email });
    await session.post('/api/auth/active-business', { businessId: owner.businessId });
    expect((await session.get('/api/auth/me')).body.data.activeBusiness.id).toBe(owner.businessId);

    await pool.query(
      "UPDATE business_users SET status = 'deactivated', deactivated_at = now() WHERE business_id = $1 AND user_id = $2",
      [owner.businessId, member.user.id],
    );
    const after = await session.get('/api/auth/me');
    expect(after.body.data.activeBusiness?.id).not.toBe(owner.businessId);
    expect(after.body.data.memberships.map((m) => m.businessId)).not.toContain(owner.businessId);
  });

  it('a suspended business disappears from the user’s choices and cannot be switched to', async () => {
    const owner = await registerUser(app);
    await pool.query("UPDATE businesses SET status = 'suspended' WHERE id = $1", [owner.businessId]);
    const me = await owner.get('/api/auth/me');
    expect(me.body.data.activeBusiness).toBeNull();
    expect(me.body.data.memberships).toEqual([]);
    expect((await owner.post('/api/auth/active-business', { businessId: owner.businessId })).status).toBe(404);
  });
});

describe('rate limiting', () => {
  it('blocks repeated failed logins for one account and address, but not successful ones', async () => {
    const limited = createTestApp({ rateLimit: { loginMax: 3, loginWindowMs: 60_000 } });
    try {
      const user = await registerUser(limited.app);
      for (let i = 0; i < 3; i += 1) {
        expect((await request(limited.app).post('/api/auth/login').send({ email: user.email, password: `wrong password ${i}` })).status).toBe(401);
      }
      const blocked = await request(limited.app).post('/api/auth/login').send({ email: user.email, password: TEST_PASSWORD });
      expect(blocked.status).toBe(429);
      expect(blocked.body.error.code).toBe('RATE_LIMITED');
      expect(blocked.headers['retry-after'] ?? blocked.headers.ratelimit).toBeDefined();

      // A different account from the same address is not affected by this account's counter.
      const other = await registerUser(limited.app);
      expect((await request(limited.app).post('/api/auth/login').send({ email: other.email, password: TEST_PASSWORD })).status).toBe(200);
    } finally {
      await limited.close();
    }
  });

  it('limits registrations per address', async () => {
    const limited = createTestApp({ rateLimit: { registerMax: 2, registerWindowMs: 60_000 } });
    try {
      await registerUser(limited.app);
      await registerUser(limited.app);
      const res = await request(limited.app)
        .post('/api/auth/register')
        .send({ fullName: 'Third', email: uniqueEmail(), password: TEST_PASSWORD, businessName: 'B' });
      expect(res.status).toBe(429);
    } finally {
      await limited.close();
    }
  });
});
