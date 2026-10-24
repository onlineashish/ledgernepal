import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../helpers/testApp.js';
import { cleanupApiTestData, createMemberSession, loginUser, registerUser } from '../helpers/api.js';

// Business A's user attacks Business B's data every way a client can: ids in URLs, bodies,
// query strings, headers, and by switching business. Nothing may be read or changed.

const { app, pool, close } = createTestApp();
let a; // owner of Business A
let b; // owner of Business B
let aContact;
let bContact;
let bSecond;

const NIL_UUID = '00000000-0000-4000-8000-000000000000';
const businessRows = async (businessId) =>
  (await pool.query('SELECT * FROM contacts WHERE business_id = $1 ORDER BY id', [businessId])).rows;

beforeAll(async () => {
  await cleanupApiTestData(pool);
  a = await registerUser(app, { businessName: 'Business A' });
  b = await registerUser(app, { businessName: 'Business B' });
  aContact = (await a.post('/api/contacts', { name: 'A Customer', types: ['customer'] })).body.data;
  bContact = (await b.post('/api/contacts', { name: 'Zorblax Secret Client', types: ['customer'], phone: '9877777777', panNumber: 'B-ONLY-PAN' })).body.data;
  bSecond = (await b.post('/api/contacts', { name: 'B Second', types: ['supplier'] })).body.data;
});
afterAll(async () => {
  await cleanupApiTestData(pool);
  await close();
});

