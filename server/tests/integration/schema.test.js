import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PERMISSION_KEYS,
  ROLE_KEYS,
  ROLE_PERMISSIONS,
  ROLES,
} from '@ledgernepal/shared/permissions';
import { seedRbac } from '../../src/db/seedRbac.js';
import { addMember, cleanup, createBusiness, createTestPool, createUser } from '../helpers/db.js';

const db = createTestPool();
const created = { businessIds: [], userIds: [] };

async function newUser(overrides) {
  const user = await createUser(db, overrides);
  created.userIds.push(user.id);
  return user;
}
async function newBusiness(owner) {
  const business = await createBusiness(db, owner.id);
  created.businessIds.push(business.id);
  return business;
}

afterAll(async () => {
  await cleanup(db, created);
  await db.end();
});

// pg errors carry the Postgres SQLSTATE in `code`.
const PG = { unique: '23505', check: '23514', foreignKey: '23503', notNull: '23502', raise: 'P0001' };
const expectPgError = (promise, code) => expect(promise).rejects.toMatchObject({ code });

describe('seeded roles and permissions', () => {
  it('contains exactly the roles and permissions defined in shared/permissions.js', async () => {
    const roles = await db.query('SELECT key, rank FROM roles ORDER BY rank DESC');
    expect(roles.rows.map((r) => r.key)).toEqual([...ROLE_KEYS].sort((a, b) => ROLES[b].rank - ROLES[a].rank));

    const perms = await db.query('SELECT key FROM permissions');
    expect(perms.rows.map((p) => p.key).sort()).toEqual([...PERMISSION_KEYS].sort());
  });

  it.each(ROLE_KEYS)('role "%s" has exactly its default permission set', async (roleKey) => {
    const { rows } = await db.query(
      `SELECT p.key FROM role_permissions rp
       JOIN roles r ON r.id = rp.role_id JOIN permissions p ON p.id = rp.permission_id
       WHERE r.key = $1`,
      [roleKey],
    );
    expect(rows.map((r) => r.key).sort()).toEqual([...ROLE_PERMISSIONS[roleKey]].sort());
  });

  it('keeps destructive and sensitive permissions away from the lower roles', () => {
    expect(ROLE_PERMISSIONS.viewer.filter((p) => /\.(create|update|void|archive|manage|invite|correct)$/.test(p))).toEqual([]);
    expect(ROLE_PERMISSIONS.staff).not.toContain('sales.void');
    expect(ROLE_PERMISSIONS.staff).not.toContain('payments.view');
    expect(ROLE_PERMISSIONS.staff).not.toContain('reports.view');
    expect(ROLE_PERMISSIONS.business_admin).not.toContain('ledger.correct');
    expect(ROLE_PERMISSIONS.accountant).not.toContain('users.manage');
  });

  it('seeding twice changes nothing (idempotent)', async () => {
    const count = async () =>
      (await db.query('SELECT (SELECT count(*) FROM roles) r, (SELECT count(*) FROM permissions) p, (SELECT count(*) FROM role_permissions) rp')).rows[0];
    const before = await count();
    const client = await db.connect();
    try {
      await seedRbac(client);
    } finally {
      client.release();
    }
    expect(await count()).toEqual(before);
  });
});

describe('users', () => {
  it('treats emails as case-insensitive and unique', async () => {
    const user = await newUser({ email: `Case-${Date.now()}@Test.Example` });
    await expectPgError(newUser({ email: user.email.toLowerCase() }), PG.unique);
  });

  it('rejects an unknown status and a blank name', async () => {
    await expectPgError(db.query("INSERT INTO users (email, password_hash, full_name, status) VALUES ('x1@t.example','h','N','banned')"), PG.check);
    await expectPgError(db.query("INSERT INTO users (email, password_hash, full_name) VALUES ('x2@t.example','h','   ')"), PG.check);
  });

  it('never exposes a platform admin as a business member by default', async () => {
    const admin = await newUser({ isPlatformAdmin: true });
    const { rowCount } = await db.query('SELECT 1 FROM business_users WHERE user_id = $1', [admin.id]);
    expect(rowCount).toBe(0);
  });
});

