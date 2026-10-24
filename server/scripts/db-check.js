// Usage: npm run db:check — verifies the app can reach Neon with the configured URLs.
import pg from 'pg';
import { loadConfig } from '../src/config/index.js';

const config = loadConfig();

async function check(label, connectionString) {
  if (!connectionString) {
    console.log(`- ${label}: not configured`);
    return true;
  }
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 15_000 });
  try {
    await client.connect();
    const { rows } = await client.query(
      "SELECT current_database() AS db, current_user AS usr, current_setting('server_version') AS version",
    );
    console.log(`✓ ${label}: connected (db=${rows[0].db}, user=${rows[0].usr}, postgres ${rows[0].version})`);
    return true;
  } catch (err) {
    console.error(`✗ ${label}: ${err.message}`);
    return false;
  } finally {
    await client.end().catch(() => {});
  }
}

const results = [
  await check('DATABASE_URL (pooled)', config.databaseUrl),
  await check('DATABASE_URL_DIRECT (migrations)', process.env.DATABASE_URL_DIRECT),
  await check('TEST_DATABASE_URL (tests)', process.env.TEST_DATABASE_URL),
];
process.exit(results.every(Boolean) ? 0 : 1);
