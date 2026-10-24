import pg from 'pg';
import { loadConfig } from '../../src/config/index.js';
import { runMigrations } from '../../src/db/migrate.js';
import { seedRbac } from '../../src/db/seedRbac.js';

// Runs once before the whole test run: bring the TEST database (never the main one)
// up to the latest schema, make sure roles/permissions exist, and sweep away anything a
// crashed earlier run left behind. Test files then run in parallel, each cleaning up its own
// data (every file uses its own e-mail domain under *.api-test.example).
export default async function setup() {
  const config = loadConfig({ ...process.env, NODE_ENV: 'test' });
  await runMigrations({ databaseUrl: config.migrationDatabaseUrl, direction: 'up' });
  const client = new pg.Client({ connectionString: config.databaseUrl });
  await client.connect();
  try {
    await seedRbac(client);
    await client.query(
      "DELETE FROM businesses WHERE created_by IN (SELECT id FROM users WHERE email LIKE '%api-test.example')",
    );
    await client.query("DELETE FROM users WHERE email LIKE '%api-test.example'");
  } finally {
    await client.end();
  }
}
