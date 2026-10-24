import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config/index.js';
import { createLogger } from './lib/logger.js';
import { createPool } from './db/pool.js';
import { createApp } from './app.js';

const config = loadConfig();
const logger = createLogger(config);
const pool = createPool(config.databaseUrl);
pool.on('error', (err) => logger.error({ err }, 'Idle database client error'));

// Serve the React build when it exists (production / `npm run build`); in dev Vite serves the UI.
const clientDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
const hasClient = fs.existsSync(path.join(clientDist, 'index.html'));
if (config.isProduction && !hasClient) logger.warn('client/dist not found: run "npm run build" first');

const app = createApp({ config, logger, pool, clientDist: hasClient ? clientDist : undefined });
const server = app.listen(config.port, () => {
  logger.info(`LedgerNepal API listening on http://localhost:${config.port} (${config.env})`);
});

// Render sends SIGTERM on deploy/restart: stop accepting requests, finish in-flight ones, close the pool.
function shutdown(signal) {
  logger.info(`${signal} received, shutting down`);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