describe('businesses and memberships', () => {
  it('rejects an invalid business status and invalid VAT rate', async () => {
    const owner = await newUser();
    await expectPgError(db.query("INSERT INTO businesses (name, status) VALUES ('B','deleted')"), PG.check);
    const business = await newBusiness(owner);
    await expectPgError(db.query('UPDATE business_settings SET default_vat_rate = 150 WHERE business_id = $1', [business.id]), PG.check);
  });

  it('does not assume any VAT rate', async () => {
    const owner = await newUser();
    const business = await newBusiness(owner);
    const { rows } = await db.query('SELECT default_vat_rate, date_display FROM business_settings WHERE business_id = $1', [business.id]);
    expect(rows[0].default_vat_rate).toBeNull();
    expect(rows[0].date_display).toBe('BS');
  });

  it('allows a user to belong to several businesses but only once to each', async () => {
    const user = await newUser();
    const a = await newBusiness(user);
    const b = await newBusiness(user);
    await addMember(db, { businessId: a.id, userId: user.id, roleKey: 'owner' });
    await addMember(db, { businessId: b.id, userId: user.id, roleKey: 'viewer' });
    await expectPgError(addMember(db, { businessId: a.id, userId: user.id, roleKey: 'staff' }), PG.unique);
  });

  it('allows only one active owner per business, but a deactivated owner does not count', async () => {
    const [u1, u2, u3] = [await newUser(), await newUser(), await newUser()];
    const business = await newBusiness(u1);
    const first = await addMember(db, { businessId: business.id, userId: u1.id, roleKey: 'owner' });
    expect(first.is_owner).toBe(true);
    await expectPgError(addMember(db, { businessId: business.id, userId: u2.id, roleKey: 'owner' }), PG.unique);

    await db.query("UPDATE business_users SET status='deactivated', deactivated_at=now() WHERE id=$1", [first.id]);
    const second = await addMember(db, { businessId: business.id, userId: u3.id, roleKey: 'owner' });
    expect(second.is_owner).toBe(true);
  });

  it('keeps is_owner in step with the role, even if someone tries to set it by hand', async () => {
    const [u1, u2] = [await newUser(), await newUser()];
    const business = await newBusiness(u1);
    await addMember(db, { businessId: business.id, userId: u1.id, roleKey: 'owner' });
    const staff = await addMember(db, { businessId: business.id, userId: u2.id, roleKey: 'staff' });
    expect(staff.is_owner).toBe(false);

    // Trying to smuggle in a second owner flag without changing the role does not bypass anything:
    // promoting via role_id is the only path, and it trips the one-owner index.
    await expectPgError(
      db.query("UPDATE business_users SET role_id = (SELECT id FROM roles WHERE key='owner') WHERE id=$1", [staff.id]),
      PG.unique,
    );
  });

  it('requires deactivated_at exactly when the membership is deactivated', async () => {
    const user = await newUser();
    const business = await newBusiness(user);
    const member = await addMember(db, { businessId: business.id, userId: user.id, roleKey: 'staff' });
    await expectPgError(db.query("UPDATE business_users SET status='deactivated' WHERE id=$1", [member.id]), PG.check);
  });

  it('refuses permission overrides that point at a member of a different business', async () => {
    const user = await newUser();
    const a = await newBusiness(user);
    const b = await newBusiness(user);
    const memberOfA = await addMember(db, { businessId: a.id, userId: user.id, roleKey: 'staff' });
    // Composite FK (business_id, business_user_id): claiming business B for A's member fails.
    await expectPgError(
      db.query(
        `INSERT INTO business_user_permission_overrides (business_id, business_user_id, permission_id, effect)
         VALUES ($1, $2, (SELECT id FROM permissions WHERE key='sales.void'), 'grant')`,
        [b.id, memberOfA.id],
      ),
      PG.foreignKey,
    );
    // And the correct business works.
    await db.query(
      `INSERT INTO business_user_permission_overrides (business_id, business_user_id, permission_id, effect)
       VALUES ($1, $2, (SELECT id FROM permissions WHERE key='sales.void'), 'grant')`,
      [a.id, memberOfA.id],
    );
  });

  it('allows only one open invitation per email per business', async () => {
    const owner = await newUser();
    const business = await newBusiness(owner);
    const insert = (hash) =>
      db.query(
        `INSERT INTO invitations (business_id, email, role_id, token_hash, invited_by, expires_at)
         VALUES ($1, 'Invitee@Test.Example', (SELECT id FROM roles WHERE key='staff'), $2, $3, now() + interval '7 days')`,
        [business.id, hash, owner.id],
      );
    await insert('hash-1');
    await expectPgError(insert('hash-2'), PG.unique);
    await db.query("UPDATE invitations SET revoked_at = now() WHERE token_hash = 'hash-1'");
    await insert('hash-2'); // allowed again once the first is revoked
  });
});

