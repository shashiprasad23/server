import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppConfig, CONFIG } from '../config/config';
import { Db, DbService, many, one } from '../db/db.service';
import { MAIL_SENDER, MailSender } from './mail-sender';

export interface ScheduleInput {
  tenantId: string;
  to: string;
  from?: string | null;
  subject?: string | null;
  body: string;
  agentActionId?: string | null;
  related?: { object: string; id: string } | null;
}

/**
 * Outbound queue with an undo window: messages wait OUTBOUND_UNDO_WINDOW_SECONDS before delivery so a
 * rollback can still recall them (compensable actions, FR-AI-06).
 */
@Injectable()
export class OutboundService {
  private readonly log = new Logger('OutboundService');

  constructor(
    private readonly dbs: DbService,
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(MAIL_SENDER) private readonly sender: MailSender,
  ) {}

  async schedule(db: Db, input: ScheduleInput): Promise<{ id: string; send_after: string }> {
    const row = await one<{ id: string; send_after: Date }>(
      db,
      `INSERT INTO outbound_messages (tenant_id, channel, from_mailbox, to_address, subject, body, send_after, agent_action_id, related_object, related_id)
       VALUES ($1,'email',$2,$3,$4,$5, now() + make_interval(secs => $6), $7, $8, $9) RETURNING id, send_after`,
      [
        input.tenantId,
        input.from ?? null,
        input.to,
        input.subject ?? null,
        input.body,
        this.config.OUTBOUND_UNDO_WINDOW_SECONDS,
        input.agentActionId ?? null,
        input.related?.object ?? null,
        input.related?.id ?? null,
      ],
    );
    return { id: row!.id, send_after: row!.send_after.toISOString() };
  }

  /** Returns true if the message was still in its undo window and is now recalled. */
  async recall(db: Db, id: string): Promise<boolean> {
    const r = await db.query("UPDATE outbound_messages SET status = 'recalled' WHERE id = $1 AND status = 'scheduled'", [id]);
    return (r.rowCount ?? 0) > 0;
  }

  /** Delivers due messages; run by the worker loop. */
  async flushDue(now?: Date): Promise<number> {
    const due = await this.dbs.worker((db) =>
      many<{ id: string; tenant_id: string; from_mailbox: string | null; to_address: string; subject: string | null; body: string }>(
        db,
        `SELECT id, tenant_id, from_mailbox, to_address, subject, body FROM outbound_messages
          WHERE status = 'scheduled' AND send_after <= $1 ORDER BY send_after LIMIT 50`,
        [now ?? new Date()],
      ),
    );
    let sent = 0;
    for (const m of due) {
      try {
        await this.sender.send({ id: m.id, from: m.from_mailbox, to: m.to_address, subject: m.subject, body: m.body });
        await this.dbs.worker((db) => db.query("UPDATE outbound_messages SET status = 'sent', sent_at = now() WHERE id = $1 AND status = 'scheduled'", [m.id]));
        sent++;
      } catch (err) {
        this.log.error(`send ${m.id} failed: ${err instanceof Error ? err.message : err}`);
        await this.dbs.worker((db) => db.query("UPDATE outbound_messages SET status = 'failed' WHERE id = $1", [m.id]));
      }
    }
    return sent;
  }
}
