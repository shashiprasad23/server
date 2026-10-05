import { randomUUID } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { Db, DbService, many, one } from '../db/db.service';
import { EventBus } from '../events/event-bus';
import { MetadataService } from '../metadata/metadata.service';
import { RecordsService } from '../records/records.service';
import { OutboundService } from '../outbound/outbound.service';
import { Principal, hasRole, systemPrincipal } from '../common/principal';
import { badRequest, conflict, forbidden, notFound } from '../common/errors';
import { ObjectName } from '../records/record-types';
import { AGENTS, AgentDefinition, AgentOverrides, agentDefinition } from './agent-definitions';
import { AgentState, PolicyDecision, ProposedAction, evaluatePolicy } from './policy-engine';

/** One reversible effect of an executed action, stored on agent_actions.writes for rollback. */
export type ActionWrite =
  | { kind: 'field'; object: ObjectName; id: string; field: string; old: unknown; new: unknown }
  | { kind: 'create'; object: ObjectName; id: string }
  | { kind: 'task'; id: string }
  | { kind: 'outbound'; id: string };

export interface AgentActionRow {
  id: string;
  agent_id: string;
  run_id: string;
  action_type: string;
  reversibility: string;
  target_object: string | null;
  target_id: string | null;
  payload: Record<string, unknown>;
  confidence: string | null;
  evidence: unknown[];
  decision: string;
  reason: string | null;
  writes: ActionWrite[];
  model: string | null;
  prompt_version: string | null;
  created_at: Date;
  executed_at: Date | null;
  rolled_back_at: Date | null;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export const agentPrincipal = (tenantId: string, agentId: string): Principal => ({
  tenantId,
  kind: 'agent',
  actorId: agentId,
  roles: ['agent'],
});

/**
 * Runs every agent action through the policy engine, records the full audit trail (inputs,
 * evidence, model, prompt version, decision, writes), executes or queues it, and can roll it back.
 */
@Injectable()
export class AgentRuntime {
  private readonly log = new Logger('AgentRuntime');

  constructor(
    private readonly dbs: DbService,
    private readonly records: RecordsService,
    private readonly outbound: OutboundService,
    private readonly metadata: MetadataService,
    private readonly events: EventBus,
  ) {}

  definitions(): AgentDefinition[] {
    return AGENTS;
  }

  async state(db: Db, agentId: string): Promise<AgentState> {
    const s = await one<{ enabled: boolean; killed: boolean; overrides: AgentOverrides }>(
      db,
      'SELECT enabled, killed, overrides FROM agent_settings WHERE agent_id = $1',
      [agentId],
    );
    const today = await one<{ n: string }>(
      db,
      "SELECT count(*) AS n FROM agent_actions WHERE agent_id = $1 AND decision = 'executed' AND created_at >= date_trunc('day', now())",
      [agentId],
    );
    return { enabled: s?.enabled ?? true, killed: s?.killed ?? false, overrides: s?.overrides ?? {}, actionsToday: Number(today?.n ?? 0) };
  }

  newRun(): string {
    return randomUUID();
  }

