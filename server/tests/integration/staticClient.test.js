import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { loadConfig } from '../../src/config/index.js';
import { createLogger } from '../../src/lib/logger.js';
import { createPool } from '../../src/db/pool.js';
import { createApp } from '../../src/app.js';

let dist;
let pool;
let app;
let appWithoutClient;

beforeAll(() => {
  dist = fs.mkdtempSync(path.join(os.tmpdir(), 'ln-dist-'));
  fs.mkdirSync(path.join(dist, 'assets'));
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>LedgerNepal</title><div id="root"></div>');
  fs.writeFileSync(path.join(dist, 'assets', 'app-abc123.js'), 'console.log("bundle")');

  const config = loadConfig();
  const logger = createLogger(config);
  pool = createPool(config.databaseUrl);
  app = createApp({ config, logger, pool, clientDist: dist });
  appWithoutClient = createApp({ config, logger, pool });
});

afterAll(async () => {
  fs.rmSync(dist, { recursive: true, force: true });
  await pool.end();
});

describe('serving the React build', () => {
  it('serves index.html at the root', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<div id="root">');
    expect(res.headers['cache-control']).toBe('no-cache');
  });

  it('falls back to index.html for client-side routes so refresh works', async () => {
    const res = await request(app).get('/contacts/new');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<div id="root">');
  });

  it('serves built assets with caching', async () => {
    const res = await request(app).get('/assets/app-abc123.js');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/javascript/);
    expect(res.headers['cache-control']).toMatch(/max-age=3600/);
  });

  it('still returns JSON 404 for unknown API routes (never the HTML page)', async () => {
    for (const url of ['/api/nope', '/api']) {
      const res = await request(app).get(url);
      expect(res.status).toBe(404);
      expect(res.headers['content-type']).toMatch(/json/);
      expect(res.body.error.code).toBe('NOT_FOUND');
    }
  });

  it('keeps API routes working', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('ok');
  });

  it('does not serve files outside the build directory', async () => {
    const res = await request(app).get('/..%2f..%2fetc/passwd');
    expect(res.text).not.toMatch(/root:/);
  });

  it('serves nothing at / when no client build is configured', async () => {
    const res = await request(appWithoutClient).get('/');
    expect(res.status).toBe(404);
  });
});
