// Usage (from the repo root):
//   npm run db:migrate            apply all pending migrations, then seed roles/permissions
//   npm run db:migrate:down       revert the most recent migration (one step)
//   npm run db:seed               re-sync roles/permissions only
//   npm run db:status             list applied migrations
import pg from 'pg';
import { loadConfig } from '../src/config/index.js';
import { runMigrations } from '../src/db/migrate.js';
import { seedRbac } from '../src/db/seedRbac.js';

const command = process.argv[2] ?? 'up';
const config = loadConfig();
const url = config.migrationDatabaseUrl;
const log = (msg) => console.log(typeof msg === 'string' ? msg : JSON.stringify(msg));

async function withClient(fn) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

try {
  if (command === 'up') {
    const applied = await runMigrations({ databaseUrl: url, direction: 'up', log });
    console.log(`Applied ${applied.length} migration(s).`);
    await withClient(seedRbac);
    console.log('Roles and permissions are in sync with shared/permissions.js.');
  } else if (command === 'down') {
    if (config.isProduction && process.env.ALLOW_PRODUCTION_DOWN !== 'yes') {
      throw new Error('Refusing to roll back in production (set ALLOW_PRODUCTION_DOWN=yes to override).');
    }
    const reverted = await runMigrations({ databaseUrl: url, direction: 'down', log });
    console.log(`Reverted ${reverted.length} migration(s).`);
  } else if (command === 'seed') {
    await withClient(seedRbac);
    console.log('Roles and permissions are in sync with shared/permissions.js.');
  } else if (command === 'status') {
    const rows = await withClient((c) => c.query('SELECT name, run_on FROM pgmigrations ORDER BY id'));
    rows.rows.forEach((r) => console.log(`${r.run_on.toISOString()}  ${r.name}`));
    if (!rows.rowCount) console.log('No migrations applied.');
  } else {
    throw new Error(`Unknown command "${command}". Use: up | down | seed | status`);
  }
} catch (err) {
  console.error(`✗ ${err.message}`);
  process.exitCode = 1;
}
