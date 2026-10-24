import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

// Load the repo-root .env for local development. On Render the variables come
// from the dashboard and no .env file exists, which dotenv silently tolerates.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
dotenv.config({ path: path.join(repoRoot, '.env'), quiet: true });

const DAY_MS = 24 * 60 * 60 * 1000;

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
  // Email is optional. Without it, "forgot password" cannot send mail (owner-assisted reset still works).
  MAIL_PROVIDER: z.enum(['console', 'memory', 'brevo', 'none']).optional(),
  BREVO_API_KEY: z.string().min(10, 'looks too short to be an API key').optional(),
  MAIL_FROM_EMAIL: z.email().optional(),
  MAIL_FROM_NAME: z.string().trim().min(1).max(80).default('LedgerNepal'),
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

  // Tests always use the in-memory mailbox, whatever .env says: a test run must never send real mail.
  // The console provider prints reset links, so it is not allowed where logs are shared (production).
  const mailProvider = isTest ? 'memory' : (e.MAIL_PROVIDER ?? (e.NODE_ENV === 'production' ? 'none' : 'console'));
  if (e.NODE_ENV === 'production' && ['console', 'memory'].includes(mailProvider)) {
    throw new Error(`MAIL_PROVIDER=${mailProvider} is not allowed in production (it would put reset links in the logs). Use "brevo" or leave it unset.`);
  }
  if (mailProvider === 'brevo' && (!e.BREVO_API_KEY || !e.MAIL_FROM_EMAIL)) {
    throw new Error('MAIL_PROVIDER=brevo needs BREVO_API_KEY and MAIL_FROM_EMAIL (a sender address verified in Brevo).');
  }

  return Object.freeze({
    env: e.NODE_ENV,
    mail: Object.freeze({
      provider: mailProvider,
      brevoApiKey: e.BREVO_API_KEY,
      fromEmail: e.MAIL_FROM_EMAIL,
      fromName: e.MAIL_FROM_NAME,
    }),
    isProduction: e.NODE_ENV === 'production',
    isTest,
    port: e.PORT,
    appOrigin: e.APP_ORIGIN,
    logLevel: e.LOG_LEVEL ?? (isTest ? 'silent' : 'info'),
    trustProxy: e.TRUST_PROXY,
    session: Object.freeze({
      cookieName: 'ln_session',
      idleMs: 7 * DAY_MS, // sliding: unused sessions expire after 7 days
      absoluteMs: 30 * DAY_MS, // hard limit: log in again after 30 days
    }),
    auth: Object.freeze({
      maxFailedLogins: 10, // then the account is locked for lockMs
      lockMs: 15 * 60_000,
    }),
    // In-memory counters (fine for one Render instance). Tests get effectively unlimited limits;
    // the rate-limit tests pass their own small ones.
    rateLimit: Object.freeze(
      isTest
        ? { loginWindowMs: 60_000, loginMax: 100_000, loginIpWindowMs: 900_000, loginIpMax: 100_000, registerWindowMs: 3_600_000, registerMax: 100_000, invitationWindowMs: 900_000, invitationMax: 100_000, passwordForgotWindowMs: 3_600_000, passwordForgotMax: 100_000, passwordForgotIpMax: 100_000, passwordResetWindowMs: 900_000, passwordResetMax: 100_000, apiWindowMs: 60_000, apiMax: 100_000 }
        : { loginWindowMs: 60_000, loginMax: 5, loginIpWindowMs: 900_000, loginIpMax: 30, registerWindowMs: 3_600_000, registerMax: 10, invitationWindowMs: 900_000, invitationMax: 20, passwordForgotWindowMs: 3_600_000, passwordForgotMax: 3, passwordForgotIpMax: 20, passwordResetWindowMs: 900_000, passwordResetMax: 10, apiWindowMs: 60_000, apiMax: 300 },
    ),
    databaseUrl,
    // Migrations need a direct (non-pooler) connection; fall back to the main URL.
    migrationDatabaseUrl: isTest ? e.TEST_DATABASE_URL : (e.DATABASE_URL_DIRECT ?? e.DATABASE_URL),
  });
}
