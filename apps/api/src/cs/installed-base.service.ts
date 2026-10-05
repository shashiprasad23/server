import { Injectable, OnModuleInit } from '@nestjs/common';
import { Db, DbService, many, one } from '../db/db.service';
import { DomainEvent, EventBus } from '../events/event-bus';
import { RecordsService } from '../records/records.service';
import { AgentRuntime, ActionWrite } from '../agents/agent-runtime.service';

const OLD_GENERATIONS = ['A100', 'H100', 'L40S', 'V100'];

/**
 * Installed base and renewals (FR-CORE-08, FR-CS-01, FR-CS-02): assets are recorded when a deal
 * closes, and the renewal agent opens renewal opportunities 120 days before support or licence end
 * and flags refresh opportunities on older GPU generations.
 */
@Injectable()
export class InstalledBaseService implements OnModuleInit {
  static readonly agentId = 'renewal_agent';

  constructor(
    private readonly events: EventBus,
    private readonly dbs: DbService,
    private readonly records: RecordsService,
    private readonly runtime: AgentRuntime,
  ) {}

  onModuleInit() {
    this.events.subscribe('opportunities.stage_changed', 'installed-base', (e) => (e.payload.to === 'closed_won' ? this.onWon(e) : Promise.resolve()));
  }

  private async onWon(e: DomainEvent) {
    await this.dbs.tx(e.tenantId, async (db) => {
      const opp = await this.records.getRaw(db, 'opportunities', String(e.payload.id));
      if (!opp?.account_id) return;
      const exists = await one(db, 'SELECT id FROM installed_assets WHERE opportunity_id = $1 LIMIT 1', [opp.id]);
      if (exists) return;
      const quote = await one<{ id: string }>(
        db,
        "SELECT id FROM quotes WHERE opportunity_id = $1 AND status IN ('accepted','sent','approved') ORDER BY (status = 'accepted') DESC, version DESC LIMIT 1",
        [opp.id],
      );
      const delivered = (opp.expected_ship_date as string) ?? new Date().toISOString().slice(0, 10);
      if (quote) {
        const lines = await many<{ product_id: string; sku: string; description: string; category: string; qty: number }>(
          db,
          "SELECT product_id, sku, description, category, qty FROM quote_lines WHERE quote_id = $1 AND category IN ('gpu_server','rack_system','networking','storage','software')",
          [quote.id],
        );
        const hasSupport = !!(await one(db, "SELECT 1 FROM quote_lines WHERE quote_id = $1 AND category = 'support'", [quote.id]));
        for (const l of lines) {
          await this.insertAsset(db, e.tenantId, opp, l, delivered, l.category === 'software' ? null : hasSupport ? 3 : 1, l.category === 'software' ? 1 : null);
        }
      } else if (opp.gpu_model) {
        await this.insertAsset(
          db,
          e.tenantId,
          opp,
          { product_id: null, sku: String(opp.gpu_model), description: `${String(opp.gpu_model)} systems`, category: 'gpu_server', qty: Math.max(1, Math.ceil(Number(opp.gpu_count ?? 8) / 8)) },
          delivered,
          3,
          null,
        );
      }
      await this.events.publish(db, e.tenantId, 'installed_base.recorded', { opportunityId: opp.id });
    });
  }

  private async insertAsset(
    db: Db,
    tenantId: string,
    opp: Record<string, unknown>,
    l: { product_id: string | null; sku: string; description: string; category: string; qty: number },
    delivered: string,
    supportYears: number | null,
    licenceYears: number | null,
  ) {
    await db.query(
      `INSERT INTO installed_assets (tenant_id, account_id, opportunity_id, product_id, sku, description, category, gpu_model, qty, site, delivered_at,
                                     warranty_end, support_end, licence_end)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::date, $11::date + interval '1 year',
               CASE WHEN $12::int IS NULL THEN NULL ELSE $11::date + make_interval(years => $12::int) END,
               CASE WHEN $13::int IS NULL THEN NULL ELSE $11::date + make_interval(years => $13::int) END)`,
      [tenantId, opp.account_id, opp.id, l.product_id, l.sku, l.description, l.category, (opp.gpu_model as string) ?? null, l.qty, (opp.deployment_location as string) ?? null, delivered, supportYears, licenceYears],
    );
  }

