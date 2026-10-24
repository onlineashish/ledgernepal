import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { hashPassword } from '../../src/lib/password.js';

export const TEST_PASSWORD = 'correct horse battery staple';
export const TEST_EMAIL_DOMAIN = 'api-test.example';

export const uniqueEmail = (label = 'user') => `${label}-${randomUUID().slice(0, 8)}@${TEST_EMAIL_DOMAIN}`;

/** Pulls the session cookie value out of a Set-Cookie header. */
export function sessionCookie(res, name = 'ln_session') {
  const header = (res.headers['set-cookie'] ?? []).find((c) => c.startsWith(`${name}=`));
  return header ? header.split(';')[0].slice(name.length + 1) : null;
}

/** Registers a new user + business through the real API and returns handles for further calls. */
export async function registerUser(app, overrides = {}) {
  const body = {
    fullName: 'Test User',
    email: uniqueEmail(),
    password: TEST_PASSWORD,
    businessName: 'Test Traders',
    ...overrides,
  };
  const res = await request(app).post('/api/auth/register').send(body);
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  return sessionFromResponse(app, res, body);
}

export async function loginUser(app, { email, password = TEST_PASSWORD }) {
  const res = await request(app).post('/api/auth/login').send({ email, password });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return sessionFromResponse(app, res, { email, password });
}

function sessionFromResponse(app, res, credentials) {
  const data = res.body.data;
  const cookie = sessionCookie(res);
  return {
    app,
    email: credentials.email,
    password: credentials.password,
    cookie,
    csrf: data.csrfToken,
    user: data.user,
    businessId: data.activeBusiness?.id ?? null,
    data,
    // Authenticated request builders: cookie + CSRF token are attached for you.
    get: (path) => request(app).get(path).set('Cookie', `ln_session=${cookie}`),
    post: (path, body) => withBody(request(app).post(path), cookie, data.csrfToken, body),
    patch: (path, body) => withBody(request(app).patch(path), cookie, data.csrfToken, body),
    put: (path, body) => withBody(request(app).put(path), cookie, data.csrfToken, body),
    delete: (path) => request(app).delete(path).set('Cookie', `ln_session=${cookie}`).set('X-CSRF-Token', data.csrfToken),
  };
}

function withBody(req, cookie, csrf, body) {
  req.set('Cookie', `ln_session=${cookie}`).set('X-CSRF-Token', csrf);
  return body === undefined ? req : req.send(body);
}

let cachedHash;

/**
 * Adds a new user to an existing business with the given role (plus optional per-member
 * overrides) straight in the database, then logs them in through the API. Faster than
 * registering, and members cannot be invited through the API until step 3c.
 */
export async function createMemberSession(app, pool, { businessId, roleKey, label = roleKey, grants = [], denies = [] }) {
  cachedHash ??= await hashPassword(TEST_PASSWORD);
  const email = uniqueEmail(label);
  const user = await pool.query(
    `INSERT INTO users (email, password_hash, full_name, password_changed_at) VALUES ($1, $2, $3, now()) RETURNING id`,
    [email, cachedHash, `Test ${label}`],
  );
  const membership = await pool.query(
    `INSERT INTO business_users (business_id, user_id, role_id)
     VALUES ($1, $2, (SELECT id FROM roles WHERE key = $3)) RETURNING id`,
    [businessId, user.rows[0].id, roleKey],
  );
  for (const [effect, keys] of [['grant', grants], ['deny', denies]]) {
    for (const key of keys) {
      await pool.query(
        `INSERT INTO business_user_permission_overrides (business_id, business_user_id, permission_id, effect)
         VALUES ($1, $2, (SELECT id FROM permissions WHERE key = $3), $4)`,
        [businessId, membership.rows[0].id, key, effect],
      );
    }
  }
  const session = await loginUser(app, { email });
  return { ...session, membershipId: membership.rows[0].id };
}

/** Removes everything created by tests using the shared test e-mail domain. Audit rows stay (append-only). */
export async function cleanupApiTestData(pool) {
  await pool.query(
    `DELETE FROM businesses WHERE created_by IN (SELECT id FROM users WHERE email LIKE $1)`,
    [`%@${TEST_EMAIL_DOMAIN}`],
  );
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`%@${TEST_EMAIL_DOMAIN}`]);
}