  /** Propose an action inside the caller's transaction. Returns the stored action and decision. */
  async propose(db: Db, tenantId: string, agentId: string, runId: string, action: ProposedAction): Promise<{ id: string; decision: PolicyDecision }> {
    const def = agentDefinition(agentId);
    if (!def) throw notFound(`Agent "${agentId}"`);
    const decision = evaluatePolicy(def, await this.state(db, agentId), action);
    const stored = decision.decision === 'execute' ? 'executed' : decision.decision === 'queue' ? 'queued' : 'blocked';

    const row = await one<{ id: string }>(
      db,
      `INSERT INTO agent_actions (tenant_id, agent_id, run_id, action_type, reversibility, target_object, target_id, payload,
                                  confidence, evidence, prompt_version, model, decision, reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
      [
        tenantId,
        agentId,
        runId,
        action.type,
        decision.reversibility,
        action.target?.object ?? null,
        action.target?.id ?? null,
        JSON.stringify({ ...action.payload, summary: action.summary }),
        action.confidence,
        JSON.stringify(action.evidence ?? []),
        action.promptVersion ?? null,
        action.model ?? null,
        stored,
        decision.reason,
      ],
    );
    const actionId = row!.id;

    if (decision.decision === 'execute') {
      const writes = await this.execute(db, tenantId, agentId, actionId, action);
      await db.query('UPDATE agent_actions SET writes = $2, executed_at = now() WHERE id = $1', [actionId, JSON.stringify(writes)]);
    } else if (decision.decision === 'queue') {
      const ttl = (await this.metadata.setting(db, 'agents.defaults')).approval_ttl_hours;
      const approval = await one<{ id: string }>(
        db,
        `INSERT INTO approvals (tenant_id, agent_action_id, assignee_role, summary, expires_at)
         VALUES ($1,$2,$3,$4, now() + make_interval(hours => $5)) RETURNING id`,
        [tenantId, actionId, decision.reviewerRole, action.summary, ttl],
      );
      await this.events.publish(db, tenantId, 'approvals.created', { id: approval!.id, agentId, actionId, reviewerRole: decision.reviewerRole });
    } else {
      await this.events.publish(db, tenantId, 'agents.action_blocked', { agentId, actionId, reason: decision.reason });
      this.log.warn(`[${agentId}] blocked ${action.type}: ${decision.reason}`);
    }
    return { id: actionId, decision };
  }

  private async execute(db: Db, tenantId: string, agentId: string, actionId: string, action: ProposedAction, actor?: Principal): Promise<ActionWrite[]> {
    const p = actor ?? agentPrincipal(tenantId, agentId);
    const opts = { agentActionId: actionId, confidence: action.confidence, evidence: action.evidence, source: 'agent' as const };
    switch (action.type) {
      case 'update_fields': {
        if (!action.target) throw badRequest('missing_target', 'update_fields needs a target');
        const { writes } = await this.records.update(db, p, action.target.object, action.target.id, action.payload.fields, opts);
        return writes.map((w) => ({ kind: 'field', object: w.object, id: w.id, field: w.field, old: w.old, new: w.new }));
      }
      case 'create_record': {
        const object = action.payload.object as ObjectName;
        const rec = await this.records.create(db, p, object, action.payload.data, opts);
        return [{ kind: 'create', object, id: rec.id }];
      }
      case 'create_task': {
        const t = await one<{ id: string }>(
          db,
          `INSERT INTO tasks (tenant_id, title, object, record_id, assignee_id, assignee_role, due_at, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
          [
            tenantId,
            action.payload.title,
            action.target?.object ?? null,
            action.target?.id ?? null,
            action.payload.assignee_id ?? null,
            action.payload.assignee_role ?? null,
            action.payload.due_at ?? null,
            `agent:${agentId}`,
          ],
        );
        return [{ kind: 'task', id: t!.id }];
      }
      case 'send_email': {
        const m = await this.outbound.schedule(db, {
          tenantId,
          to: String(action.payload.to),
          from: (action.payload.from as string) ?? null,
          subject: (action.payload.subject as string) ?? null,
          body: String(action.payload.body),
          agentActionId: actionId,
          related: action.target ?? null,
        });
        return [{ kind: 'outbound', id: m.id }];
      }
      case 'submit_quote':
      case 'clear_compliance':
        throw forbidden('not_executable', `${action.type} is not executable by the agent runtime`);
    }
  }

  /** Execute a queued action after a person approved it (optionally with edited payload). */
  async executeApproved(db: Db, approver: Principal, actionId: string, editedPayload?: Record<string, unknown>): Promise<ActionWrite[]> {
    const a = await one<AgentActionRow>(db, 'SELECT * FROM agent_actions WHERE id = $1 FOR UPDATE', [actionId]);
    if (!a) throw notFound('Agent action');
    if (a.decision !== 'queued') throw conflict('not_queued', `Action is ${a.decision}`);
    const payload = { ...a.payload, ...(editedPayload ?? {}) };
    const action: ProposedAction = {
      type: a.action_type as ProposedAction['type'],
      target: a.target_object ? { object: a.target_object as ObjectName, id: a.target_id! } : undefined,
      payload,
      confidence: Number(a.confidence ?? 0),
      evidence: a.evidence,
      summary: String(payload.summary ?? ''),
    };
    // Re-check the boundary: an edit must not widen the agent's scope, and a killed agent stays stopped.
    const def = agentDefinition(a.agent_id);
    if (!def) throw notFound(`Agent "${a.agent_id}"`);
    const recheck = evaluatePolicy(def, await this.state(db, a.agent_id), { ...action, confidence: 1 });
    if (recheck.decision === 'block') throw forbidden('policy_blocked', recheck.reason);
    // Writes still go through the agent's identity so field scopes and human-only fields stay enforced.
    const writes = await this.execute(db, approver.tenantId, a.agent_id, a.id, action);
    await db.query(
      "UPDATE agent_actions SET decision = 'executed', writes = $2, payload = $3, executed_at = now(), reason = coalesce(reason,'') || $4 WHERE id = $1",
      [a.id, JSON.stringify(writes), JSON.stringify(payload), ` | approved by ${approver.actorId}`],
    );
    return writes;
  }

