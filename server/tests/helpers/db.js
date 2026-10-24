import { randomUUID } from 'node:crypto';
import { loadConfig } from '../../src/config/index.js';
import { createPool } from '../../src/db/pool.js';

export function createTestPool() {
  return createPool(loadConfig().databaseUrl);
}

const unique = () => randomUUID().slice(0, 8);

export async function createUser(db, overrides = {}) {
  const { rows } = await db.query(
    `INSERT INTO users (email, password_hash, full_name, is_platform_admin)
     VALUES ($1, 'not-a-real-hash', $2, $3) RETURNING *`,
    [
      overrides.email ?? `user-${unique()}@test.example`,
      overrides.fullName ?? 'Test User',
      overrides.isPlatformAdmin ?? false,
    ],
  );
  return rows[0];
}

export async function createBusiness(db, createdBy, name = 'Test Business') {
  const { rows } = await db.query(
    'INSERT INTO businesses (name, created_by) VALUES ($1, $2) RETURNING *',
    [`${name} ${unique()}`, createdBy],
  );
  await db.query('INSERT INTO business_settings (business_id) VALUES ($1)', [rows[0].id]);
  return rows[0];
}

export async function addMember(db, { businessId, userId, roleKey, status = 'active' }) {
  const { rows } = await db.query(
    `INSERT INTO business_users (business_id, user_id, role_id, status, deactivated_at)
     VALUES ($1, $2, (SELECT id FROM roles WHERE key = $3), $4,
             CASE WHEN $4 = 'deactivated' THEN now() END)
     RETURNING *`,
    [businessId, userId, roleKey, status],
  );
  return rows[0];
}

/** Removes the given businesses and users (children cascade). Audit rows are append-only and stay. */
export async function cleanup(db, { businessIds = [], userIds = [] }) {
  if (businessIds.length) await db.query('DELETE FROM businesses WHERE id = ANY($1)', [businessIds]);
  if (userIds.length) await db.query('DELETE FROM users WHERE id = ANY($1)', [userIds]);
}
