import { loadConfig } from '../../src/config/index.js';
import { createLogger } from '../../src/lib/logger.js';
import { createMailer } from '../../src/lib/mailer.js';
import { createPool } from '../../src/db/pool.js';
import { createApp } from '../../src/app.js';

/**
 * Builds an app wired to TEST_DATABASE_URL. Call `close()` in afterAll.
 * `configOverrides` is shallow-merged over the loaded config; `rateLimit` overrides limiter settings.
 */
export function createTestApp({ configOverrides = {}, rateLimit } = {}) {
  const config = { ...loadConfig(), ...configOverrides };
  const logger = createLogger(config);
  const pool = createPool(config.databaseUrl);
  const mailer = createMailer(config.mail);
  const app = createApp({ config, logger, pool, rateLimit, mailer });
  return {
    app,
    pool,
    config,
    mailer, // the in-memory mailbox: mailer.to('x@y.example'), mailer.outbox
    settle: () => app.locals.background.idle(), // wait for emails sent after the response
    close: async () => {
      await app.locals.background.idle();
      await pool.end();
    },
  };
}
