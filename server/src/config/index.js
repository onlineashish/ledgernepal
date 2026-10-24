import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

// Load the repo-root .env for local development. On Render the variables come
// from the dashboard and no .env file exists, which dotenv silently tolerates.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
dotenv.config({ path: path.join(repoRoot, '.env'), quiet: true });

const postgresUrl = z
  .string()
  .regex(/^postgres(ql)?:\/\//, 'must be a postgres:// or postgresql:// connection string');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  APP_ORIGIN: z.url().default('http://localhost:5173'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  DATABASE_URL: postgresUrl.optional(),
  DATABASE_URL_DIRECT: postgresUrl.optional(),
  TEST_DATABASE_URL: postgresUrl.optional(),
});

/**
 * Validates environment variables and returns a frozen config object.
 * Throws (and the process exits) on misconfiguration — fail fast at startup
 * instead of failing on the first request.
 */
export function loadConfig(env = process.env) {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${problems.join('\n')}`);
  }
  const e = parsed.data;
  const isTest = e.NODE_ENV === 'test';

  // Tests wipe data, so they must never fall back to the real database.
  const databaseUrl = isTest ? e.TEST_DATABASE_URL : e.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      isTest
        ? 'TEST_DATABASE_URL is required when NODE_ENV=test (use a separate Neon branch).'
        : 'DATABASE_URL is required.',
    );
  }
  if (isTest && e.DATABASE_URL && e.TEST_DATABASE_URL === e.DATABASE_URL) {
    throw new Error('TEST_DATABASE_URL must not be the same as DATABASE_URL.');
  }

  return Object.freeze({
    env: e.NODE_ENV,
    isProduction: e.NODE_ENV === 'production',
    isTest,
    port: e.PORT,
    appOrigin: e.APP_ORIGIN,
    logLevel: e.LOG_LEVEL ?? (isTest ? 'silent' : 'info'),
    trustProxy: e.TRUST_PROXY,
    databaseUrl,
    // Migrations need a direct (non-pooler) connection; fall back to the main URL.
    migrationDatabaseUrl: isTest ? e.TEST_DATABASE_URL : (e.DATABASE_URL_DIRECT ?? e.DATABASE_URL),
  });
}
