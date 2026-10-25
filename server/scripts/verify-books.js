// Usage:  npm run db:verify              checks the database in DATABASE_URL_DIRECT (or DATABASE_URL)
//         npm run db:verify -- <url>     checks any database, e.g. a freshly restored copy
//
// Read-only. Checks the rules the books depend on across EVERY business and prints a short summary, so after a
// restore (or any time you are unsure) you can confirm the data is whole. Exit code 1 means a rule is broken.
import pg from 'pg';
import { loadConfig } from '../src/config/index.js';

const config = loadConfig(); // also reads .env
const url = process.argv[2] ?? process.env.DATABASE_URL_DIRECT ?? config.databaseUrl;
const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 15_000 });

const CHECKS = [
  ['an invoice or bill is paid more than its total', `SELECT i.id FROM transactions i JOIN payment_allocations a ON a.invoice_txn_id = i.id AND a.status = 'active' GROUP BY i.id, i.total HAVING SUM(a.amount) > i.total`],
  ['a receipt or payment is applied for more than its amount', `SELECT p.id FROM transactions p JOIN payment_allocations a ON a.payment_txn_id = p.id AND a.status = 'active' GROUP BY p.id, p.total HAVING SUM(a.amount) > p.total`],
  ['an allocation is live although its invoice or payment is not posted', `SELECT a.id FROM payment_allocations a JOIN transactions t ON t.id IN (a.payment_txn_id, a.invoice_txn_id) WHERE a.status = 'active' AND t.status <> 'posted'`],
  ['an allocation joins two different contacts', `SELECT a.id FROM payment_allocations a JOIN transactions p ON p.id = a.payment_txn_id JOIN transactions i ON i.id = a.invoice_txn_id WHERE p.contact_id <> i.contact_id`],
  ['an allocation joins two different businesses', `SELECT a.id FROM payment_allocations a JOIN transactions p ON p.id = a.payment_txn_id JOIN transactions i ON i.id = a.invoice_txn_id WHERE a.business_id <> p.business_id OR a.business_id <> i.business_id`],
  ['two transactions share a reference number', `SELECT business_id, reference_no FROM transactions WHERE reference_no IS NOT NULL GROUP BY business_id, reference_no HAVING count(*) > 1`],
  ['a posted transaction has no reference number', `SELECT id FROM transactions WHERE status = 'posted' AND reference_no IS NULL`],
  ['a voided transaction has no reason or time', `SELECT id FROM transactions WHERE status = 'voided' AND (void_reason IS NULL OR voided_at IS NULL)`],
  ['an invoice total differs from the sum of its lines', `SELECT t.id FROM transactions t JOIN transaction_lines l ON l.transaction_id = t.id GROUP BY t.id, t.total HAVING SUM(l.line_total) <> t.total`],
  ['a transaction belongs to a contact of another business', `SELECT t.id FROM transactions t JOIN contacts c ON c.id = t.contact_id WHERE c.business_id <> t.business_id`],
];

try {
  await client.connect();
  const { rows: db } = await client.query('SELECT current_database() AS name');
  console.log(`Checking database "${db[0].name}"\n`);

  let broken = 0;
  for (const [label, sql] of CHECKS) {
    const { rowCount } = await client.query(sql);
    console.log(`${rowCount === 0 ? '✓' : '✗'} ${rowCount === 0 ? 'ok' : `${rowCount} found`}: no case where ${label}`);
    if (rowCount > 0) broken += 1;
  }

  const { rows } = await client.query(`
    SELECT b.name, b.id,
           (SELECT count(*) FROM contacts c WHERE c.business_id = b.id)::int AS contacts,
           (SELECT count(*) FROM transactions t WHERE t.business_id = b.id AND t.status = 'posted')::int AS posted,
           (SELECT count(*) FROM transactions t WHERE t.business_id = b.id AND t.status = 'voided')::int AS voided,
           (SELECT COALESCE(SUM(CASE t.effect WHEN 'debit' THEN t.total ELSE -t.total END), 0) FROM transactions t WHERE t.business_id = b.id AND t.status = 'posted')::numeric(16, 2) AS net
      FROM businesses b ORDER BY b.name`);
  const audit = await client.query('SELECT count(*)::int AS n FROM audit_logs');
  console.log(`\n${rows.length} business(es), ${audit.rows[0].n} audit entries`);
  for (const r of rows) console.log(`  ${r.name}: ${r.contacts} contacts, ${r.posted} posted, ${r.voided} voided, net balance ${r.net}`);

  console.log(broken === 0 ? '\nAll checks passed.' : `\n${broken} check(s) failed. Do not rely on this data until they are explained.`);
  process.exitCode = broken === 0 ? 0 : 1;
} catch (err) {
  console.error(`Could not check the database: ${err.message}`);
  process.exitCode = 2;
} finally {
  await client.end().catch(() => {});
}
