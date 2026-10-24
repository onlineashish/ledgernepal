import { Writable } from 'node:stream';
import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { loadConfig } from '../../src/config/index.js';
import { createLogger } from '../../src/lib/logger.js';
import { createPool } from '../../src/db/pool.js';
import { createApp } from '../../src/app.js';

const lines = [];
const sink = new Writable({
  write(chunk, _enc, done) {
    lines.push(chunk.toString());
    done();
  },
});
const config = { ...loadConfig(), logLevel: 'info' };
const pool = createPool(config.databaseUrl);
const app = createApp({ config, logger: createLogger(config, sink), pool });
afterAll(() => pool.end());

const logged = () => lines.join('\n');

describe('request logging keeps secrets out', () => {
  it('never logs query strings (invitation tokens, search text)', async () => {
    const secret = 'INVITE-TOKEN-should-never-be-logged';
    await request(app).get(`/api/health?token=${secret}&q=Ram%20Bahadur`);
    await request(app).get(`/accept-invite?token=${secret}`); // the SPA page request; no client build here, still logged
    expect(logged()).toContain('/api/health');
    expect(logged()).not.toContain(secret);
    expect(logged()).not.toContain('Ram');
    expect(logged()).not.toMatch(/"query"/);
  });

  it('redacts cookies, CSRF tokens and the referrer', async () => {
    await request(app)
      .get('/api/health')
      .set('Cookie', 'ln_session=SESSION-SECRET-VALUE')
      .set('X-CSRF-Token', 'CSRF-SECRET-VALUE')
      .set('Referer', 'https://example.com/accept-invite?token=REFERER-SECRET');
    expect(logged()).not.toContain('SESSION-SECRET-VALUE');
    expect(logged()).not.toContain('CSRF-SECRET-VALUE');
    expect(logged()).not.toContain('REFERER-SECRET');
  });

  it('does not log request bodies, so passwords never reach the logs', async () => {
    await request(app).post('/api/auth/login').send({ email: 'nobody-logging@api-test.example', password: 'PASSWORD-SECRET-VALUE' });
    expect(logged()).not.toContain('PASSWORD-SECRET-VALUE');
  });
});
