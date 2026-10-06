import { Injectable, OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import { Db, DbService, many, one } from '../db/db.service';
import { EventBus } from '../events/event-bus';
import { MetadataService } from '../metadata/metadata.service';
import { RecordsService } from '../records/records.service';
import { RESTRICTED_READERS } from '../records/record-types';
import { Principal, Role, hasRole, systemPrincipal } from '../common/principal';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../common/errors';
import { validate } from '../common/validate';
import { AgentRuntime } from '../agents/agent-runtime.service';
import { CatalogItem, Configuration, Requirements, configure } from './configurator';

export type SupplyStatus = 'in_stock' | 'partial' | 'lead_time';

export interface SupplyLine {
  sku: string;
  name: string;
  qty: number;
  available: number;
  status: SupplyStatus;
  lead_time_weeks: number;
  held_by_others: number;
  alternatives: { sku: string; name: string; available: number; lead_time_weeks: number }[];
}

export interface QuoteRow {
  id: string;
  opportunity_id: string;
  number: string;
  version: number;
  status: string;
  currency: string;
  valid_until: string;
  discount_pct: number;
  freight: number;
  rebate?: number;
  payment_terms: string;
  subtotal: number;
  total: number;
  cost_total?: number;
  margin?: number;
  margin_pct?: number;
  power_kw_total: number;
  racks: number;
  cooling: string | null;
  config_warnings: string[];
  approval_role: string | null;
  approval_reasons: string[];
  revalidation: unknown[];
  notes: string | null;
  created_by: string;
  created_at: string;
  approved_by: string | null;
  published_to: string | null;
  lines?: Record<string, unknown>[];
}

const num = (v: unknown) => (v == null ? 0 : Number(v));
const round2 = (n: number) => Math.round(n * 100) / 100;
const iso = (d: unknown) => (d instanceof Date ? d.toISOString().slice(0, 10) : (d as string));

export const quoteInput = z.object({
  lines: z.array(z.object({ sku: z.string(), qty: z.number().int().positive() })).optional(),
  requirements: z
    .object({
      gpu_model: z.string().optional(),
      gpu_count: z.number().int().positive().optional(),
      node_count: z.number().int().positive().optional(),
      workload: z.string().optional(),
      cooling: z.string().optional(),
      kw_per_rack: z.number().positive().optional(),
      oem: z.string().optional(),
      fabric: z.enum(['infiniband', 'ethernet']).optional(),
      include_storage: z.boolean().optional(),
    })
    .optional(),
  discount_pct: z.number().min(0).max(60).default(0),
  freight: z.number().min(0).optional(),
  rebate: z.number().min(0).default(0),
  payment_terms: z.string().max(60).default('Net 30'),
  validity_days: z.number().int().min(1).max(90).optional(),
  notes: z.string().max(5000).optional(),
});
export type QuoteInput = z.infer<typeof quoteInput>;

const ROLE_RANK: Record<string, number> = { rep: 0, deal_desk: 1, sales_leader: 2 };

/**
 * Configure, price and quote (FR-CPQ-01..10): catalogue, configurator, supply checks with holds,
 * OEM deal registration, versioned quotes with margin, approval matrix, publishing to the customer's
 * portal, and re-validation when cost or lead time moves.
 */
@Injectable()
export class CpqService implements OnModuleInit {
  constructor(
    private readonly dbs: DbService,
    private readonly records: RecordsService,
    private readonly metadata: MetadataService,
    private readonly events: EventBus,
    private readonly runtime: AgentRuntime,
  ) {}

  onModuleInit() {
    // Agent actions: drafts are reversible, so rollback withdraws them.
    this.runtime.registerExecutor('draft_quote', async (db, tenantId, agentId, actionId, action) => {
      const p = { tenantId, kind: 'agent' as const, actorId: agentId, roles: ['agent' as Role] };
      const quote = await this.createQuote(db, p, String(action.target?.id), (action.payload.input as QuoteInput) ?? {});
      return [{ kind: 'row', table: 'quotes', id: quote.id, label: `quote ${quote.number} v${quote.version}` }];
    });
    this.runtime.registerUndo('quotes', async (db, id) => {
      const r = await db.query("UPDATE quotes SET status = 'withdrawn' WHERE id = $1 AND status IN ('draft','pending_approval')", [id]);
      return (r.rowCount ?? 0) > 0;
    });
    this.runtime.registerExecutor('draft_deal_registration', async (db, tenantId, agentId, _actionId, action) => {
      const reg = await this.createDealRegistration(db, { tenantId, kind: 'agent', actorId: agentId, roles: ['agent'] }, String(action.target?.id), String(action.payload.oem));
      return [{ kind: 'row', table: 'deal_registrations', id: reg.id, label: `deal registration (${reg.oem})` }];
    });
    this.runtime.registerUndo('deal_registrations', async (db, id) => {
      const r = await db.query("UPDATE deal_registrations SET status = 'withdrawn', updated_at = now() WHERE id = $1 AND status = 'draft'", [id]);
      return (r.rowCount ?? 0) > 0;
    });
  }

  // ---- catalogue -------------------------------------------------------------------------

  async catalog(db: Db): Promise<CatalogItem[]> {
    const rows = await many<Record<string, unknown>>(db, 'SELECT * FROM products WHERE active ORDER BY category, list_price DESC');
    return rows.map((r) => ({
      id: String(r.id),
      sku: String(r.sku),
      name: String(r.name),
      category: String(r.category),
      oem: (r.oem as string) ?? null,
      gpu_model: (r.gpu_model as string) ?? null,
      gpus_per_unit: num(r.gpus_per_unit),
      power_kw: num(r.power_kw),
      rack_units: num(r.rack_units),
      cooling: String(r.cooling),
      list_price: num(r.list_price),
      cost: num(r.cost),
      stock: num(r.stock),
      lead_time_weeks: num(r.lead_time_weeks),
      export_class: String(r.export_class),
      attrs: (r.attrs as Record<string, unknown>) ?? {},
    }));
  }

  /** Catalogue for display; cost is hidden from roles that may not see margin. */
  async listProducts(db: Db, p: Principal) {
    const items = await this.catalog(db);
    const held = await this.heldQuantities(db);
    return items.map((i) => {
      const out: Record<string, unknown> = { ...i, held: held.get(i.id) ?? 0, available: i.stock - (held.get(i.id) ?? 0) };
      if (!hasRole(p, ...RESTRICTED_READERS, 'procurement')) delete out.cost;
      return out;
    });
  }

  /** Price-list import from OEMs / distributors (FR-CPQ-01, FR-NS-06 interim catalogue). */
  async importPriceList(db: Db, p: Principal, body: unknown) {
    const rows = validate(
      z.array(
        z.object({
          sku: z.string().min(1),
          name: z.string().optional(),
          category: z.enum(['gpu_server', 'rack_system', 'networking', 'optics', 'storage', 'software', 'service', 'support', 'rack_infra']).optional(),
          list_price: z.number().nonnegative().optional(),
          cost: z.number().nonnegative().optional(),
          stock: z.number().int().nonnegative().optional(),
          lead_time_weeks: z.number().int().nonnegative().optional(),
          price_valid_until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        }),
      ).max(5000),
      body,
    );
    let updated = 0;
    let created = 0;
    for (const r of rows) {
      const existing = await one<{ id: string }>(db, 'SELECT id FROM products WHERE sku = $1', [r.sku]);
      if (existing) {
        await db.query(
          `UPDATE products SET name = coalesce($2, name), list_price = coalesce($3, list_price), cost = coalesce($4, cost),
             stock = coalesce($5, stock), lead_time_weeks = coalesce($6, lead_time_weeks), price_valid_until = coalesce($7::date, price_valid_until),
             source = 'price_list', updated_at = now() WHERE id = $1`,
          [existing.id, r.name ?? null, r.list_price ?? null, r.cost ?? null, r.stock ?? null, r.lead_time_weeks ?? null, r.price_valid_until ?? null],
        );
        updated++;
      } else {
        if (!r.name || !r.category || r.list_price === undefined || r.cost === undefined) {
          throw badRequest('incomplete_new_sku', `New SKU ${r.sku} needs name, category, list_price and cost`);
        }
        await db.query(
          `INSERT INTO products (tenant_id, sku, name, category, list_price, cost, stock, lead_time_weeks, price_valid_until, source)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'price_list')`,
          [p.tenantId, r.sku, r.name, r.category, r.list_price, r.cost, r.stock ?? 0, r.lead_time_weeks ?? 0, r.price_valid_until ?? null],
        );
        created++;
      }
    }
    await this.events.publish(db, p.tenantId, 'catalog.updated', { updated, created, by: p.actorId });
    return { updated, created };
  }

  // ---- configuration and supply ------------------------------------------------------------

  async requirementsFor(db: Db, opportunityId: string, override?: Requirements): Promise<Requirements> {
    const opp = await this.records.getRaw(db, 'opportunities', opportunityId);
    if (!opp) throw notFound('Opportunity');
    const custom = (opp.custom as Record<string, unknown>) ?? {};
    return {
      gpu_model: (opp.gpu_model as string) ?? null,
      gpu_count: (opp.gpu_count as number) ?? null,
      node_count: (opp.node_count as number) ?? null,
      workload: (opp.workload as string) ?? null,
      cooling: (opp.cooling as string) ?? null,
      kw_per_rack: (opp.kw_per_rack as number) ?? null,
      oem: (opp.oem as string) ?? null,
      fabric: (custom.cluster_fabric === 'infiniband' ? 'infiniband' : custom.cluster_fabric ? 'ethernet' : null) as Requirements['fabric'],
      ...(override ?? {}),
    };
  }

  async configureFor(db: Db, opportunityId: string, override?: Requirements): Promise<Configuration> {
    return configure(await this.requirementsFor(db, opportunityId, override), await this.catalog(db));
  }

  private async heldQuantities(db: Db, excludeOpportunity?: string): Promise<Map<string, number>> {
    const rows = await many<{ product_id: string; qty: number }>(
      db,
      `SELECT product_id, sum(qty)::int AS qty FROM supply_holds
        WHERE status = 'active' AND expires_at > now() AND ($1::uuid IS NULL OR opportunity_id <> $1) GROUP BY product_id`,
      [excludeOpportunity ?? null],
    );
    return new Map(rows.map((r) => [r.product_id, r.qty]));
  }

  /** FR-CPQ-03: per line in stock / partial / lead time, net of other deals' holds, with alternatives. */
  async supplyCheck(db: Db, opportunityId: string, lines: { product: CatalogItem; qty: number }[]): Promise<SupplyLine[]> {
    const heldByOthers = await this.heldQuantities(db, opportunityId);
    const catalog = await this.catalog(db);
    return lines.map(({ product, qty }) => {
      const held = heldByOthers.get(product.id) ?? 0;
      const available = Math.max(0, product.stock - held);
      const status: SupplyStatus = available >= qty ? 'in_stock' : available > 0 ? 'partial' : 'lead_time';
      const alternatives =
        status !== 'in_stock' && (product.category === 'gpu_server' || product.category === 'rack_system')
          ? catalog
              .filter((c) => c.id !== product.id && c.category === product.category && c.gpus_per_unit === product.gpus_per_unit)
              .map((c) => ({ sku: c.sku, name: c.name, available: Math.max(0, c.stock - (heldByOthers.get(c.id) ?? 0)), lead_time_weeks: c.lead_time_weeks }))
              .filter((c) => c.available >= qty || c.lead_time_weeks < product.lead_time_weeks)
              .slice(0, 3)
          : [];
      return { sku: product.sku, name: product.name, qty, available, status, lead_time_weeks: status === 'in_stock' ? 0 : product.lead_time_weeks, held_by_others: held, alternatives };
    });
  }

  // ---- holds -------------------------------------------------------------------------------

  async createHold(db: Db, p: Principal, opportunityId: string, body: unknown) {
    const { sku, qty } = validate(z.object({ sku: z.string(), qty: z.number().int().positive() }), body);
    if (!hasRole(p, 'rep', 'procurement', 'deal_desk', 'sales_leader')) throw forbidden('role_required', 'Only sales, deal desk or procurement can hold stock');
    const product = await one<{ id: string; stock: number; name: string }>(db, 'SELECT id, stock, name FROM products WHERE sku = $1', [sku]);
    if (!product) throw notFound(`SKU ${sku}`);
    await this.records.getRaw(db, 'opportunities', opportunityId).then((o) => {
      if (!o) throw notFound('Opportunity');
    });
    // Serialise holds on the same product so two reps cannot take the last units at once.
    await db.query('SELECT id FROM products WHERE id = $1 FOR UPDATE', [product.id]);
    const held = (await this.heldQuantities(db)).get(product.id) ?? 0;
    const available = product.stock - held;
    if (qty > available) {
      throw conflict('insufficient_stock', `Only ${Math.max(0, available)} of ${product.name} available (${held} held for other deals)`);
    }
    const days = (await this.metadata.setting(db, 'cpq.defaults')).hold_days;
    const hold = await one(
      db,
      `INSERT INTO supply_holds (tenant_id, product_id, opportunity_id, qty, expires_at, created_by)
       VALUES ($1,$2,$3,$4, now() + make_interval(days => $5), $6) RETURNING *`,
      [p.tenantId, product.id, opportunityId, qty, days, p.actorId],
    );
    await this.events.publish(db, p.tenantId, 'supply.held', { opportunityId, sku, qty, by: p.actorId });
    return hold;
  }

  async releaseHold(db: Db, p: Principal, id: string) {
    const r = await db.query("UPDATE supply_holds SET status = 'released' WHERE id = $1 AND status = 'active' RETURNING id", [id]);
    if (!r.rowCount) throw notFound('Active hold');
    await this.events.publish(db, p.tenantId, 'supply.released', { id, by: p.actorId });
    return { id, status: 'released' };
  }

  async holds(db: Db, opportunityId?: string) {
    return many(
      db,
      `SELECT h.*, p.sku, p.name, o.name AS opportunity_name FROM supply_holds h
         JOIN products p ON p.id = h.product_id JOIN opportunities o ON o.id = h.opportunity_id
        WHERE ($1::uuid IS NULL OR h.opportunity_id = $1) ORDER BY h.created_at DESC LIMIT 200`,
      [opportunityId ?? null],
    );
  }

  /** Worker: expire holds past their date and release holds on lost deals (FR-CPQ-04). */
  async expireHolds(db: Db): Promise<number> {
    const r = await db.query(
      `UPDATE supply_holds h SET status = 'expired' WHERE status = 'active'
         AND (expires_at <= now() OR EXISTS (SELECT 1 FROM opportunities o WHERE o.id = h.opportunity_id AND o.stage_key = 'closed_lost'))`,
    );
    return r.rowCount ?? 0;
  }

  // ---- deal registration -------------------------------------------------------------------

  async createDealRegistration(db: Db, p: Principal, opportunityId: string, oem: string) {
    if (!oem) throw badRequest('oem_required', 'OEM is required');
    const opp = await this.records.getRaw(db, 'opportunities', opportunityId);
    if (!opp) throw notFound('Opportunity');
    const existing = await one<{ id: string }>(
      db,
      "SELECT id FROM deal_registrations WHERE opportunity_id = $1 AND lower(oem) = lower($2) AND status IN ('draft','submitted','approved')",
      [opportunityId, oem],
    );
    if (existing) throw conflict('registration_exists', `An active ${oem} registration already exists for this deal`);
    const account = opp.account_id ? await this.records.getRaw(db, 'accounts', String(opp.account_id)) : undefined;
    const notes = [
      `End customer: ${String(account?.name ?? 'unknown')}`,
      `Opportunity: ${String(opp.name)}`,
      opp.gpu_model ? `Configuration: ${opp.gpu_count ?? ''} x ${String(opp.gpu_model)}` : null,
      opp.expected_ship_date ? `Expected ship: ${String(opp.expected_ship_date)}` : null,
      opp.destination_country ? `Destination: ${String(opp.destination_country)}` : null,
    ]
      .filter(Boolean)
      .join('\n');
    const reg = await one<{ id: string; oem: string }>(
      db,
      'INSERT INTO deal_registrations (tenant_id, opportunity_id, oem, notes, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id, oem',
      [p.tenantId, opportunityId, oem, notes, p.kind === 'agent' ? `agent:${p.actorId}` : p.actorId],
    );
    await this.events.publish(db, p.tenantId, 'dealreg.drafted', { id: reg!.id, opportunityId, oem });
    return reg!;
  }

  async updateDealRegistration(db: Db, p: Principal, id: string, action: 'submit' | 'approve' | 'reject', body: unknown) {
    if (!hasRole(p, 'rep', 'deal_desk', 'procurement', 'sales_leader')) throw forbidden('role_required', 'Not allowed');
    const reg = await one<{ id: string; status: string; oem: string; opportunity_id: string }>(db, 'SELECT * FROM deal_registrations WHERE id = $1 FOR UPDATE', [id]);
    if (!reg) throw notFound('Deal registration');
    if (action === 'submit') {
      if (reg.status !== 'draft') throw conflict('not_draft', `Registration is ${reg.status}`);
      // OEM partner portal adapter goes here; until then the reference is entered or generated for tracking.
      const ref = validate(z.object({ portal_reference: z.string().max(80).optional() }), body ?? {}).portal_reference ?? `DR-${reg.oem.slice(0, 3).toUpperCase()}-${Date.now() % 1_000_000}`;
      await db.query("UPDATE deal_registrations SET status = 'submitted', portal_reference = $2, updated_at = now() WHERE id = $1", [id, ref]);
    } else if (action === 'approve') {
      if (reg.status !== 'submitted') throw conflict('not_submitted', `Registration is ${reg.status}`);
      const input = validate(z.object({ protected_discount_pct: z.number().min(0).max(80).optional(), expires_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }), body);
      await db.query("UPDATE deal_registrations SET status = 'approved', protected_discount_pct = $2, expires_at = $3, updated_at = now() WHERE id = $1", [
        id,
        input.protected_discount_pct ?? null,
        input.expires_at,
      ]);
    } else {
      await db.query("UPDATE deal_registrations SET status = 'rejected', updated_at = now() WHERE id = $1", [id]);
    }
    await this.events.publish(db, p.tenantId, `dealreg.${action}`, { id, opportunityId: reg.opportunity_id, by: p.actorId });
    return one(db, 'SELECT * FROM deal_registrations WHERE id = $1', [id]);
  }

  async dealRegistrations(db: Db, opportunityId?: string) {
    return many(
      db,
      `SELECT d.*, o.name AS opportunity_name FROM deal_registrations d JOIN opportunities o ON o.id = d.opportunity_id
        WHERE ($1::uuid IS NULL OR d.opportunity_id = $1) ORDER BY d.created_at DESC LIMIT 200`,
      [opportunityId ?? null],
    );
  }

  // ---- quotes ------------------------------------------------------------------------------

  private mask(p: Principal, q: QuoteRow): QuoteRow {
    const out: QuoteRow = {
      ...q,
      valid_until: iso(q.valid_until),
      discount_pct: num(q.discount_pct),
      freight: num(q.freight),
      rebate: num(q.rebate),
      subtotal: num(q.subtotal),
      total: num(q.total),
      cost_total: num(q.cost_total),
      margin: num(q.margin),
      margin_pct: num(q.margin_pct),
      power_kw_total: num(q.power_kw_total),
    };
    out.lines = q.lines?.map((l) => ({ ...l, unit_price: num(l.unit_price), unit_cost: num(l.unit_cost), extended_price: num(l.extended_price) }));
    if (!hasRole(p, ...RESTRICTED_READERS) && p.kind !== 'system') {
      delete out.cost_total;
      delete out.margin;
      delete out.margin_pct;
      delete out.rebate;
      out.lines = out.lines?.map(({ unit_cost: _c, ...rest }) => rest);
    }
    return out;
  }

  async getQuote(db: Db, p: Principal, id: string): Promise<QuoteRow> {
    const q = await one<QuoteRow>(db, 'SELECT * FROM quotes WHERE id = $1', [id]);
    if (!q) throw notFound('Quote');
    q.lines = await many(db, 'SELECT * FROM quote_lines WHERE quote_id = $1 ORDER BY position', [id]);
    return this.mask(p, q);
  }

  async listQuotes(db: Db, p: Principal, opportunityId?: string, status?: string) {
    const rows = await many<QuoteRow & { opportunity_name: string }>(
      db,
      `SELECT q.*, o.name AS opportunity_name FROM quotes q JOIN opportunities o ON o.id = q.opportunity_id
        WHERE ($1::uuid IS NULL OR q.opportunity_id = $1) AND ($2::text IS NULL OR q.status = $2)
        ORDER BY q.created_at DESC LIMIT 200`,
      [opportunityId ?? null, status ?? null],
    );
    return rows.map((r) => this.mask(p, r));
  }

  /** FR-CPQ-06 / 07: a versioned draft quote with BOM, supply status per line, freight, rebates and margin. */
  async createQuote(db: Db, p: Principal, opportunityId: string, body: unknown): Promise<QuoteRow> {
    const input = validate(quoteInput, body ?? {});
    const opp = await this.records.getRaw(db, 'opportunities', opportunityId);
    if (!opp) throw notFound('Opportunity');
    const catalog = await this.catalog(db);
    const defaults = await this.metadata.setting(db, 'cpq.defaults');

    let lines: { product: CatalogItem; qty: number }[];
    let config: Configuration | null = null;
    if (input.lines?.length) {
      lines = input.lines.map((l) => {
        const product = catalog.find((c) => c.sku === l.sku);
        if (!product) throw badRequest('unknown_sku', `Unknown SKU ${l.sku}`);
        return { product, qty: l.qty };
      });
    } else {
      config = configure(await this.requirementsFor(db, opportunityId, input.requirements as Requirements), catalog);
      if (!config.valid) throw unprocessable('invalid_configuration', 'The requirements do not produce a valid configuration', config.errors);
      lines = config.lines;
    }
    const supply = await this.supplyCheck(db, opportunityId, lines);

    const factor = 1 - input.discount_pct / 100;
    const priced = lines.map((l, i) => ({
      ...l,
      position: i + 1,
      unit_price: round2(l.product.list_price * factor),
      extended: round2(l.product.list_price * factor * l.qty),
      supply: supply[i],
    }));
    const subtotal = round2(priced.reduce((a, l) => a + l.extended, 0));
    const hardware = priced.filter((l) => ['gpu_server', 'rack_system', 'networking', 'optics', 'storage', 'rack_infra'].includes(l.product.category));
    const freight = input.freight ?? round2((hardware.reduce((a, l) => a + l.extended, 0) * defaults.default_freight_pct) / 100);
    const total = round2(subtotal + freight);
    const costTotal = round2(priced.reduce((a, l) => a + l.product.cost * l.qty, 0) + freight - input.rebate);
    const margin = round2(total - costTotal);
    const marginPct = total > 0 ? round2((margin / total) * 100) : 0;
    const powerKw = config?.summary.power_kw_total ?? round2(priced.reduce((a, l) => a + l.product.power_kw * l.qty, 0));
    const racks = config?.summary.racks ?? 0;

    const prev = await one<{ number: string; version: number }>(
      db,
      'SELECT number, max(version) AS version FROM quotes WHERE opportunity_id = $1 GROUP BY number ORDER BY version DESC LIMIT 1',
      [opportunityId],
    );
    const number = prev?.number ?? `Q-${new Date().getFullYear()}-${String(Date.now() % 1_000_000).padStart(6, '0')}`;
    const version = (prev?.version ?? 0) + 1;
    await db.query("UPDATE quotes SET status = 'superseded' WHERE opportunity_id = $1 AND status IN ('draft','pending_approval','approved')", [opportunityId]);

    const q = await one<{ id: string }>(
      db,
      `INSERT INTO quotes (tenant_id, opportunity_id, number, version, valid_until, discount_pct, freight, rebate, payment_terms,
                           subtotal, total, cost_total, margin, margin_pct, power_kw_total, racks, cooling, config_warnings, notes, created_by)
       VALUES ($1,$2,$3,$4, current_date + $5::int, $6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING id`,
      [
        p.tenantId, opportunityId, number, version, input.validity_days ?? defaults.quote_validity_days, input.discount_pct, freight, input.rebate,
        input.payment_terms, subtotal, total, costTotal, margin, marginPct, powerKw, racks, config?.summary.cooling ?? null,
        JSON.stringify(config?.warnings ?? []), input.notes ?? null, p.kind === 'agent' ? `agent:${p.actorId}` : p.actorId,
      ],
    );
    for (const l of priced) {
      await db.query(
        `INSERT INTO quote_lines (tenant_id, quote_id, product_id, position, sku, description, category, qty, unit_price, unit_cost,
                                  extended_price, lead_time_weeks, supply_status, export_class)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          p.tenantId, q!.id, l.product.id, l.position, l.product.sku, l.product.name, l.product.category, l.qty, l.unit_price,
          l.product.cost, l.extended, l.supply.lead_time_weeks, l.supply.status, l.product.export_class,
        ],
      );
    }
    await this.events.publish(db, p.tenantId, 'quotes.created', { id: q!.id, opportunityId, version, by: p.actorId });
    return this.getQuote(db, systemPrincipal(p.tenantId), q!.id);
  }

  /** FR-CPQ-08: approval matrix. Returns the role that must approve, or null when within policy. */
  async approvalNeeded(db: Db, q: QuoteRow): Promise<{ role: Role | null; reasons: string[] }> {
    const m = await this.metadata.setting(db, 'approval.matrix');
    const reasons: { role: Role; reason: string }[] = [];
    const d = num(q.discount_pct);
    if (d > m.deal_desk_max_discount_pct) reasons.push({ role: 'sales_leader', reason: `Discount ${d}% above ${m.deal_desk_max_discount_pct}%` });
    else if (d > m.rep_max_discount_pct) reasons.push({ role: 'deal_desk', reason: `Discount ${d}% above ${m.rep_max_discount_pct}%` });
    if (num(q.margin_pct) < m.margin_floor_pct) reasons.push({ role: 'deal_desk', reason: `Margin ${num(q.margin_pct)}% below the ${m.margin_floor_pct}% floor` });
    if (num(q.total) >= m.large_deal_value) reasons.push({ role: 'sales_leader', reason: `Deal value at or above ${m.large_deal_value.toLocaleString('en-US')}` });
    if (m.non_standard_payment_terms.includes(q.payment_terms)) reasons.push({ role: 'deal_desk', reason: `Non-standard payment terms: ${q.payment_terms}` });
    if (!reasons.length) return { role: null, reasons: [] };
    const role = reasons.reduce((a, r) => (ROLE_RANK[r.role] > ROLE_RANK[a] ? r.role : a), 'deal_desk' as Role);
    return { role, reasons: reasons.map((r) => r.reason) };
  }

  async submitQuote(db: Db, p: Principal, id: string) {
    const q = await this.getQuote(db, systemPrincipal(p.tenantId), id);
    if (q.status !== 'draft') throw conflict('not_draft', `Quote is ${q.status}`);
    const { role, reasons } = await this.approvalNeeded(db, q);
    if (!role) {
      await db.query("UPDATE quotes SET status = 'approved', approved_by = 'policy', approved_at = now(), approval_reasons = '[]' WHERE id = $1", [id]);
    } else {
      await db.query("UPDATE quotes SET status = 'pending_approval', approval_role = $2, approval_reasons = $3 WHERE id = $1", [id, role, JSON.stringify(reasons)]);
      await db.query(
        "INSERT INTO tasks (tenant_id, title, object, record_id, assignee_role, created_by) VALUES ($1,$2,'quotes',$3,$4,$5)",
        [p.tenantId, `Approve quote ${q.number} v${q.version}: ${reasons.join('; ')}`, id, role, p.actorId],
      );
    }
    await this.events.publish(db, p.tenantId, 'quotes.submitted', { id, role, reasons });
    return this.getQuote(db, p, id);
  }

  async decideQuote(db: Db, p: Principal, id: string, approve: boolean, note?: string) {
    const q = await one<{ status: string; approval_role: string; opportunity_id: string }>(db, 'SELECT status, approval_role, opportunity_id FROM quotes WHERE id = $1 FOR UPDATE', [id]);
    if (!q) throw notFound('Quote');
    if (q.status !== 'pending_approval') throw conflict('not_pending', `Quote is ${q.status}`);
    const needed = q.approval_role as Role;
    if (!(hasRole(p, needed) || (needed === 'deal_desk' && hasRole(p, 'sales_leader')))) {
      throw forbidden('approver_required', `Quote needs approval by ${needed}`);
    }
    await db.query(
      `UPDATE quotes SET status = $2, approved_by = $3, approved_at = now(), notes = coalesce(notes || E'\\n', '') || $4 WHERE id = $1`,
      [id, approve ? 'approved' : 'rejected', p.actorId, note ? `Approval note: ${note}` : approve ? 'Approved' : 'Rejected'],
    );
    await db.query("UPDATE tasks SET status = 'done' WHERE object = 'quotes' AND record_id = $1 AND status = 'open'", [id]);
    await this.events.publish(db, p.tenantId, approve ? 'quotes.approved' : 'quotes.rejected', { id, opportunityId: q.opportunity_id, by: p.actorId });
    return this.getQuote(db, p, id);
  }

  /** FR-CH-10: publish an approved quote to the customer's Marketplace or USP account (or by email). */
  async publishQuote(db: Db, p: Principal, id: string, channel: 'marketplace' | 'usp' | 'email') {
    const q = await this.getQuote(db, systemPrincipal(p.tenantId), id);
    if (q.status !== 'approved') throw conflict('not_approved', `Only approved quotes can be sent (this one is ${q.status})`);
    if (new Date(q.valid_until) < new Date(new Date().toISOString().slice(0, 10))) throw conflict('expired', 'Quote has expired; create a new version');
    await db.query("UPDATE quotes SET status = 'sent', published_to = $2, published_at = now() WHERE id = $1", [id, channel]);
    const opp = await this.records.getRaw(db, 'opportunities', q.opportunity_id);
    await this.records.create(db, systemPrincipal(p.tenantId), 'activities', {
      account_id: opp?.account_id ?? null,
      opportunity_id: q.opportunity_id,
      type: channel === 'email' ? 'email' : 'web',
      source: channel === 'email' ? 'outlook' : channel,
      direction: 'outbound',
      subject: `Quote ${q.number} v${q.version} sent via ${channel}`,
      body: `Total ${q.total.toLocaleString('en-US')} ${q.currency}, valid until ${q.valid_until}.`,
    });
    // Portal write-back adapter consumes this event (Marketplace / USP API).
    await this.events.publish(db, p.tenantId, 'quotes.published', { id, opportunityId: q.opportunity_id, channel, number: q.number, version: q.version });
    return this.getQuote(db, p, id);
  }

  /** Customer accepted (in the portal or by email). Updates the deal's expected value and margin. */
  async acceptQuote(db: Db, p: Principal, id: string) {
    const q = await this.getQuote(db, systemPrincipal(p.tenantId), id);
    if (q.status !== 'sent') throw conflict('not_sent', `Quote is ${q.status}`);
    await db.query("UPDATE quotes SET status = 'accepted', accepted_at = now() WHERE id = $1", [id]);
    const sys = systemPrincipal(p.tenantId);
    const opp = await this.records.getRaw(db, 'opportunities', q.opportunity_id);
    const patch: Record<string, unknown> = { expected_value: q.total, est_margin: q.margin, quote_valid_until: q.valid_until };
    const stages = (await this.metadata.stages(db)).map((s) => s.key);
    if (opp && stages.indexOf(String(opp.stage_key)) < stages.indexOf('negotiation')) patch.stage_key = 'negotiation';
    await this.records.update(db, sys, 'opportunities', q.opportunity_id, patch, { source: 'system' }).catch(async () => {
      delete patch.stage_key;
      await this.records.update(db, sys, 'opportunities', q.opportunity_id, patch, { source: 'system' });
    });
    await db.query("UPDATE supply_holds SET status = 'converted' WHERE opportunity_id = $1 AND status = 'active'", [q.opportunity_id]);
    await this.events.publish(db, p.tenantId, 'quotes.accepted', { id, opportunityId: q.opportunity_id });
    return this.getQuote(db, p, id);
  }

  /** FR-CPQ-10: compare quoted lines with current cost, price and lead time; flag what moved. */
  async revalidate(db: Db, p: Principal, id: string) {
    const q = await this.getQuote(db, systemPrincipal(p.tenantId), id);
    const d = await this.metadata.setting(db, 'cpq.defaults');
    const catalog = await this.catalog(db);
    const changes: { sku: string; kind: string; detail: string }[] = [];
    for (const l of q.lines ?? []) {
      const prod = catalog.find((c) => c.sku === l.sku);
      if (!prod) {
        changes.push({ sku: String(l.sku), kind: 'discontinued', detail: 'No longer in the catalogue' });
        continue;
      }
      const costMove = num(l.unit_cost) > 0 ? ((prod.cost - num(l.unit_cost)) / num(l.unit_cost)) * 100 : 0;
      if (Math.abs(costMove) >= d.revalidation_price_pct) {
        changes.push({ sku: prod.sku, kind: 'cost', detail: `Cost moved ${costMove > 0 ? '+' : ''}${costMove.toFixed(1)}%` });
      }
      const nowLead = prod.stock >= num(l.qty) ? 0 : prod.lead_time_weeks;
      if (nowLead - num(l.lead_time_weeks) >= d.revalidation_lead_time_weeks) {
        changes.push({ sku: prod.sku, kind: 'lead_time', detail: `Lead time now ${nowLead} weeks (quoted ${num(l.lead_time_weeks)})` });
      }
    }
    const daysLeft = Math.ceil((new Date(q.valid_until).getTime() - Date.now()) / 864e5);
    if (daysLeft <= 3 && ['approved', 'sent'].includes(q.status)) changes.push({ sku: '*', kind: 'expiry', detail: `Quote expires in ${Math.max(0, daysLeft)} days` });
    await db.query('UPDATE quotes SET revalidation = $2 WHERE id = $1', [id, JSON.stringify(changes)]);
    if (changes.length && ['approved', 'sent'].includes(q.status)) {
      await db.query(
        `INSERT INTO tasks (tenant_id, title, object, record_id, assignee_role, created_by)
         SELECT $1, $2, 'quotes', $3, 'rep', 'cpq' WHERE NOT EXISTS (SELECT 1 FROM tasks WHERE object = 'quotes' AND record_id = $3 AND status = 'open' AND title LIKE 'Re-quote%')`,
        [p.tenantId, `Re-quote ${q.number}: ${changes.map((c) => c.detail).join('; ')}`, id],
      );
    }
    return { quote: q.id, changes };
  }

  /** Worker sweep across a tenant: revalidate live quotes and expire past-dated ones. */
  async sweepQuotes(tenantId: string) {
    return this.dbs.tx(tenantId, async (db) => {
      await db.query("UPDATE quotes SET status = 'expired' WHERE status IN ('draft','pending_approval','approved','sent') AND valid_until < current_date");
      const live = await many<{ id: string }>(db, "SELECT id FROM quotes WHERE status IN ('approved','sent')");
      for (const q of live) await this.revalidate(db, systemPrincipal(tenantId), q.id);
      return live.length;
    });
  }

  // ---- datacentre readiness (FR-PIPE-04) -----------------------------------------------------

  async readiness(db: Db, opportunityId: string) {
    const opp = await this.records.getRaw(db, 'opportunities', opportunityId);
    if (!opp) throw notFound('Opportunity');
    const config = await this.configureFor(db, opportunityId);
    const items: { item: string; status: 'ok' | 'gap' | 'unknown'; detail: string }[] = [];
    const loc = opp.deployment_location as string | null;
    items.push({
      item: 'Deployment location',
      status: loc && loc !== 'unknown' ? 'ok' : 'unknown',
      detail: loc && loc !== 'unknown' ? loc.replace('_', ' ') : 'Ask where the systems will run: customer site, colocation or Uvation-hosted',
    });
    const kw = opp.kw_per_rack as number | null;
    const needed = config.summary.kw_per_rack_needed;
    items.push({
      item: 'Power per rack',
      status: kw == null ? 'unknown' : needed && kw < needed ? 'gap' : 'ok',
      detail: kw == null ? `Need about ${needed || '?'} kW per rack; available power not captured` : `${kw} kW available, ${needed} kW needed`,
    });
    const cooling = opp.cooling as string | null;
    items.push({
      item: 'Cooling',
      status: !cooling || cooling === 'unknown' ? 'unknown' : config.summary.cooling === 'liquid' && cooling !== 'liquid' ? 'gap' : 'ok',
      detail: !cooling || cooling === 'unknown' ? `Configuration needs ${config.summary.cooling} cooling; site cooling not captured` : `${cooling} at site; configuration needs ${config.summary.cooling}`,
    });
    items.push({ item: 'Floor loading', status: 'unknown', detail: `${config.summary.racks || '?'} racks; confirm floor loading for fully loaded GPU racks` });
    items.push({ item: 'Delivery access', status: 'unknown', detail: 'Confirm loading dock, lift and corridor clearance for crated racks' });
    items.push({ item: 'Network uplinks', status: config.summary.fabric ? 'ok' : 'unknown', detail: config.summary.fabric ? `${config.summary.fabric} fabric configured` : 'Single node; confirm uplink to the customer network' });
    for (const e of config.errors) items.push({ item: 'Configuration', status: 'gap', detail: e });
    const gaps = items.filter((i) => i.status !== 'ok').length;
    return { opportunityId, items, gaps, hostingOffer: items.some((i) => i.status === 'gap' && /Power|Cooling/.test(i.item)) ? 'Offer Uvation hosting / colocation' : null };
  }

  async readinessTasks(db: Db, p: Principal, opportunityId: string) {
    const r = await this.readiness(db, opportunityId);
    let created = 0;
    for (const i of r.items.filter((x) => x.status !== 'ok')) {
      const title = `Readiness: ${i.item}: ${i.detail}`;
      const res = await db.query(
        `INSERT INTO tasks (tenant_id, title, object, record_id, assignee_role, created_by)
         SELECT $1,$2,'opportunities',$3,'presales',$4 WHERE NOT EXISTS (SELECT 1 FROM tasks WHERE record_id = $3 AND title = $2 AND status = 'open')`,
        [p.tenantId, title, opportunityId, p.actorId],
      );
      created += res.rowCount ?? 0;
    }
    return { created, gaps: r.gaps };
  }

  // ---- mutual action plan (FR-PIPE-07) ------------------------------------------------------

  async milestones(db: Db, opportunityId: string) {
    return many(db, 'SELECT * FROM opportunity_milestones WHERE opportunity_id = $1 ORDER BY position, due_date', [opportunityId]);
  }

  async addMilestone(db: Db, p: Principal, opportunityId: string, body: unknown) {
    const m = validate(
      z.object({
        title: z.string().min(1).max(200),
        owner_side: z.enum(['uvation', 'customer']).default('uvation'),
        due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      }),
      body,
    );
    const pos = await one<{ n: number }>(db, 'SELECT count(*)::int AS n FROM opportunity_milestones WHERE opportunity_id = $1', [opportunityId]);
    return one(
      db,
      'INSERT INTO opportunity_milestones (tenant_id, opportunity_id, title, owner_side, due_date, position) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [p.tenantId, opportunityId, m.title, m.owner_side, m.due_date ?? null, pos!.n],
    );
  }

  async defaultPlan(db: Db, p: Principal, opportunityId: string) {
    const existing = await this.milestones(db, opportunityId);
    if (existing.length) return existing;
    const steps: [string, 'uvation' | 'customer', number][] = [
      ['Requirements and site readiness confirmed', 'customer', 7],
      ['Solution design and BOM agreed', 'uvation', 14],
      ['Quote approved and sent', 'uvation', 21],
      ['End-user statement and compliance clearance', 'customer', 28],
      ['Customer PO issued', 'customer', 35],
      ['Systems shipped', 'uvation', 63],
      ['Installation and cluster validation', 'uvation', 77],
      ['Acceptance sign-off', 'customer', 84],
    ];
    for (const [i, [title, side, days]] of steps.entries()) {
      await db.query(
        'INSERT INTO opportunity_milestones (tenant_id, opportunity_id, title, owner_side, due_date, position) VALUES ($1,$2,$3,$4, current_date + $5::int, $6)',
        [p.tenantId, opportunityId, title, side, days, i],
      );
    }
    return this.milestones(db, opportunityId);
  }

  async updateMilestone(db: Db, id: string, body: unknown) {
    const m = validate(z.object({ status: z.enum(['open', 'done', 'at_risk']).optional(), due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }), body);
    const row = await one(db, 'UPDATE opportunity_milestones SET status = coalesce($2, status), due_date = coalesce($3::date, due_date) WHERE id = $1 RETURNING *', [
      id,
      m.status ?? null,
      m.due_date ?? null,
    ]);
    if (!row) throw notFound('Milestone');
    return row;
  }
}
