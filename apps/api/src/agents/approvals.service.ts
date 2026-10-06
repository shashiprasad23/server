import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { Db, DbService, many, one } from '../db/db.service';
import { EventBus } from '../events/event-bus';
import { Principal } from '../common/principal';
import { conflict, forbidden, notFound } from '../common/errors';
import { validate } from '../common/validate';
import { AgentRuntime } from './agent-runtime.service';

export interface ApprovalRow {
  id: string;
  agent_action_id: string;
  status: string;
  assignee_role: string;
  summary: string;
  expires_at: Date;
  created_at: Date;
  agent_id?: string;
  action_type?: string;
  payload?: Record<string, unknown>;
  confidence?: string;
  evidence?: unknown[];
  reason?: string;
  target_object?: string;
  target_id?: string;
}

const decisionInput = z.object({
  note: z.string().max(2000).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});

/** FR-AI-04: one queue for every action waiting on a person. Items expire; they never auto-approve. */
@Injectable()
export class ApprovalsService {
  constructor(
    private readonly dbs: DbService,
    private readonly runtime: AgentRuntime,
    private readonly events: EventBus,
  ) {}

  async list(db: Db, p: Principal, status = 'pending'): Promise<ApprovalRow[]> {
    const rows = await many<ApprovalRow>(
      db,
      `SELECT ap.id, ap.agent_action_id, ap.status, ap.assignee_role, ap.summary, ap.expires_at, ap.created_at,
              aa.agent_id, aa.action_type, aa.payload, aa.confidence, aa.evidence, aa.reason, aa.target_object, aa.target_id
         FROM approvals ap JOIN agent_actions aa ON aa.id = ap.agent_action_id
        WHERE ap.status = $1 ORDER BY ap.created_at DESC LIMIT 200`,
      [status],
    );
    return rows.filter((r) => this.runtime.canReview(p, r.assignee_role));
  }

  private async load(db: Db, p: Principal, id: string): Promise<ApprovalRow> {
    const ap = await one<ApprovalRow>(db, 'SELECT * FROM approvals WHERE id = $1 FOR UPDATE', [id]);
    if (!ap) throw notFound('Approval');
    if (!this.runtime.canReview(p, ap.assignee_role)) throw forbidden('not_reviewer', `Needs role ${ap.assignee_role}`);
    if (ap.status !== 'pending') throw conflict('already_decided', `Approval is ${ap.status}`);
    if (ap.expires_at.getTime() < Date.now()) throw conflict('expired', 'Approval has expired');
    return ap;
  }

  async approve(db: Db, p: Principal, id: string, body: unknown) {
    const input = validate(decisionInput, body ?? {});
    const ap = await this.load(db, p, id);
    const writes = await this.runtime.executeApproved(db, p, ap.agent_action_id, input.payload);
    await db.query("UPDATE approvals SET status = 'approved', decided_by = $2, decided_at = now(), decision_note = $3 WHERE id = $1", [
      id,
      p.kind === 'user' ? p.actorId : null,
      input.note ?? null,
    ]);
    await this.events.publish(db, p.tenantId, 'approvals.approved', { id, actionId: ap.agent_action_id, by: p.actorId, edited: !!input.payload });
    return { id, status: 'approved', writes };
  }

  async reject(db: Db, p: Principal, id: string, body: unknown) {
    const input = validate(decisionInput, body ?? {});
    const ap = await this.load(db, p, id);
    await db.query("UPDATE approvals SET status = 'rejected', decided_by = $2, decided_at = now(), decision_note = $3 WHERE id = $1", [
      id,
      p.kind === 'user' ? p.actorId : null,
      input.note ?? null,
    ]);
    await db.query("UPDATE agent_actions SET decision = 'rejected', reason = coalesce(reason,'') || $2 WHERE id = $1", [
      ap.agent_action_id,
      ` | rejected: ${input.note ?? 'no reason given'}`,
    ]);
    await this.events.publish(db, p.tenantId, 'approvals.rejected', { id, actionId: ap.agent_action_id, by: p.actorId, note: input.note ?? null });
    return { id, status: 'rejected' };
  }

  /** Worker: expire overdue approvals across tenants. */
  async expireOverdue(): Promise<number> {
    const expired = await this.dbs.worker((db) =>
      many<{ tenant_id: string; agent_action_id: string }>(
        db,
        "UPDATE approvals SET status = 'expired' WHERE status = 'pending' AND expires_at < now() RETURNING tenant_id, agent_action_id",
      ),
    );
    // agent_actions is tenant-scoped only, so close each action inside its own tenant context.
    for (const e of expired) {
      await this.dbs.tx(e.tenant_id, (db) =>
        db.query("UPDATE agent_actions SET decision = 'expired' WHERE id = $1 AND decision = 'queued'", [e.agent_action_id]),
      );
    }
    return expired.length;
  }
}