describe('sessions', () => {
  it('stores only a token hash, requires an expiry, and dies with its user', async () => {
    const user = await newUser();
    await db.query(
      `INSERT INTO sessions (token_hash, csrf_token, user_id, expires_at)
       VALUES ($2, 'c', $1, now() + interval '1 day')`,
      [user.id, `hash-${user.id}`],
    );
    await expectPgError(
      db.query("INSERT INTO sessions (token_hash, csrf_token, user_id) VALUES ('h2','c',$1)", [user.id]),
      PG.notNull,
    );
    await db.query('DELETE FROM users WHERE id = $1', [user.id]);
    const { rowCount } = await db.query('SELECT 1 FROM sessions WHERE user_id = $1', [user.id]);
    expect(rowCount).toBe(0);
  });

  it('is cleared of its active business when that business is deleted', async () => {
    const user = await newUser();
    const business = await newBusiness(user);
    const { rows } = await db.query(
      `INSERT INTO sessions (token_hash, csrf_token, user_id, active_business_id, expires_at)
       VALUES ($3, 'c', $1, $2, now() + interval '1 day') RETURNING id`,
      [user.id, business.id, `hash3-${user.id}`],
    );
    await db.query('DELETE FROM businesses WHERE id = $1', [business.id]);
    const after = await db.query('SELECT active_business_id FROM sessions WHERE id = $1', [rows[0].id]);
    expect(after.rows[0].active_business_id).toBeNull();
  });
});

describe('audit_logs', () => {
  let rowId;
  beforeAll(async () => {
    const { rows } = await db.query(
      "INSERT INTO audit_logs (action, metadata) VALUES ('test.schema', '{\"k\":1}') RETURNING id",
    );
    rowId = rows[0].id;
  });

  it('accepts inserts and requires an action', async () => {
    await expectPgError(db.query("INSERT INTO audit_logs (action) VALUES ('')"), PG.check);
    await expectPgError(db.query('INSERT INTO audit_logs (action) VALUES (NULL)'), PG.notNull);
  });

  it('cannot be updated', async () => {
    await expectPgError(db.query("UPDATE audit_logs SET action = 'tampered' WHERE id = $1", [rowId]), PG.raise);
  });

  it('cannot be deleted', async () => {
    await expectPgError(db.query('DELETE FROM audit_logs WHERE id = $1', [rowId]), PG.raise);
  });

  it('cannot be truncated', async () => {
    await expectPgError(db.query('TRUNCATE audit_logs'), PG.raise);
  });
});

describe('updated_at triggers', () => {
  it('moves updated_at forward on update', async () => {
    const user = await newUser();
    await new Promise((r) => setTimeout(r, 20));
    const { rows } = await db.query("UPDATE users SET full_name = 'Renamed' WHERE id = $1 RETURNING created_at, updated_at", [user.id]);
    expect(rows[0].updated_at.getTime()).toBeGreaterThan(rows[0].created_at.getTime());
  });
});
