import { Injectable, Logger } from '@nestjs/common';
import { Db, DbService, many } from '../db/db.service';

export interface DomainEvent<T = Record<string, unknown>> {
  id: number;
  tenantId: string;
  type: string;
  payload: T;
}

type Handler = (event: DomainEvent) => Promise<void>;

/**
 * Transactional outbox + in-process dispatch. publish() writes the event inside the caller's
 * transaction, so an event exists only if the change committed. drain() delivers pending events
 * to subscribers; in production this is where a Kafka / Event Hubs relay plugs in (tech spec 6.1).
 */
@Injectable()
export class EventBus {
  private readonly log = new Logger('EventBus');
  private readonly handlers = new Map<string, { name: string; fn: Handler }[]>();
  private draining = false;

  constructor(private readonly db: DbService) {}

  async publish(db: Db, tenantId: string, type: string, payload: Record<string, unknown>): Promise<void> {
    await db.query('INSERT INTO outbox (tenant_id, type, payload) VALUES ($1, $2, $3)', [tenantId, type, payload]);
  }

  subscribe(type: string, name: string, fn: Handler): void {
    const list = this.handlers.get(type) ?? [];
    list.push({ name, fn });
    this.handlers.set(type, list);
  }

  /** Dispatches pending events until the outbox is empty (or maxRounds is hit). Returns events handled. */
  async drain(maxRounds = 20): Promise<number> {
    if (this.draining) return 0;
    this.draining = true;
    let handled = 0;
    const failed: string[] = [];
    try {
      for (let round = 0; round < maxRounds; round++) {
        const batch = await this.db.worker((db) =>
          many<{ id: string; tenant_id: string; type: string; payload: Record<string, unknown> }>(
            db,
            `SELECT id, tenant_id, type, payload FROM outbox
              WHERE dispatched_at IS NULL AND attempts < 5 AND NOT (id::text = ANY($1::text[])) ORDER BY id LIMIT 100`,
            [failed],
          ),
        );
        if (!batch.length) break;
        for (const row of batch) {
          const event: DomainEvent = { id: Number(row.id), tenantId: row.tenant_id, type: row.type, payload: row.payload };
          let error: string | null = null;
          for (const h of this.handlers.get(row.type) ?? []) {
            try {
              await h.fn(event);
            } catch (err) {
              error = `${h.name}: ${err instanceof Error ? err.message : String(err)}`;
              this.log.error(`handler ${h.name} failed on ${row.type}#${row.id}: ${error}`);
            }
          }
          await this.db.worker((db) =>
            db.query(
              error
                ? 'UPDATE outbox SET attempts = attempts + 1, last_error = $2 WHERE id = $1'
                : 'UPDATE outbox SET dispatched_at = now(), attempts = attempts + 1 WHERE id = $1',
              error ? [row.id, error] : [row.id],
            ),
          );
          if (error) failed.push(String(row.id));
          handled++;
        }
      }
    } finally {
      this.draining = false;
    }
    return handled;
  }
}
