import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { renderApiDoc, renderRbacDoc } from '../../src/lib/docs.js';
import { createTestApp } from '../helpers/testApp.js';

// docs/api.md and docs/rbac.md are generated from the real routes and the real permission matrix.
// If this fails, a route or permission changed: run `npm run docs` and commit the result.

const { app, close } = createTestApp();
afterAll(close);

const read = (name) => readFileSync(new URL(`../../../docs/${name}`, import.meta.url), 'utf8');

describe('generated documentation', () => {
  it('docs/api.md lists every route with the permission it needs', () => {
    expect(read('api.md')).toBe(renderApiDoc(app));
  });

  it('docs/rbac.md matches the permission matrix', () => {
    expect(read('rbac.md')).toBe(renderRbacDoc());
  });

  it('the API list carries the permissions (so the document is worth reading)', () => {
    const api = renderApiDoc(app);
    expect(api).toMatch(/\| POST \| `\/api\/receipts\/:id\/void` \| `receipts.void` \|/);
    expect(api).toMatch(/\| GET \| `\/api\/reports\/outstanding` \| `reports.view` \+ `ledger.view` \|/);
    expect(api).toMatch(/\| POST \| `\/api\/auth\/login` \| Public \|/);
  });
});
