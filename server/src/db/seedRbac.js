import {
  PERMISSIONS,
  ROLES,
  ROLE_PERMISSIONS,
} from '@ledgernepal/shared/permissions';

/**
 * Makes the roles / permissions / role_permissions tables match shared/permissions.js.
 * Idempotent: safe to run on every deploy. Runs in one transaction so a half-applied
 * matrix is never visible. It never touches business_users or per-member overrides.
 */
export async function seedRbac(client) {
  await client.query('BEGIN');
  try {
    for (const [key, description] of Object.entries(PERMISSIONS)) {
      await client.query(
        `INSERT INTO permissions (key, description) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET description = EXCLUDED.description`,
        [key, description],
      );
    }
    for (const [key, { name, rank }] of Object.entries(ROLES)) {
      await client.query(
        `INSERT INTO roles (key, name, rank, is_system) VALUES ($1, $2, $3, true)
         ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, rank = EXCLUDED.rank`,
        [key, name, rank],
      );
    }

    // Rebuild the default matrix: add what is missing, remove what the file no longer grants.
    for (const [roleKey, permissionKeys] of Object.entries(ROLE_PERMISSIONS)) {
      await client.query(
        `INSERT INTO role_permissions (role_id, permission_id)
         SELECT r.id, p.id FROM roles r JOIN permissions p ON p.key = ANY($2::text[])
         WHERE r.key = $1
         ON CONFLICT DO NOTHING`,
        [roleKey, permissionKeys],
      );
      await client.query(
        `DELETE FROM role_permissions rp USING roles r, permissions p
         WHERE rp.role_id = r.id AND rp.permission_id = p.id
           AND r.key = $1 AND NOT (p.key = ANY($2::text[]))`,
        [roleKey, permissionKeys],
      );
    }
    // Permissions dropped from the file disappear (cascades to role_permissions and overrides).
    await client.query('DELETE FROM permissions WHERE NOT (key = ANY($1::text[]))', [
      Object.keys(PERMISSIONS),
    ]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  }
}