describe("A cannot touch B's contacts by using B's ids", () => {
  it('cannot read one (404, exactly like an id that does not exist)', async () => {
    const real = await a.get(`/api/contacts/${bContact.id}`);
    const fake = await a.get(`/api/contacts/${NIL_UUID}`);
    expect(real.status).toBe(404);
    expect(real.body).toEqual({ error: { ...fake.body.error, requestId: real.body.error.requestId } }); // no existence oracle
    expect(JSON.stringify(real.body)).not.toContain('Zorblax');
  });

  it('cannot modify, archive or unarchive one, and nothing in B changes', async () => {
    const before = await businessRows(b.businessId);
    const results = [
      await a.patch(`/api/contacts/${bContact.id}`, { name: 'HACKED', phone: '0000' }),
      await a.post(`/api/contacts/${bContact.id}/archive`),
      await a.post(`/api/contacts/${bSecond.id}/archive`),
      await a.post(`/api/contacts/${bContact.id}/unarchive`),
    ];
    expect(results.map((r) => r.status)).toEqual([404, 404, 404, 404]);
    expect(await businessRows(b.businessId)).toEqual(before);
    expect((await b.get(`/api/contacts/${bContact.id}`)).body.data.name).toBe('Zorblax Secret Client');
  });

  it('cannot see B’s contacts in any list, search or filter', async () => {
    const listed = async (qs = '') => (await a.get(`/api/contacts${qs}`)).body.data.map((c) => c.id);
    expect(await listed()).toEqual([aContact.id]);
    expect(await listed('?archived=all')).toEqual([aContact.id]);
    expect(await listed('?q=Zorblax')).toEqual([]);
    expect(await listed('?q=9877777777')).toEqual([]);
    expect(await listed('?q=B-ONLY-PAN')).toEqual([]);
    expect(await listed('?q=%25')).toEqual([]); // "%" is a literal character, not "match everything"
    expect(await listed('?type=supplier')).toEqual([]);
    expect((await a.get('/api/contacts?pageSize=100')).body.meta.total).toBe(1);
  });

  it('treats id variations as nothing (upper-case, padded, injected, traversal)', async () => {
    const statuses = [
      (await a.get(`/api/contacts/${bContact.id.toUpperCase()}`)).status,
      (await a.get(`/api/contacts/${bContact.id}%20`)).status,
      (await a.get(`/api/contacts/${encodeURIComponent(`${bContact.id}' OR '1'='1`)}`)).status,
      (await a.get(`/api/contacts/${encodeURIComponent("'; DROP TABLE contacts; --")}`)).status,
      (await a.get('/api/contacts/..%2f..%2fauth%2fme')).status,
    ];
    for (const s of statuses) expect([400, 404]).toContain(s);
    expect((await pool.query('SELECT count(*)::int AS n FROM contacts')).rows[0].n).toBeGreaterThan(0); // table still there
  });

  it('search text that looks like SQL is just text', async () => {
    for (const q of ["' OR 1=1 --", "x') OR ('1'='1", '\\', '"; SELECT * FROM users; --']) {
      const res = await a.get(`/api/contacts?q=${encodeURIComponent(q)}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    }
  });
});

describe('A cannot redirect a request at B by naming B’s business', () => {
  it('rejects business_id / businessId in a create body, and creates nothing anywhere', async () => {
    const aBefore = await businessRows(a.businessId);
    const bBefore = await businessRows(b.businessId);
    for (const key of ['business_id', 'businessId']) {
      const res = await a.post('/api/contacts', { name: 'Planted', types: ['customer'], [key]: b.businessId });
      expect(res.status).toBe(400);
    }
    expect(await businessRows(a.businessId)).toEqual(aBefore);
    expect(await businessRows(b.businessId)).toEqual(bBefore);
  });

  it('rejects business_id in an update body, and A’s contact stays in A', async () => {
    const res = await a.patch(`/api/contacts/${aContact.id}`, { business_id: b.businessId, name: 'Moved' });
    expect(res.status).toBe(400);
    const { rows } = await pool.query('SELECT business_id, name FROM contacts WHERE id = $1', [aContact.id]);
    expect(rows[0]).toEqual({ business_id: a.businessId, name: 'A Customer' });
  });

  it('rejects business_id in the query string', async () => {
    expect((await a.get(`/api/contacts?business_id=${b.businessId}`)).status).toBe(400);
    expect((await a.get(`/api/contacts?businessId=${b.businessId}`)).status).toBe(400);
  });

  it('ignores business hints in headers: the session decides', async () => {
    const res = await a.get('/api/contacts').set('X-Business-Id', b.businessId).set('X-Forwarded-Business', b.businessId);
    expect(res.body.data.map((c) => c.id)).toEqual([aContact.id]);
  });

  it('cannot switch the session into B, and the refusal changes nothing', async () => {
    const res = await a.post('/api/auth/active-business', { businessId: b.businessId });
    expect(res.status).toBe(404);
    expect((await a.get(`/api/contacts/${bContact.id}`)).status).toBe(404);
    expect((await a.get('/api/auth/me')).body.data.activeBusiness.id).toBe(a.businessId);
  });

  it('cannot borrow B’s CSRF token or cookie halves', async () => {
    const wrongCsrf = await request(app)
      .patch(`/api/contacts/${aContact.id}`)
      .set('Cookie', `ln_session=${a.cookie}`)
      .set('X-CSRF-Token', b.csrf)
      .send({ name: 'x' });
    expect(wrongCsrf.status).toBe(403);
    // B's cookie with A's CSRF token is equally useless
    const wrongCookie = await request(app)
      .patch(`/api/contacts/${bContact.id}`)
      .set('Cookie', `ln_session=${b.cookie}`)
      .set('X-CSRF-Token', a.csrf)
      .send({ name: 'x' });
    expect(wrongCookie.status).toBe(403);
    expect((await b.get(`/api/contacts/${bContact.id}`)).body.data.name).toBe('Zorblax Secret Client');
  });

  it('B is unaffected by all of the above', async () => {
    const res = await b.get('/api/contacts?archived=all&pageSize=100');
    expect(res.body.data.map((c) => c.name).sort()).toEqual(['B Second', 'Zorblax Secret Client']);
    expect(res.body.data.every((c) => c.archivedAt === null)).toBe(true);
  });
});

describe('every contact endpoint requires a login', () => {
  const endpoints = [
    ['get', '/api/contacts'],
    ['post', '/api/contacts'],
    ['get', `/api/contacts/${NIL_UUID}`],
    ['patch', `/api/contacts/${NIL_UUID}`],
    ['post', `/api/contacts/${NIL_UUID}/archive`],
    ['post', `/api/contacts/${NIL_UUID}/unarchive`],
  ];
  it.each(endpoints)('%s %s without a session is 401', async (method, path) => {
    const res = await request(app)[method](path).send(method === 'get' ? undefined : { name: 'x', types: ['customer'] });
    expect(res.status).toBe(401);
  });

  it('a request carrying only another user’s CSRF token is still 401', async () => {
    const res = await request(app).post('/api/contacts').set('X-CSRF-Token', b.csrf).send({ name: 'x', types: ['customer'] });
    expect(res.status).toBe(401);
  });
});

describe('one person in two businesses never gets the union of their powers', () => {
  let dual; // staff in A, viewer in B
  beforeAll(async () => {
    dual = await createMemberSession(app, pool, { businessId: a.businessId, roleKey: 'staff', label: 'dual' });
    await pool.query(
      `INSERT INTO business_users (business_id, user_id, role_id) VALUES ($1, $2, (SELECT id FROM roles WHERE key = 'viewer'))`,
      [b.businessId, dual.user.id],
    );
    // Log in again now that they have two memberships, as a real user would.
    dual = await loginUser(app, { email: dual.email });
  });

  it('must choose a business before touching any business data', async () => {
    expect(dual.data.needsBusinessSelection).toBe(true);
    const res = await dual.get('/api/contacts');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NO_ACTIVE_BUSINESS');
  });

  it('as staff of A: can create, and sees only A', async () => {
    await dual.post('/api/auth/active-business', { businessId: a.businessId });
    const created = await dual.post('/api/contacts', { name: 'Made By Dual In A', types: ['customer'] });
    expect(created.status).toBe(201);
    const list = await dual.get('/api/contacts?pageSize=100');
    expect(list.body.data.map((c) => c.name)).toContain('Made By Dual In A');
    expect(list.body.data.map((c) => c.id)).not.toContain(bContact.id);
    const row = await pool.query('SELECT business_id FROM contacts WHERE id = $1', [created.body.data.id]);
    expect(row.rows[0].business_id).toBe(a.businessId);
  });

  it('as viewer of B: can read B, cannot write, and cannot see A', async () => {
    await dual.post('/api/auth/active-business', { businessId: b.businessId });
    expect((await dual.get(`/api/contacts/${bContact.id}`)).status).toBe(200);
    expect((await dual.post('/api/contacts', { name: 'Nope', types: ['customer'] })).status).toBe(403);
    expect((await dual.patch(`/api/contacts/${bContact.id}`, { name: 'Nope' })).status).toBe(403);
    expect((await dual.post(`/api/contacts/${bContact.id}/archive`)).status).toBe(403);
    expect((await dual.get(`/api/contacts/${aContact.id}`)).status).toBe(404);
  });
});

describe('lost access takes effect on the very next request', () => {
  it('a deactivated member keeps their session but loses all business access', async () => {
    const member = await createMemberSession(app, pool, { businessId: a.businessId, roleKey: 'accountant', label: 'leaver' });
    expect((await member.get(`/api/contacts/${aContact.id}`)).status).toBe(200);

    await pool.query(
      "UPDATE business_users SET status = 'deactivated', deactivated_at = now() WHERE id = $1",
      [member.membershipId],
    );
    for (const res of [
      await member.get(`/api/contacts/${aContact.id}`),
      await member.get('/api/contacts'),
      await member.post('/api/contacts', { name: 'After leaving', types: ['customer'] }),
      await member.patch(`/api/contacts/${aContact.id}`, { name: 'After leaving' }),
    ]) {
      expect(res.status).toBe(409);
      expect(JSON.stringify(res.body)).not.toContain('A Customer');
    }
    expect((await pool.query("SELECT 1 FROM contacts WHERE name = 'After leaving'")).rowCount).toBe(0);
  });

  it('a suspended business is locked for its own users, and other businesses carry on', async () => {
    const victim = await registerUser(app, { businessName: 'Soon Suspended' });
    const contact = (await victim.post('/api/contacts', { name: 'Held', types: ['customer'] })).body.data;
    await pool.query("UPDATE businesses SET status = 'suspended' WHERE id = $1", [victim.businessId]);

    expect((await victim.get(`/api/contacts/${contact.id}`)).status).toBe(409);
    expect((await victim.post('/api/contacts', { name: 'x', types: ['customer'] })).status).toBe(409);
    expect((await a.get('/api/contacts')).status).toBe(200);
  });

  it('a changed role applies immediately, with no new login', async () => {
    const member = await createMemberSession(app, pool, { businessId: a.businessId, roleKey: 'staff', label: 'demoted' });
    expect((await member.post('/api/contacts', { name: 'Allowed once', types: ['customer'] })).status).toBe(201);
    await pool.query("UPDATE business_users SET role_id = (SELECT id FROM roles WHERE key = 'viewer') WHERE id = $1", [member.membershipId]);
    expect((await member.post('/api/contacts', { name: 'Not allowed now', types: ['customer'] })).status).toBe(403);
    expect((await member.get('/api/contacts')).status).toBe(200);
  });
});

describe('platform administrators get no automatic access to business data', () => {
  it('a platform admin without a membership cannot read, write or list anything', async () => {
    const admin = await registerUser(app, { businessName: 'Admin Own Co' });
    await pool.query('UPDATE users SET is_platform_admin = true WHERE id = $1', [admin.user.id]);
    // remove their own business membership so they have none at all
    await pool.query('UPDATE business_users SET status = $2, deactivated_at = now() WHERE user_id = $1', [admin.user.id, 'deactivated']);

    for (const res of [
      await admin.get('/api/contacts'),
      await admin.get(`/api/contacts/${aContact.id}`),
      await admin.post('/api/contacts', { name: 'x', types: ['customer'] }),
      await admin.patch(`/api/contacts/${aContact.id}`, { name: 'x' }),
    ]) {
      expect(res.status).toBe(409);
    }
  });

  it('a platform admin who runs their own business sees only that business', async () => {
    const admin = await registerUser(app, { businessName: 'Admin Shop' });
    await pool.query('UPDATE users SET is_platform_admin = true WHERE id = $1', [admin.user.id]);
    expect((await admin.get(`/api/contacts/${aContact.id}`)).status).toBe(404);
    expect((await admin.get(`/api/contacts/${bContact.id}`)).status).toBe(404);
    expect((await admin.get('/api/contacts')).body.data).toEqual([]);
    expect((await admin.post('/api/auth/active-business', { businessId: a.businessId })).status).toBe(404);
  });
});

describe('audit trail stays inside the business that acted', () => {
  it('every contact action by A is logged against Business A only', async () => {
    const { rows } = await pool.query(
      "SELECT DISTINCT business_id FROM audit_logs WHERE entity_id = $1",
      [aContact.id],
    );
    expect(rows).toEqual([{ business_id: a.businessId }]);
    const bLogs = await pool.query(
      "SELECT 1 FROM audit_logs WHERE business_id = $1 AND actor_user_id = $2",
      [b.businessId, a.user.id],
    );
    expect(bLogs.rowCount).toBe(0); // A never acted inside B
  });
});

describe("ledger data is as tightly walled off as contacts", () => {
  let bEntry;
  let bEntry2;
  const bLedgerState = async () =>
    (await pool.query("SELECT id, status, total, txn_date, contact_id, description FROM transactions WHERE business_id = $1 ORDER BY id", [b.businessId])).rows;

  beforeAll(async () => {
    await b.put("/api/contacts/" + bContact.id + "/opening-balance", { amount: "7000", side: "they_owe_me", asOfDate: "2025-08-01" });
    bEntry = (await b.post("/api/ledger/entries", { contactId: bContact.id, txnDate: "2025-08-02", direction: "you_gave", amount: "1234.56", description: "Zorblax private deal" })).body.data;
    bEntry2 = (await b.post("/api/ledger/entries", { contactId: bContact.id, txnDate: "2025-08-03", direction: "you_got", amount: "34.00" })).body.data;
    await a.post("/api/ledger/entries", { contactId: aContact.id, txnDate: "2025-08-01", direction: "you_gave", amount: "50" });
  });

  it("cannot read B’s contact ledger or entries by id (404, same as a nonexistent id)", async () => {
    const foreignLedger = await a.get("/api/ledger/contacts/" + bContact.id);
    const missingLedger = await a.get("/api/ledger/contacts/" + NIL_UUID);
    expect(foreignLedger.status).toBe(404);
    expect(foreignLedger.body.error.message).toBe(missingLedger.body.error.message);
    const foreignEntry = await a.get("/api/ledger/entries/" + bEntry.id);
    const missingEntry = await a.get("/api/ledger/entries/" + NIL_UUID);
    expect(foreignEntry.status).toBe(404);
    expect(foreignEntry.body.error.message).toBe(missingEntry.body.error.message);
    for (const res of [foreignLedger, foreignEntry]) {
      expect(JSON.stringify(res.body)).not.toMatch(/Zorblax|1234\.56|7000/);
    }
  });

  it("cannot void, correct or edit B’s entries, and B’s books do not change", async () => {
    const before = await bLedgerState();
    const attempts = [
      await a.post("/api/ledger/entries/" + bEntry.id + "/void", { reason: "attack on another business" }),
      await a.post("/api/ledger/entries/" + bEntry.id + "/correct", { amount: "1", reason: "attack on another business" }),
      await a.patch("/api/ledger/entries/" + bEntry2.id, { description: "defaced" }),
    ];
    expect(attempts.map((r) => r.status)).toEqual([404, 404, 404]);
    expect(await bLedgerState()).toEqual(before);
  });

  it("cannot post into B’s contact, however the request is phrased", async () => {
    const before = await bLedgerState();
    const post = (extra = {}) => a.post("/api/ledger/entries", { contactId: bContact.id, txnDate: "2025-08-05", direction: "you_gave", amount: "1", ...extra });
    expect((await post()).status).toBe(404);
    expect((await post({ businessId: b.businessId })).status).toBe(400);
    expect((await post({ business_id: b.businessId })).status).toBe(400);
    expect(await bLedgerState()).toEqual(before);
    expect((await pool.query("SELECT 1 FROM transactions WHERE business_id = $1 AND contact_id = $2", [a.businessId, bContact.id])).rowCount).toBe(0);
  });

  it("cannot set, replace or remove an opening balance on B’s contact", async () => {
    const before = await bLedgerState();
    expect((await a.put("/api/contacts/" + bContact.id + "/opening-balance", { amount: "1", side: "i_owe_them" })).status).toBe(404);
    expect((await a.delete("/api/contacts/" + bContact.id + "/opening-balance")).status).toBe(404);
    expect(await bLedgerState()).toEqual(before);
  });

  it("never lists B’s entries, whatever filter is used, and never counts them", async () => {
    const own = await a.get("/api/ledger/entries?status=all&pageSize=200");
    expect(own.body.data.every((e) => e.contact.id === aContact.id)).toBe(true);
    expect(JSON.stringify(own.body)).not.toMatch(/Zorblax|1234\.56/);
    const byForeignContact = await a.get("/api/ledger/entries?contactId=" + bContact.id + "&status=all");
    expect(byForeignContact.body.data).toEqual([]);
    expect(byForeignContact.body.meta.total).toBe(0);
    const bySearch = await a.get("/api/ledger/entries?status=all&q=Zorblax");
    expect(bySearch.body.data).toEqual([]);
    expect((await a.get("/api/ledger/entries?business_id=" + b.businessId)).status).toBe(400);
  });

  it("balances in A’s contact list contain only A’s money", async () => {
    const list = (await a.get("/api/contacts?archived=all")).body.data;
    expect(list.map((c) => c.id)).toContain(aContact.id);
    expect(list.map((c) => c.id)).not.toContain(bContact.id);
    expect(list.find((c) => c.id === aContact.id).balance).toEqual({ amount: "50.00", side: "receivable" });
    expect(JSON.stringify(list)).not.toMatch(/7000|1234\.56|Zorblax/);
    expect((await a.get("/api/contacts/" + bContact.id)).status).toBe(404);
  });

  it("each business numbers its own entries; one business’s counter reveals nothing about the other", async () => {
    const aRef = (await a.post("/api/ledger/entries", { contactId: aContact.id, txnDate: "2025-08-04", direction: "you_gave", amount: "1" })).body.data.referenceNo;
    const aSeq = Number(aRef.slice(-4));
    const bSeq = Number(bEntry2.referenceNo.slice(-4));
    expect(aRef.startsWith("LE-")).toBe(true);
    expect(aSeq).toBe(2); // A has made exactly two entries in this fiscal year, regardless of B’s activity
    expect(bSeq).toBe(2);
  });

  it("a member of A who is only a viewer in B cannot post in B, and sees B’s books only while B is selected", async () => {
    const dual2 = await createMemberSession(app, pool, { businessId: a.businessId, roleKey: "staff", label: "dual-ledger" });
    await pool.query("INSERT INTO business_users (business_id, user_id, role_id) VALUES ($1, $2, (SELECT id FROM roles WHERE key = \x27viewer\x27))", [b.businessId, dual2.user.id]);
    const session = await loginUser(app, { email: dual2.email });
    await session.post("/api/auth/active-business", { businessId: b.businessId });
    expect((await session.get("/api/ledger/contacts/" + bContact.id)).status).toBe(200);
    expect((await session.post("/api/ledger/entries", { contactId: bContact.id, txnDate: "2025-08-05", direction: "you_gave", amount: "1" })).status).toBe(403);
    expect((await session.get("/api/ledger/contacts/" + aContact.id)).status).toBe(404);
    await session.post("/api/auth/active-business", { businessId: a.businessId });
    expect((await session.get("/api/ledger/contacts/" + bContact.id)).status).toBe(404);
  });

  it("a deactivated member reads no ledger at all", async () => {
    const leaver = await createMemberSession(app, pool, { businessId: a.businessId, roleKey: "accountant", label: "ledger-leaver" });
    expect((await leaver.get("/api/ledger/contacts/" + aContact.id)).status).toBe(200);
    await pool.query("UPDATE business_users SET status = \x27deactivated\x27, deactivated_at = now() WHERE id = $1", [leaver.membershipId]);
    for (const res of [await leaver.get("/api/ledger/contacts/" + aContact.id), await leaver.get("/api/ledger/entries"), await leaver.post("/api/ledger/entries", { contactId: aContact.id, txnDate: "2025-08-05", direction: "you_gave", amount: "1" })]) {
      expect(res.status).toBe(409);
    }
  });

  it("every ledger action of A is audited under Business A only", async () => {
    const { rows } = await pool.query(
      "SELECT DISTINCT business_id FROM audit_logs WHERE action LIKE \x27ledger.%\x27 AND actor_user_id = $1", [a.user.id]);
    expect(rows).toEqual([{ business_id: a.businessId }]);
    const bLogs = await pool.query("SELECT 1 FROM audit_logs WHERE business_id = $1 AND actor_user_id = $2", [b.businessId, a.user.id]);
    expect(bLogs.rowCount).toBe(0);
  });
});
