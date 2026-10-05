import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { Client } from 'pg';
import { loadConfig, loadDotEnv } from '../config/config';

/** Applies migrations/*.sql in order as the owner role, then grants the runtime role DML access. */
export async function migrate(connectionString: string, appRole: string, log = console.log): Promise<void> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const dir = join(__dirname, '..', '..', 'migrations');
    const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    const done = new Set((await client.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    for (const file of files) {
      if (done.has(file)) continue;
      log(`applying ${file}`);
      await client.query('BEGIN');
      try {
        await client.query(readFileSync(join(dir, file), 'utf8'));
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
    const role = client.escapeIdentifier(appRole);
    await client.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
    await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`);
    await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`);
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  loadDotEnv();
  const config = loadConfig();
  migrate(config.MIGRATION_DATABASE_URL, config.APP_DB_ROLE)
    .then(() => console.log('migrations complete'))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
