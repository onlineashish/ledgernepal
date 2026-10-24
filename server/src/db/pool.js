import pg from 'pg';

// Return DATE columns as 'YYYY-MM-DD' strings instead of JS Dates, so a
// business date never shifts by timezone (Nepal is UTC+5:45).
pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value);
// NUMERIC (money) stays a string by default in pg — keep it that way; never parseFloat money.

export function createPool(connectionString) {
  return new pg.Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    // Neon computes may be cold-starting; allow time to wake up.
    connectionTimeoutMillis: 15_000,
  });
}

/**
 * Runs `fn(client)` inside a single database transaction.
 * Commits if fn resolves, rolls back if it throws, and always releases the client.
 */
export async function withTransaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
