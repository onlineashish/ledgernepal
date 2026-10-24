import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../helpers/testApp.js';
import { cleanupApiTestData, registerUser } from '../helpers/api.js';

const { app, pool, close } = createTestApp();
let owner;

beforeAll(async () => {
  await cleanupApiTestData(pool);
  owner = await registerUser(app, { businessName: 'Contacts Co' });
});
afterAll(async () => {
  await cleanupApiTestData(pool);
  await close();
});

const create = async (body) => (await owner.post('/api/contacts', body)).body.data;

describe('creating contacts', () => {
  it('needs only a name and a type — everything else is optional', async () => {
    const res = await owner.post('/api/contacts', { name: 'Ram Bahadur', types: ['customer'] });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      name: 'Ram Bahadur',
      types: ['customer'],
      phone: null,
      email: null,
      address: null,
      panNumber: null,
      vatNumber: null,
      notes: null,
      archivedAt: null,
    });
    expect(res.body.data.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('stores every field, trims text, lower-cases email, and supports Nepali script', async () => {
    const res = await owner.post('/api/contacts', {
      name: '  राम बहादुर श्रेष्ठ  ',
      types: ['supplier'],
      phone: ' 9841234567 ',
      email: 'Ram@Example.COM',
      address: 'Thamel, Kathmandu',
      panNumber: '123456789',
      vatNumber: '987654321',
      notes: 'Pays on the 1st of every month',
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      name: 'राम बहादुर श्रेष्ठ',
      phone: '9841234567',
      email: 'ram@example.com',
      panNumber: '123456789',
      vatNumber: '987654321',
    });
  });

  it('allows several roles at once and ignores repeats', async () => {
    const res = await owner.post('/api/contacts', { name: 'Both Ways', types: ['customer', 'supplier', 'customer'] });
    expect(res.body.data.types).toEqual(['customer', 'supplier']);
    const partner = await owner.post('/api/contacts', { name: 'Partner Too', types: ['customer', 'supplier', 'partner'] });
    expect(partner.body.data.types).toEqual(['customer', 'supplier', 'partner']);
  });

  it('treats empty strings as "no value"', async () => {
    const res = await owner.post('/api/contacts', { name: 'Blank Fields', types: ['customer'], phone: '', email: '  ', panNumber: '', notes: '' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ phone: null, email: null, panNumber: null, notes: null });
  });

  it('does NOT force phone, PAN or VAT to be unique, and allows duplicate names', async () => {
    const shared = { phone: '9800000000', panNumber: '111111111', vatNumber: '222222222' };
    const a = await owner.post('/api/contacts', { name: 'Twin', types: ['customer'], ...shared });
    const b = await owner.post('/api/contacts', { name: 'Twin', types: ['customer'], ...shared });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.data.id).not.toBe(b.body.data.id);
  });

  it.each([
    ['no name', { types: ['customer'] }, 'name', /required/i],
    ['blank name', { name: '   ', types: ['customer'] }, 'name', /required/i],
    ['name too long', { name: 'x'.repeat(151), types: ['customer'] }, 'name', /at most 150/],
    ['no type', { name: 'A' }, 'types', /at least one/i],
    ['empty type list', { name: 'A', types: [] }, 'types', /at least one/i],
    ['unknown type', { name: 'A', types: ['banker'] }, 'types.0', /customer, supplier or partner/],
    ['invalid email', { name: 'A', types: ['customer'], email: 'nope' }, 'email', /valid email/i],
    ['notes too long', { name: 'A', types: ['customer'], notes: 'x'.repeat(2001) }, 'notes', /at most 2000/],
    ['phone not text', { name: 'A', types: ['customer'], phone: 12345 }, 'phone', /must be text/],
  ])('rejects %s with a clear message', async (_label, body, field, message) => {
    const res = await owner.post('/api/contacts', body);
    expect(res.status).toBe(400);
    const detail = res.body.error.details.find((d) => d.field === field);
    expect(detail, JSON.stringify(res.body.error.details)).toBeDefined();
    expect(detail.message).toMatch(message);
  });

  it.each(['business_id', 'businessId', 'createdBy', 'archivedAt', 'id', 'isCustomer'])(
    'rejects an unexpected field "%s" instead of ignoring it',
    async (key) => {
      const res = await owner.post('/api/contacts', { name: 'A', types: ['customer'], [key]: 'x' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    },
  );

  it('records who created it and an audit entry scoped to the business', async () => {
    const contact = await create({ name: 'Audited', types: ['customer'] });
    const { rows } = await pool.query(
      `SELECT c.created_by, a.business_id, a.actor_user_id, a.action, a.after
         FROM contacts c JOIN audit_logs a ON a.entity_id = c.id
        WHERE c.id = $1`,
      [contact.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ created_by: owner.user.id, business_id: owner.businessId, actor_user_id: owner.user.id, action: 'contact.create' });
    expect(rows[0].after.name).toBe('Audited');
  });
});

describe('reading and listing', () => {
  let ids;
  beforeAll(async () => {
    const make = (name, types, extra = {}) => create({ name, types, ...extra });
    ids = {
      alpha: (await make('Zeta List Alpha', ['customer'], { phone: '9811111111', panNumber: 'PAN-ALPHA' })).id,
      beta: (await make('zeta list beta', ['supplier'], { email: 'beta@list.example' })).id,
      gamma: (await make('Zeta List Gamma', ['partner'])).id,
      delta: (await make('Zeta List Delta', ['customer', 'supplier'])).id,
      percent: (await make('Zeta 100% Special_Name', ['customer'])).id,
    };
  });

  it('gets one contact by id', async () => {
    const res = await owner.get(`/api/contacts/${ids.alpha}`);
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Zeta List Alpha');
  });

  it('returns 400 for a malformed id and 404 for an unknown one', async () => {
    expect((await owner.get('/api/contacts/not-a-uuid')).status).toBe(400);
    expect((await owner.get('/api/contacts/00000000-0000-4000-8000-000000000000')).status).toBe(404);
  });

  it('searches name, phone, email and PAN, ignoring case', async () => {
    const names = async (q) => (await owner.get(`/api/contacts?q=${encodeURIComponent(q)}`)).body.data.map((c) => c.name);
    expect(await names('zeta list')).toHaveLength(4);
    expect(await names('ZETA LIST ALPHA')).toEqual(['Zeta List Alpha']);
    expect(await names('9811111')).toEqual(['Zeta List Alpha']);
    expect(await names('beta@list')).toEqual(['zeta list beta']);
    expect(await names('pan-alpha')).toEqual(['Zeta List Alpha']);
  });

  it('treats % and _ in a search as plain characters, not wildcards', async () => {
    const res = await owner.get(`/api/contacts?q=${encodeURIComponent('100%')}`);
    expect(res.body.data.map((c) => c.id)).toEqual([ids.percent]);
    const underscore = await owner.get(`/api/contacts?q=${encodeURIComponent('Special_Name')}`);
    expect(underscore.body.data.map((c) => c.id)).toEqual([ids.percent]);
    const all = await owner.get(`/api/contacts?q=${encodeURIComponent('%')}`);
    expect(all.body.data.map((c) => c.id)).toEqual([ids.percent]); // only the one that really contains a percent sign
  });

  it('filters by contact type, including contacts with several roles', async () => {
    const type = async (t) => (await owner.get(`/api/contacts?type=${t}&q=zeta`)).body.data.map((c) => c.id).sort();
    expect(await type('customer')).toEqual([ids.alpha, ids.delta, ids.percent].sort());
    expect(await type('supplier')).toEqual([ids.beta, ids.delta].sort());
    expect(await type('partner')).toEqual([ids.gamma]);
    expect((await owner.get('/api/contacts?type=banker')).status).toBe(400);
  });

  it('sorts by name regardless of letter case and paginates with accurate totals', async () => {
    const page1 = await owner.get('/api/contacts?q=zeta%20list&pageSize=3&page=1');
    const page2 = await owner.get('/api/contacts?q=zeta%20list&pageSize=3&page=2');
    expect(page1.body.meta).toEqual({ page: 1, pageSize: 3, total: 4 });
    expect(page1.body.data.map((c) => c.name)).toEqual(['Zeta List Alpha', 'zeta list beta', 'Zeta List Delta']);
    expect(page2.body.data.map((c) => c.name)).toEqual(['Zeta List Gamma']);
    const beyond = await owner.get('/api/contacts?q=zeta%20list&pageSize=3&page=9');
    expect(beyond.body.data).toEqual([]);
    expect(beyond.body.meta.total).toBe(4);
  });

  it.each(['pageSize=0', 'pageSize=101', 'page=0', 'page=abc', 'archived=maybe', 'sort=name', 'q=a&q=b'])(
    'rejects bad query "%s"',
    async (query) => {
      expect((await owner.get(`/api/contacts?${query}`)).status).toBe(400);
    },
  );
});

describe('updating', () => {
  it('changes only the fields sent', async () => {
    const c = await create({ name: 'Before', types: ['customer'], phone: '111', notes: 'keep me' });
    const res = await owner.patch(`/api/contacts/${c.id}`, { name: 'After', address: 'New Road' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ name: 'After', address: 'New Road', phone: '111', notes: 'keep me', types: ['customer'] });
    expect(new Date(res.body.data.updatedAt).getTime()).toBeGreaterThan(new Date(c.updatedAt).getTime());
  });

  it('clears an optional field with null or an empty string, and changes the roles', async () => {
    const c = await create({ name: 'Clearable', types: ['customer'], phone: '111', email: 'a@b.example' });
    const res = await owner.patch(`/api/contacts/${c.id}`, { phone: null, email: '', types: ['supplier', 'partner'] });
    expect(res.body.data).toMatchObject({ phone: null, email: null, types: ['supplier', 'partner'] });
  });

  it('rejects an empty change, invalid values, and unexpected fields', async () => {
    const c = await create({ name: 'Strict', types: ['customer'] });
    expect((await owner.patch(`/api/contacts/${c.id}`, {})).status).toBe(400);
    expect((await owner.patch(`/api/contacts/${c.id}`, { name: '' })).status).toBe(400);
    expect((await owner.patch(`/api/contacts/${c.id}`, { types: [] })).status).toBe(400);
    expect((await owner.patch(`/api/contacts/${c.id}`, { archivedAt: null })).status).toBe(400);
    expect((await owner.patch(`/api/contacts/${c.id}`, { business_id: owner.businessId })).status).toBe(400);
  });

  it('writes an audit entry showing exactly what changed', async () => {
    const c = await create({ name: 'Diff', types: ['customer'], phone: '1' });
    await owner.patch(`/api/contacts/${c.id}`, { phone: '2', notes: 'n' });
    const { rows } = await pool.query("SELECT before, after FROM audit_logs WHERE entity_id = $1 AND action = 'contact.update'", [c.id]);
    expect(rows[0].before).toEqual({ phone: '1', notes: null });
    expect(rows[0].after).toEqual({ phone: '2', notes: 'n' });
  });

  it('returns 404 for an unknown contact', async () => {
    expect((await owner.patch('/api/contacts/00000000-0000-4000-8000-000000000000', { name: 'X' })).status).toBe(404);
  });
});

describe('archiving', () => {
  it('hides archived contacts from the default list but keeps them retrievable and listable on request', async () => {
    const c = await create({ name: 'Archive Me Please', types: ['customer'] });
    const archived = await owner.post(`/api/contacts/${c.id}/archive`);
    expect(archived.status).toBe(200);
    expect(archived.body.data.archivedAt).not.toBeNull();

    const find = async (archivedParam) =>
      (await owner.get(`/api/contacts?q=archive%20me%20please&archived=${archivedParam}`)).body.data.map((x) => x.id);
    expect(await find('false')).toEqual([]);
    expect(await find('true')).toEqual([c.id]);
    expect(await find('all')).toEqual([c.id]);
    expect((await owner.get(`/api/contacts/${c.id}`)).status).toBe(200);
  });

  it('can be undone, and refuses to archive or unarchive twice', async () => {
    const c = await create({ name: 'Round Trip', types: ['customer'] });
    expect((await owner.post(`/api/contacts/${c.id}/unarchive`)).status).toBe(409); // not archived yet
    expect((await owner.post(`/api/contacts/${c.id}/archive`)).status).toBe(200);
    expect((await owner.post(`/api/contacts/${c.id}/archive`)).status).toBe(409);
    const back = await owner.post(`/api/contacts/${c.id}/unarchive`);
    expect(back.status).toBe(200);
    expect(back.body.data.archivedAt).toBeNull();
  });

  it('records who archived it', async () => {
    const c = await create({ name: 'Who Archived', types: ['customer'] });
    await owner.post(`/api/contacts/${c.id}/archive`);
    const { rows } = await pool.query('SELECT archived_by FROM contacts WHERE id = $1', [c.id]);
    expect(rows[0].archived_by).toBe(owner.user.id);
    const audit = await pool.query("SELECT action FROM audit_logs WHERE entity_id = $1 ORDER BY id", [c.id]);
    expect(audit.rows.map((r) => r.action)).toEqual(['contact.create', 'contact.archive']);
  });
});

describe('database rules behind the API', () => {
  it('refuses a contact with no role, a blank name, or an archived timestamp without an archiver', async () => {
    const insert = (sql, params) => pool.query(sql, [owner.businessId, owner.user.id, ...params]);
    await expect(insert('INSERT INTO contacts (business_id, created_by, name) VALUES ($1, $2, $3)', ['No Role'])).rejects.toMatchObject({ code: '23514' });
    await expect(insert('INSERT INTO contacts (business_id, created_by, name, is_customer) VALUES ($1, $2, $3, true)', ['   '])).rejects.toMatchObject({ code: '23514' });
    await expect(insert('INSERT INTO contacts (business_id, created_by, name, is_customer, archived_at) VALUES ($1, $2, $3, true, now())', ['Half Archived'])).rejects.toMatchObject({ code: '23514' });
  });
});
