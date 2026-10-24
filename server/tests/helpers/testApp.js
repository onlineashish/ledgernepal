import { loadConfig } from '../../src/config/index.js';
import { createLogger } from '../../src/lib/logger.js';
import { createPool } from '../../src/db/pool.js';
import { createApp } from '../../src/app.js';

/** Builds an app wired to TEST_DATABASE_URL. Call `close()` in afterAll. */
export function createTestApp() {
  const config = loadConfig();
  const logger = createLogger(config);
  const pool = createPool(config.databaseUrl);
  const app = createApp({ config, logger, pool });
  return { app, pool, config, close: () => pool.end() };
}
