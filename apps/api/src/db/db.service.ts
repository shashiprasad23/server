import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient, QueryResultRow } from 'pg';
import { AppConfig, CONFIG } from '../config/config';

export type Db = PoolClient;

/**
 * Thin wrapper over pg. All tenant data access goes through tx(), which opens a transaction and
 * sets app.tenant_id so Postgres row-level security scopes every query to that tenant.
 */
@Injectable()
export class DbService implements OnModuleDestroy {
  readonly pool: Pool;

  constructor(@Inject(CONFIG) config: AppConfig) {
    this.pool = new Pool({ connectionString: config.DATABASE_URL, max: 20 });
  }

  async tx<T>(tenantId: string, fn: (db: Db) => Promise<T>, opts: { worker?: boolean } = {}): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id', $1, true), set_config('app.worker', $2, true)", [
        tenantId,
        opts.worker ? 'on' : 'off',
      ]);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  /** Cross-tenant scan for background workers (only tables with a worker_scan policy are visible). */
  worker<T>(fn: (db: Db) => Promise<T>): Promise<T> {
    return this.tx('', fn, { worker: true });
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}

export async function one<T extends QueryResultRow>(db: Db, sql: string, params: unknown[] = []): Promise<T | undefined> {
  const r = await db.query<T>(sql, params);
  return r.rows[0];
}

export async function many<T extends QueryResultRow>(db: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  const r = await db.query<T>(sql, params);
  return r.rows;
}
