import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../helpers/testApp.js';

// A mechanical review of every SQL statement in the server: if it touches a table that belongs to a business
// (any table with a business_id column), the statement must mention business_id. That is how a forgotten
// tenant filter is caught before it ships. Statements that are fine without one are listed below WITH the reason;
// adding to that list is a security decision.

const { pool, close } = createTestApp();
afterAll(close);

const SRC = new URL('../../src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : path.endsWith('.js') ? [path] : [];
  });

/** Every string / template literal in the file that looks like an SQL statement. */
function statements(source) {
  const found = [];
  const literal = /`((?:\\.|[^`\\])*)`|'((?:\\.|[^'\\\n])*)'|"((?:\\.|[^"\\\n])*)"/g;
  // Fragments kept in a named constant (`const filter = ...`) and spliced in with ${filter} count as part of the
  // statement, so a filter built in one place and used in another is still checked as a whole.
  const named = new Map([...source.matchAll(/(?:const|let)\s+(\w+)\s*=\s*`((?:\\.|[^`\\])*)`/g)].map((m) => [m[1], m[2]]));
  for (const match of source.matchAll(literal)) {
    let text = match[1] ?? match[2] ?? match[3];
    text = text.replace(/\$\{(\w+)\}/g, (whole, name) => named.get(name) ?? whole);
    if (/^\s*(SELECT|INSERT|UPDATE|DELETE|WITH)\b/i.test(text) && /\b(FROM|INTO|UPDATE|JOIN)\b/i.test(text)) found.push(text);
  }
  return found;
}

/** Statements that legitimately do not filter by business, keyed by "file :: first words". */
const ALLOWED = [
  // Looking up a membership or an invitation by its secret token / id BEFORE a business is chosen: the token is the key.
  { file: 'middleware/businessContext.js', reason: 'loads the signed-in user’s own membership; filtered by user id, then business ids come from it' },
  { file: 'modules/auth/', reason: 'login / session / membership lookups happen before a business is active; scoped by user id or secret token' },
  { file: 'modules/invitations/', reason: 'an invitation is found by its secret token, which is what proves the right to see it' },
  { file: 'modules/users/', reason: 'member operations are scoped by membership id AND business id in the repo; user-account lookups are by email / id' },
  { file: 'middleware/authenticate.js', reason: 'session lookup by hashed token' },
  { file: 'lib/', reason: 'sequence / audit / token helpers receive the business id as a parameter or work on user-level tables' },
  { file: 'db/', reason: 'migrations and seeding' },
];
const allowed = (file) => ALLOWED.find((rule) => file.includes(rule.file));

describe('every query on tenant data is scoped to a business', () => {
  it('finds the tenant tables and some statements (so the audit cannot silently pass on nothing)', async () => {
    const { rows } = await pool.query(
      `SELECT DISTINCT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'business_id'`,
    );
    const tenantTables = rows.map((r) => r.table_name);
    expect(tenantTables).toEqual(expect.arrayContaining(['contacts', 'transactions', 'transaction_lines', 'payment_allocations', 'document_sequences']));
    const total = walk(SRC).reduce((sum, file) => sum + statements(readFileSync(file, 'utf8')).length, 0);
    expect(total).toBeGreaterThan(80);
  });

  it('no statement outside the reviewed list touches a tenant table without mentioning business_id', async () => {
    const { rows } = await pool.query(
      `SELECT DISTINCT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'business_id'`,
    );
    const tenantTables = new Set(rows.map((r) => r.table_name));
    const offenders = [];
    for (const file of walk(SRC)) {
      const rel = relative(SRC, file).replaceAll('\\', '/');
      if (allowed(rel)) continue;
      for (const sql of statements(readFileSync(file, 'utf8'))) {
        const tables = [...sql.matchAll(/\b(?:FROM|JOIN|UPDATE|INTO)\s+([a-z_]+)/gi)].map((m) => m[1].toLowerCase());
        const touched = tables.filter((t) => tenantTables.has(t));
        if (touched.length > 0 && !/business_id|\$1::uuid IS NOT DISTINCT/i.test(sql)) {
          offenders.push(`${rel}: ${touched.join(', ')} :: ${sql.replace(/\s+/g, ' ').slice(0, 110)}`);
        }
      }
    }
    expect(offenders, `queries on tenant tables without business_id:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('the reviewed exceptions all still exist (no stale entries)', () => {
    const files = walk(SRC).map((f) => relative(SRC, f).replaceAll('\\', '/'));
    for (const rule of ALLOWED) {
      expect(files.some((f) => f.includes(rule.file)), `${rule.file} is allow-listed but matches no file`).toBe(true);
    }
  });
});

describe('every foreign key from a tenant table to another tenant table includes business_id', () => {
  it('uses composite (business_id, id) references, so a row can never point into another business', async () => {
    const { rows } = await pool.query(`
      SELECT con.conname, src.relname AS source, dst.relname AS target,
             (SELECT array_agg(att.attname ORDER BY k.ord) FROM unnest(con.conkey) WITH ORDINALITY k(attnum, ord)
                JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k.attnum) AS columns
        FROM pg_constraint con
        JOIN pg_class src ON src.oid = con.conrelid
        JOIN pg_class dst ON dst.oid = con.confrelid
        JOIN pg_namespace ns ON ns.oid = src.relnamespace AND ns.nspname = 'public'
       WHERE con.contype = 'f'
         AND EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_name = src.relname AND c.column_name = 'business_id')
         AND EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_name = dst.relname AND c.column_name = 'business_id')`);
    expect(rows.length).toBeGreaterThan(5);
    const loose = rows.filter((r) => !r.columns.includes('business_id'));
    expect(loose.map((r) => `${r.source} -> ${r.target} (${r.conname})`)).toEqual([]);
  });
});
