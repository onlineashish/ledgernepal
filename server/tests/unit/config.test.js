import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/index.js';

const DB = 'postgresql://u:p@host/main';
const TEST_DB = 'postgresql://u:p@test-host/main';

describe('loadConfig', () => {
  it('uses DATABASE_URL outside of tests and applies defaults', () => {
    const config = loadConfig({ NODE_ENV: 'development', DATABASE_URL: DB });
    expect(config.databaseUrl).toBe(DB);
    expect(config.port).toBe(4000);
    expect(config.appOrigin).toBe('http://localhost:5173');
    expect(config.isProduction).toBe(false);
  });

  it('uses TEST_DATABASE_URL in tests, never DATABASE_URL', () => {
    const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: DB, TEST_DATABASE_URL: TEST_DB });
    expect(config.databaseUrl).toBe(TEST_DB);
    expect(config.migrationDatabaseUrl).toBe(TEST_DB);
  });

  it('refuses to run tests without TEST_DATABASE_URL', () => {
    expect(() => loadConfig({ NODE_ENV: 'test', DATABASE_URL: DB })).toThrow(/TEST_DATABASE_URL is required/);
  });

  it('refuses to run tests against the main database', () => {
    expect(() => loadConfig({ NODE_ENV: 'test', DATABASE_URL: DB, TEST_DATABASE_URL: DB })).toThrow(
      /must not be the same/,
    );
  });

  it('requires DATABASE_URL outside of tests', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/DATABASE_URL is required/);
  });

  it('rejects invalid values with a readable message', () => {
    expect(() => loadConfig({ NODE_ENV: 'staging', DATABASE_URL: DB })).toThrow(/NODE_ENV/);
    expect(() => loadConfig({ DATABASE_URL: 'mysql://x' })).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({ DATABASE_URL: DB, PORT: 'abc' })).toThrow(/PORT/);
  });

  it('prefers the direct URL for migrations outside of tests', () => {
    const direct = 'postgresql://u:p@direct-host/main';
    const config = loadConfig({ DATABASE_URL: DB, DATABASE_URL_DIRECT: direct });
    expect(config.migrationDatabaseUrl).toBe(direct);
  });
});
