import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';

const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../migrations');

/**
 * Applies (up) or reverts (down) migrations. Only ever touches the migrations
 * table plus what the migration files themselves change.
 */
export async function runMigrations({ databaseUrl, direction = 'up', count, log = () => {} }) {
  return runner({
    databaseUrl,
    dir: migrationsDir,
    direction,
    // `up` applies everything pending; `down` reverts only what was asked for (default: one step).
    count: direction === 'up' ? (count ?? Infinity) : (count ?? 1),
    migrationsTable: 'pgmigrations',
    checkOrder: true,
    logger: { debug: () => {}, info: log, warn: log, error: log },
    log,
  });
}
