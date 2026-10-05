import { Injectable, OnModuleInit } from '@nestjs/common';
import { Db, DbService, many, one } from '../../db/db.service';
import { DomainEvent, EventBus } from '../../events/event-bus';
import { InsightsService } from '../../insights/insights.service';
import { scoreHealth } from '../../insights/scoring';
import { RecordsService } from '../../records/records.service';
import { AgentRuntime } from '../agent-runtime.service';

/** Key-order independent: jsonb hands objects back with sorted keys. */
const stable = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(stable) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable((v as Record<string, unknown>)[k])])) : (v ?? null);
const same = (a: unknown, b: unknown) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));

/**
 * Deal coach agent (FR-PIPE-03/05, FR-FCST-02, FR-CS-03): keeps risk score, win probability and
 * account health current, with a reason for every point. Re-scores on activity and on an hourly sweep.
 */
@Injectable()
export class DealCoachAgent implements OnModuleInit {
  static readonly id = 'deal_coach';

  constructor(
    private readonly events: EventBus,
    private readonly dbs: DbService,
    private readonly records: RecordsService,
    private readonly runtime: AgentRuntime,
    private readonly insights: InsightsService,
  ) {}

  onModuleInit() {
    const onOpp = (e: DomainEvent) => (e.payload.actorId === DealCoachAgent.id ? Promise.resolve() : this.rescoreFromEvent(e, String(e.payload.id)));
    this.events.subscribe('opportunities.created', 'deal-coach', onOpp);
    this.events.subscribe('opportunities.updated', 'deal-coach', onOpp);
    for (const t of ['quotes.created', 'quotes.submitted', 'quotes.published', 'quotes.accepted', 'dealreg.submit', 'compliance.screened', 'supply.held']) {
      this.events.subscribe(t, 'deal-coach', (e) => this.rescoreFromEvent(e, String(e.payload.opportunityId)));
    }
    this.events.subscribe('activities.created', 'deal-coach', async (e) => {
      await this.dbs.tx(e.tenantId, async (db) => {
        const a = await this.records.getRaw(db, 'activities', String(e.payload.id));
        if (a?.opportunity_id) await this.rescore(db, e.tenantId, String(a.opportunity_id));
        if (a?.account_id && (a.type === 'ticket' || a.type === 'service_request')) await this.rehealth(db, e.tenantId, String(a.account_id));
      });
    });
  }

  private rescoreFromEvent(e: DomainEvent, opportunityId: string) {
    if (!opportunityId || opportunityId === 'undefined') return Promise.resolve();
    return this.dbs.tx(e.tenantId, (db) => this.rescore(db, e.tenantId, opportunityId));
  }

  async rescore(db: Db, tenantId: string, opportunityId: string) {
    const opp = await this.records.getRaw(db, 'opportunities', opportunityId);
    if (!opp || opp.stage_key === 'closed_won' || opp.stage_key === 'closed_lost') return;
    const s = await this.insights.score(db, opportunityId);
    const fields = { risk_score: s.risk, ai_probability: s.probability, risk_reasons: s.reasons };
    if (same(opp.risk_score, s.risk) && same(opp.ai_probability, s.probability) && same(opp.risk_reasons, s.reasons)) return;
    await this.runtime.propose(db, tenantId, DealCoachAgent.id, this.runtime.newRun(), {
      type: 'update_fields',
      target: { object: 'opportunities', id: opportunityId },
      payload: { fields, nextActions: s.nextActions },
      confidence: 0.9,
      evidence: s.reasons.map((r) => ({ field: 'risk_score', quote: `${r.reason} (+${r.points})` })),
      summary: `Risk ${s.risk}, win probability ${s.probability}% for ${String(opp.name)}`,
      model: 'rules',
      promptVersion: 'deal-score-v1',
    });
  }

  async rehealth(db: Db, tenantId: string, accountId: string) {
    const acct = await this.records.getRaw(db, 'accounts', accountId);
    if (!acct) return;
    const f = await one<{ tickets: number; rmas: number; last: Date | null; open: number }>(
      db,
      `SELECT (SELECT count(*)::int FROM activities WHERE account_id = $1 AND type = 'ticket' AND subject NOT ILIKE 'RMA%' AND occurred_at > now() - interval '90 days') AS tickets,
              (SELECT count(*)::int FROM activities WHERE account_id = $1 AND type = 'ticket' AND subject ILIKE 'RMA%' AND occurred_at > now() - interval '90 days') AS rmas,
              (SELECT max(occurred_at) FROM activities WHERE account_id = $1 AND type NOT IN ('ticket')) AS last,
              (SELECT count(*)::int FROM opportunities WHERE account_id = $1 AND deleted_at IS NULL AND stage_key NOT IN ('closed_won','closed_lost')) AS open`,
      [accountId],
    );
    const h = scoreHealth({
      ticketsLast90: f?.tickets ?? 0,
      rmasLast90: f?.rmas ?? 0,
      creditHold: !!acct.credit_hold,
      daysSinceActivity: f?.last ? Math.floor((Date.now() - new Date(f.last).getTime()) / 864e5) : null,
      openOpportunities: f?.open ?? 0,
    });
    if (same(acct.health_score, h.score) && same(acct.health_reasons, h.reasons)) return;
    await this.runtime.propose(db, tenantId, DealCoachAgent.id, this.runtime.newRun(), {
      type: 'update_fields',
      target: { object: 'accounts', id: accountId },
      payload: { fields: { health_score: h.score, health_reasons: h.reasons } },
      confidence: 0.9,
      evidence: h.reasons.map((r) => ({ field: 'health_score', quote: `${r.reason} (${r.points > 0 ? '+' : ''}${r.points})` })),
      summary: `Account health ${h.score} for ${String(acct.name)}`,
      model: 'rules',
      promptVersion: 'health-v1',
    });
  }

  async sweep(tenantId: string) {
    return this.dbs.tx(tenantId, async (db) => {
      const opps = await many<{ id: string }>(db, "SELECT id FROM opportunities WHERE deleted_at IS NULL AND stage_key NOT IN ('closed_won','closed_lost')");
      for (const o of opps) await this.rescore(db, tenantId, o.id);
      const accts = await many<{ id: string }>(db, 'SELECT id FROM accounts WHERE deleted_at IS NULL');
      for (const a of accts) await this.rehealth(db, tenantId, a.id);
      return opps.length;
    });
  }
}
