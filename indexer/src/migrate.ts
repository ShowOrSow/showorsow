// Tiny migration runner: applies migrations/*.sql in lexical order, tracked in a
// _migrations table so re-runs are idempotent. Each file runs in its own transaction.
//
//   node --experimental-strip-types src/migrate.ts   (or: pnpm migrate)

import { readFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makePool } from './db.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', 'migrations');

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('missing required env: DATABASE_URL');
  const pool = makePool(url);
  try {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS _migrations (
         name text PRIMARY KEY,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`,
    );
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
    const applied = new Set(
      (await pool.query<{ name: string }>('SELECT name FROM _migrations')).rows.map((r) => r.name),
    );
    for (const file of files) {
      if (applied.has(file)) {
        console.log(`skip   ${file} (already applied)`);
        continue;
      }
      const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`apply  ${file}`);
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw new Error(`migration ${file} failed: ${(e as Error).message}`);
      } finally {
        client.release();
      }
    }
    console.log('migrations up to date');
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
