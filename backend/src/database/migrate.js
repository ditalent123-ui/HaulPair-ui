import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';

/**
 * Minimal forward-only SQL migration runner.
 *
 * - Applies database/migrations/NNN_name.sql in lexical order.
 * - Each file runs inside its own transaction and is recorded in schema_migrations.
 * - A transaction-scoped advisory lock prevents two processes migrating at once.
 * - Checksums detect edits to migrations that were already applied.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = path.resolve(here, '../../../database/migrations');
const LOCK_KEY = 72_150_001; // arbitrary constant for pg_advisory_xact_lock

async function sha256(text) {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(text).digest('hex');
}

export async function listMigrationFiles(dir = MIGRATIONS_DIR) {
  const entries = await fs.readdir(dir);
  return entries.filter((f) => /^\d{3}_[a-z0-9_]+\.sql$/.test(f)).sort();
}

export async function migrate(client, { dir = MIGRATIONS_DIR, log = console.log } = {}) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     TEXT PRIMARY KEY,
      checksum    TEXT NOT NULL,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);

  const files = await listMigrationFiles(dir);
  const applied = [];

  for (const file of files) {
    const sql = await fs.readFile(path.join(dir, file), 'utf8');
    const checksum = await sha256(sql);

    await client.query('BEGIN');
    try {
      await client.query('SELECT pg_advisory_xact_lock($1)', [LOCK_KEY]);
      const { rows } = await client.query('SELECT checksum FROM schema_migrations WHERE version = $1', [file]);
      if (rows.length > 0) {
        await client.query('COMMIT');
        if (rows[0].checksum !== checksum) {
          throw new Error(
            `Migration ${file} was modified after it was applied. Create a new migration instead of editing an applied one.`,
          );
        }
        continue;
      }
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)', [file, checksum]);
      await client.query('COMMIT');
      applied.push(file);
      log(`applied ${file}`);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    }
  }
  return applied;
}

// CLI entry point: `npm run db:migrate`
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { default: dotenv } = await import('dotenv');
  dotenv.config({ quiet: true });
  const url = process.argv.includes('--test') ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL;
  if (!url) {
    console.error(
      process.argv.includes('--test') ? 'TEST_DATABASE_URL is not set.' : 'DATABASE_URL is not set. Copy .env.example to .env.',
    );
    process.exit(1);
  }
  const client = new pg.Client({
    connectionString: url,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
  });
  try {
    await client.connect();
    const applied = await migrate(client);
    console.log(applied.length ? `Done: ${applied.length} migration(s) applied.` : 'Database schema is up to date.');
  } catch (err) {
    console.error(`Migration failed: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
}
