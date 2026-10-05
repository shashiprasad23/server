import { Injectable, OnModuleInit } from '@nestjs/common';
import { DbService, one } from '../../db/db.service';
import { DomainEvent, EventBus } from '../../events/event-bus';
import { RecordsService } from '../../records/records.service';
import { CpqService } from '../../cpq/cpq.service';
import { AgentRuntime } from '../agent-runtime.service';

const TRIGGER_STAGES = new Set(['solution_design', 'supply_dealreg']);

/**
 * Configure-and-quote agent (FR-CPQ-02, 05, 06): when a deal reaches solution design, build the BOM,
 * draft the quote and the OEM deal registration for presales and the rep to review. If the
 * requirements do not produce a valid configuration, hand presales a task listing what is missing.
 */
@Injectable()
export class QuoteAgent implements OnModuleInit {
  static readonly id = 'quote_agent';

  constructor(
    private readonly events: EventBus,
    private readonly dbs: DbService,
    private readonly records: RecordsService,
    private readonly runtime: AgentRuntime,
    private readonly cpq: CpqService,
  ) {}

  onModuleInit() {
    this.events.subscribe('opportunities.stage_changed', 'quote-agent', (e) => this.onStage(e));
  }

  async onStage(event: DomainEvent) {
    if (!TRIGGER_STAGES.has(String(event.payload.to))) return;
    await this.dbs.tx(event.tenantId, async (db) => {
      const opp = await this.records.getRaw(db, 'opportunities', String(event.payload.id));
      if (!opp) return;
      const runId = this.runtime.newRun();
      const existing = await one(db, "SELECT id FROM quotes WHERE opportunity_id = $1 AND status NOT IN ('superseded','withdrawn','expired','rejected')", [opp.id]);
      const config = await this.cpq.configureFor(db, opp.id);

      if (!config.valid) {
        await this.runtime.propose(db, event.tenantId, QuoteAgent.id, runId, {
          type: 'create_task',
          target: { object: 'opportunities', id: opp.id },
          payload: { title: `Complete requirements for ${String(opp.name)}: ${config.errors.join('; ')}`, assignee_role: 'presales' },
          confidence: 0.95,
          summary: `Ask presales to complete requirements for ${String(opp.name)}`,
        });
        return;
      }
      if (!existing) {
        await this.runtime.propose(db, event.tenantId, QuoteAgent.id, runId, {
          type: 'draft_quote',
          target: { object: 'opportunities', id: opp.id },
          payload: { input: {} },
          confidence: config.warnings.length > 2 ? 0.65 : 0.85,
          evidence: config.lines.map((l) => ({ field: l.product.sku, quote: `${l.qty} x ${l.product.name}: ${l.reason}` })),
          summary: `Draft quote for ${String(opp.name)}: ${config.summary.units} x ${config.summary.server_sku}, ${config.summary.power_kw_total} kW`,
        });
      }
      const oem = (opp.oem as string) || config.lines[0]?.product.oem;
      const reg = oem
        ? await one(db, "SELECT id FROM deal_registrations WHERE opportunity_id = $1 AND lower(oem) = lower($2) AND status IN ('draft','submitted','approved')", [opp.id, oem])
        : null;
      if (oem && !reg) {
        await this.runtime.propose(db, event.tenantId, QuoteAgent.id, runId, {
          type: 'draft_deal_registration',
          target: { object: 'opportunities', id: opp.id },
          payload: { oem },
          confidence: 0.9,
          summary: `Draft ${oem} deal registration for ${String(opp.name)}`,
        });
      }
    });
  }
}