  async list(db: Db, accountId?: string) {
    return many(
      db,
      `SELECT ia.*, a.name AS account_name, o.name AS renewal_name FROM installed_assets ia JOIN accounts a ON a.id = ia.account_id
         LEFT JOIN opportunities o ON o.id = ia.renewal_opportunity_id
        WHERE ($1::uuid IS NULL OR ia.account_id = $1) ORDER BY coalesce(ia.support_end, ia.licence_end) NULLS LAST LIMIT 500`,
      [accountId ?? null],
    );
  }

  /** Renewal agent sweep for one tenant. Returns the number of renewals and refresh tasks proposed. */
  async sweep(tenantId: string) {
    return this.dbs.tx(tenantId, async (db) => {
      let renewals = 0;
      let refresh = 0;
      const due = await many<Record<string, unknown>>(
        db,
        `SELECT ia.*, a.name AS account_name FROM installed_assets ia JOIN accounts a ON a.id = ia.account_id
          WHERE ia.renewal_opportunity_id IS NULL AND coalesce(ia.support_end, ia.licence_end) BETWEEN current_date AND current_date + 120`,
      );
      for (const asset of due) {
        const endRaw = (asset.support_end ?? asset.licence_end) as Date | string;
        const end10 = endRaw instanceof Date ? endRaw.toISOString().slice(0, 10) : String(endRaw).slice(0, 10);
        const kind = asset.support_end ? 'support' : 'licence';
        const res = await this.runtime.propose(db, tenantId, InstalledBaseService.agentId, this.runtime.newRun(), {
          type: 'create_record',
          payload: {
            object: 'opportunities',
            data: {
              account_id: asset.account_id,
              name: `${String(asset.account_name)}: ${kind} renewal for ${Number(asset.qty)} x ${String(asset.description)}`.slice(0, 480),
              type: 'renewal',
              channel: 'usp',
              expected_value: Number(asset.qty) * (kind === 'support' ? 18000 : 4500 * 8),
              expected_po_date: end10,
              gpu_model: asset.gpu_model ?? null,
            },
          },
          confidence: 0.95,
          evidence: [{ field: `${kind}_end`, quote: `${String(asset.description)} ${kind} ends ${end10}` }],
          summary: `Open ${kind} renewal for ${String(asset.account_name)} (ends ${end10})`,
          model: 'rules',
          promptVersion: 'renewal-v1',
        });
        if (res.decision.decision === 'execute') {
          const action = await one<{ writes: ActionWrite[] }>(db, 'SELECT writes FROM agent_actions WHERE id = $1', [res.id]);
          const created = action?.writes.find((w) => w.kind === 'create');
          if (created) await db.query('UPDATE installed_assets SET renewal_opportunity_id = $2 WHERE id = $1', [asset.id, created.id]);
          renewals++;
        }
      }
      const old = await many<Record<string, unknown>>(
        db,
        `SELECT ia.id, ia.account_id, ia.gpu_model, ia.qty, ia.delivered_at, a.name AS account_name FROM installed_assets ia JOIN accounts a ON a.id = ia.account_id
          WHERE ia.gpu_model = ANY($1) AND ia.delivered_at < current_date - interval '24 months'
            AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.record_id = ia.id AND t.status = 'open')`,
        [OLD_GENERATIONS],
      );
      for (const a of old) {
        const res = await this.runtime.propose(db, tenantId, InstalledBaseService.agentId, this.runtime.newRun(), {
          type: 'create_task',
          payload: { title: `Refresh opportunity: ${String(a.account_name)} runs ${Number(a.qty)} x ${String(a.gpu_model)} systems over 2 years old`, assignee_role: 'rep' },
          target: { object: 'accounts', id: String(a.account_id) },
          confidence: 0.85,
          summary: `Flag ${String(a.gpu_model)} refresh at ${String(a.account_name)}`,
          model: 'rules',
        });
        if (res.decision.decision === 'execute') {
          await db.query("UPDATE tasks SET record_id = $2, object = 'installed_assets' WHERE id = (SELECT (writes->0->>'id')::uuid FROM agent_actions WHERE id = $1)", [res.id, a.id]);
          refresh++;
        }
      }
      return { renewals, refresh };
    });
  }
}