  /** FR-AI-06: revert an executed action. Fields changed since by someone else are left alone and reported. */
  async rollback(db: Db, actor: Principal, actionId: string): Promise<{ reverted: string[]; skipped: string[] }> {
    const a = await one<AgentActionRow>(db, 'SELECT * FROM agent_actions WHERE id = $1 FOR UPDATE', [actionId]);
    if (!a) throw notFound('Agent action');
    if (a.decision !== 'executed') throw conflict('not_executed', `Only executed actions can be rolled back (this one is ${a.decision})`);
    const sys = systemPrincipal(actor.tenantId);
    const reverted: string[] = [];
    const skipped: string[] = [];
    for (const w of [...a.writes].reverse()) {
      switch (w.kind) {
        case 'field': {
          const current = await this.records.getRaw(db, w.object, w.id);
          const currentValue = w.field.startsWith('custom.')
            ? (current?.custom as Record<string, unknown> | undefined)?.[w.field.slice(7)]
            : current?.[w.field];
          if (!current || !same(currentValue, w.new)) {
            skipped.push(`${w.object}.${w.field}: changed since the agent wrote it`);
            break;
          }
          const patch = w.field.startsWith('custom.') ? { custom: { [w.field.slice(7)]: w.old } } : { [w.field]: w.old };
          await this.records.update(db, sys, w.object, w.id, patch, { source: 'system', agentActionId: a.id });
          reverted.push(`${w.object}.${w.field}`);
          break;
        }
        case 'create':
          await this.records.remove(db, sys, w.object, w.id, { source: 'system', agentActionId: a.id });
          reverted.push(`${w.object} ${w.id} removed`);
          break;
        case 'task':
          await db.query("UPDATE tasks SET status = 'cancelled' WHERE id = $1", [w.id]);
          reverted.push(`task ${w.id} cancelled`);
          break;
        case 'outbound':
          if (await this.outbound.recall(db, w.id)) reverted.push(`message ${w.id} recalled`);
          else skipped.push(`message ${w.id}: already sent, cannot be recalled`);
          break;
      }
    }
    await db.query("UPDATE agent_actions SET decision = 'rolled_back', rolled_back_at = now(), reason = coalesce(reason,'') || $2 WHERE id = $1", [
      a.id,
      ` | rolled back by ${actor.actorId}`,
    ]);
    await this.events.publish(db, actor.tenantId, 'agents.action_rolled_back', { actionId: a.id, by: actor.actorId, reverted, skipped });
    return { reverted, skipped };
  }

  async rollbackRun(db: Db, actor: Principal, runId: string) {
    const actions = await many<{ id: string }>(
      db,
      "SELECT id FROM agent_actions WHERE run_id = $1 AND decision = 'executed' ORDER BY created_at DESC",
      [runId],
    );
    const results = [];
    for (const { id } of actions) results.push({ id, ...(await this.rollback(db, actor, id)) });
    return results;
  }

  async setKilled(db: Db, tenantId: string, agentId: string, killed: boolean) {
    if (!agentDefinition(agentId)) throw notFound(`Agent "${agentId}"`);
    await db.query(
      `INSERT INTO agent_settings (tenant_id, agent_id, killed) VALUES ($1,$2,$3)
       ON CONFLICT (tenant_id, agent_id) DO UPDATE SET killed = EXCLUDED.killed, updated_at = now()`,
      [tenantId, agentId, killed],
    );
    // Stop anything not yet delivered when the switch is thrown.
    if (killed) {
      await db.query(
        `UPDATE outbound_messages SET status = 'recalled'
          WHERE status = 'scheduled' AND agent_action_id IN (SELECT id FROM agent_actions WHERE agent_id = $1)`,
        [agentId],
      );
    }
  }

  async setOverrides(db: Db, tenantId: string, agentId: string, overrides: AgentOverrides) {
    if (!agentDefinition(agentId)) throw notFound(`Agent "${agentId}"`);
    await db.query(
      `INSERT INTO agent_settings (tenant_id, agent_id, overrides) VALUES ($1,$2,$3)
       ON CONFLICT (tenant_id, agent_id) DO UPDATE SET overrides = EXCLUDED.overrides, updated_at = now()`,
      [tenantId, agentId, JSON.stringify(overrides)],
    );
  }

  canReview(p: Principal, assigneeRole: string): boolean {
    return hasRole(p, assigneeRole as never, 'sales_leader');
  }
}
