import pg from 'pg';
import { loadConfig } from '../../src/config/index.js';
import { runMigrations } from '../../src/db/migrate.js';
import { seedRbac } from '../../src/db/seedRbac.js';

// Runs once before the whole test run: bring the TEST database (never the main one)
// up to the latest schema and make sure roles/permissions exist.
export default async function setup() {
  const config = loadConfig({ ...process.env, NODE_ENV: 'test' });
  await runMigrations({ databaseUrl: config.migrationDatabaseUrl, direction: 'up' });
  const client = new pg.Client({ connectionString: config.databaseUrl });
  await client.connect();
  try {
    await seedRbac(client);
  } finally {
    await client.end();
  }
}
