// Usage: npm run docs — rewrites docs/api.md and docs/rbac.md from the code.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config/index.js';
import { createLogger } from '../src/lib/logger.js';
import { createMailer } from '../src/lib/mailer.js';
import { createPool } from '../src/db/pool.js';
import { createApp } from '../src/app.js';
import { renderApiDoc, renderRbacDoc } from '../src/lib/docs.js';

const config = loadConfig();
const pool = createPool(config.databaseUrl); // building the app does not connect; nothing is queried
const app = createApp({ config, logger: createLogger(config), pool, mailer: createMailer(config.mail) });
const docs = new URL('../../docs/', import.meta.url);

writeFileSync(fileURLToPath(new URL('api.md', docs)), renderApiDoc(app));
writeFileSync(fileURLToPath(new URL('rbac.md', docs)), renderRbacDoc());
console.log('Wrote docs/api.md and docs/rbac.md');
await app.locals.background.idle();
await pool.end();
