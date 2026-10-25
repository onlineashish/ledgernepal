import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    env: { NODE_ENV: 'test' },
    include: ['tests/**/*.test.js'],
    globalSetup: ['tests/helpers/globalSetup.js'],
    // Test files run side by side. This is what keeps the suite fast: almost all of the time goes on
    // waiting for the remote database, so several files at once cost little extra CPU. Files are
    // independent because each creates and removes only its own users (see tests/helpers/api.js).
    // Rules for new tests: never assert on table-wide counts or delete other files' data.
    fileParallelism: true,
    maxWorkers: 4,
    // A test is a chain of real HTTP calls and database round trips. On a developer machine each takes well under
    // a second; from GitHub's servers to Neon each can take 2-3 s, so a test of a dozen calls needs a minute or more.
    // The limit only catches a test that hangs, so it is generous.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
