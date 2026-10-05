import { Injectable, OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import { Db, DbService, many, one } from '../db/db.service';
import { DomainEvent, EventBus } from '../events/event-bus';
import { MetadataService } from '../metadata/metadata.service';
import { RecordsService } from '../records/records.service';
import { Principal, hasRole, systemPrincipal } from '../common/principal';
import { conflict, forbidden, notFound, unprocessable } from '../common/errors';
import { validate } from '../common/validate';

export interface Party {
  role: 'customer' | 'end_user' | 'contact';
  name: string;
  country?: string | null;
}

export interface Match {
  party: string;
  listed: string;
  list: string;
  score: number;
}

const tokens = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 1 && !['ltd', 'limited', 'inc', 'llc', 'co', 'corp', 'the', 'group', 'gmbh', 'pvt', 'plc'].includes(t)),
  );

/** Token overlap similarity in 0..1; good enough to surface candidates for a human to review. */
export function similarity(a: string, b: string): number {
  const A = tokens(a);
  const B = tokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / Math.min(A.size, B.size);
}

export function screenParties(parties: Party[], list: { name: string; aliases: string[]; list_name: string }[], threshold = 0.67): Match[] {
  const out: Match[] = [];
  for (const p of parties) {
    for (const r of list) {
      const best = Math.max(similarity(p.name, r.name), ...r.aliases.map((a) => similarity(p.name, a)));
      if (best >= threshold) out.push({ party: p.name, listed: r.name, list: r.list_name, score: Math.round(best * 100) / 100 });
    }
  }
  return out;
}

export function redFlags(text: string, phrases: string[]): string[] {
  const t = text.toLowerCase();
  return phrases.filter((p) => t.includes(p.toLowerCase()));
}

/**
 * Trade compliance (FR-CMP-01..05): restricted-party screening, export classification and licence
 * review by destination, end-user statements, red-flag detection in communications, and the
 * clearance decision, which only Trade Compliance can make and which is always recorded.
 */
@Injectable()
export class ComplianceService implements OnModuleInit {
  constructor(
    private readonly dbs: DbService,
    private readonly records: RecordsService,
    private readonly metadata: MetadataService,
    private readonly events: EventBus,
  ) {}

  onModuleInit() {
    // Screen at qualification and whenever the destination or end user changes (FR-CMP-01).
    this.events.subscribe('opportunities.created', 'compliance-screen', (e) => this.autoScreen(e));
    this.events.subscribe('opportunities.updated', 'compliance-screen', (e) => {
      const changed = (e.payload.changed as string[]) ?? [];
      return changed.some((c) => ['end_user', 'destination_country', 'account_id'].includes(c)) ? this.autoScreen(e) : Promise.resolve();
    });
    this.events.subscribe('activities.created', 'compliance-red-flags', (e) => this.scanActivity(e));
  }

  private async autoScreen(e: DomainEvent) {
    await this.dbs.tx(e.tenantId, async (db) => {
      const opp = await this.records.getRaw(db, 'opportunities', String(e.payload.id));
      if (!opp || opp.compliance_status === 'cleared' || opp.compliance_status === 'blocked') return;
      await this.screen(db, systemPrincipal(e.tenantId), opp.id);
    });
  }

  private async scanActivity(e: DomainEvent) {
    if (e.payload.source === 'system') return;
    await this.dbs.tx(e.tenantId, async (db) => {
      const a = await this.records.getRaw(db, 'activities', String(e.payload.id));
      if (!a?.body || !a.opportunity_id || a.direction === 'outbound') return;
      const rules = await this.metadata.setting(db, 'compliance.rules');
      const hits = redFlags(`${a.subject ?? ''} ${a.body}`, rules.red_flag_phrases);
      if (!hits.length) return;
      await db.query(
        `INSERT INTO compliance_checks (tenant_id, opportunity_id, kind, result, notes) VALUES ($1,$2,'red_flag','red_flag',$3)`,
        [e.tenantId, a.opportunity_id, `Red flags in ${String(a.type)} "${String(a.subject ?? '')}": ${hits.join(', ')}`],
      );
      const opp = await this.records.getRaw(db, 'opportunities', String(a.opportunity_id));
      if (opp && opp.compliance_status !== 'blocked') {
        await this.records.update(db, systemPrincipal(e.tenantId), 'opportunities', opp.id, { compliance_status: 'flagged' }, { source: 'system' });
      }
      await db.query(
        "INSERT INTO tasks (tenant_id, title, object, record_id, assignee_role, created_by) VALUES ($1,$2,'opportunities',$3,'trade_compliance','compliance')",
        [e.tenantId, `Review red flags on ${String(opp?.name ?? 'deal')}: ${hits.join(', ')}`, a.opportunity_id],
      );
    });
  }

  /** Screen customer, end user and contacts, classify the BOM, and decide whether a licence review is needed. */
  async screen(db: Db, p: Principal, opportunityId: string) {
    const opp = await this.records.getRaw(db, 'opportunities', opportunityId);
    if (!opp) throw notFound('Opportunity');
    const account = opp.account_id ? await this.records.getRaw(db, 'accounts', String(opp.account_id)) : undefined;
    const contacts = opp.account_id ? await many<{ name: string | null }>(db, 'SELECT name FROM contacts WHERE account_id = $1 AND deleted_at IS NULL', [opp.account_id]) : [];
    const rules = await this.metadata.setting(db, 'compliance.rules');
    const parties: Party[] = [
      ...(account ? [{ role: 'customer' as const, name: String(account.name), country: (account.hq_country as string) ?? null }] : []),
      ...(opp.end_user ? [{ role: 'end_user' as const, name: String(opp.end_user), country: (opp.destination_country as string) ?? null }] : []),
      ...contacts.filter((c) => c.name).map((c) => ({ role: 'contact' as const, name: String(c.name) })),
    ];
    const list = await many<{ name: string; aliases: string[]; list_name: string }>(db, 'SELECT name, aliases, list_name FROM restricted_parties');
    const matches = screenParties(parties, list);

    // Classification from the latest quote's lines, else from the GPU model on the deal.
    const lines = await many<{ sku: string; export_class: string }>(
      db,
      `SELECT DISTINCT ql.sku, ql.export_class FROM quote_lines ql JOIN quotes q ON q.id = ql.quote_id
        WHERE q.opportunity_id = $1 AND q.status NOT IN ('superseded','withdrawn') AND q.version = (SELECT max(version) FROM quotes WHERE opportunity_id = $1)`,
      [opportunityId],
    );
    const classification = lines.length
      ? lines
      : opp.gpu_model
        ? [{ sku: String(opp.gpu_model), export_class: /L40|RTX/i.test(String(opp.gpu_model)) ? '5A992' : '4A090' }]
        : [];
    const controlled = classification.filter((c) => rules.controlled_classes.includes(c.export_class));
    const dest = (opp.destination_country as string) ?? null;
    const embargoed = !!dest && rules.embargoed_countries.some((c) => c.toLowerCase() === dest.toLowerCase());
    const review = !!dest && rules.licence_review_countries.some((c) => c.toLowerCase() === dest.toLowerCase());

    let result: 'clear' | 'potential_match' | 'licence_required' | 'blocked' = 'clear';
    let determination = dest ? `No licence indicated for ${dest} on current classification` : 'Destination unknown: collect it before clearance';
    if (embargoed) {
      result = 'blocked';
      determination = `${dest} is embargoed`;
    } else if (matches.length) {
      result = 'potential_match';
      determination = 'Potential restricted-party match: hold until reviewed';
    } else if (review && controlled.length) {
      result = 'licence_required';
      determination = `Controlled items (${controlled.map((c) => c.export_class).join(', ')}) to ${dest}: licence determination required`;
    }
    const check = await one<{ id: string }>(
      db,
      `INSERT INTO compliance_checks (tenant_id, opportunity_id, kind, result, parties, matches, classification, licence_determination, decided_by)
       VALUES ($1,$2,'screening',$3,$4,$5,$6,$7,$8) RETURNING id`,
      [p.tenantId, opportunityId, result, JSON.stringify(parties), JSON.stringify(matches), JSON.stringify(classification), determination, p.actorId],
    );
    const status = result === 'blocked' ? 'blocked' : result === 'clear' ? 'screening' : 'flagged';
    if (opp.compliance_status !== 'cleared' && opp.compliance_status !== status) {
      await this.records.update(db, systemPrincipal(p.tenantId), 'opportunities', opportunityId, { compliance_status: status }, { source: 'system' });
    }
    if (result !== 'clear') {
      await db.query(
        `INSERT INTO tasks (tenant_id, title, object, record_id, assignee_role, created_by)
         SELECT $1,$2,'opportunities',$3,'trade_compliance','compliance'
          WHERE NOT EXISTS (SELECT 1 FROM tasks WHERE record_id = $3 AND assignee_role = 'trade_compliance' AND status = 'open' AND title = $2)`,
        [p.tenantId, `Compliance review for ${String(opp.name)}: ${determination}`, opportunityId],
      );
    }
    await this.events.publish(db, p.tenantId, 'compliance.screened', { opportunityId, result });
    return { id: check!.id, result, matches, classification, determination, parties };
  }

  /** FR-CMP-03: track the end-user statement. Request drafts a task for the rep; receive records it. */
  async endUserStatement(db: Db, p: Principal, opportunityId: string, action: 'request' | 'receive', body: unknown) {
    const opp = await this.records.getRaw(db, 'opportunities', opportunityId);
    if (!opp) throw notFound('Opportunity');
    const input = validate(z.object({ reference: z.string().max(200).optional() }), body ?? {});
    if (action === 'request') {
      await this.records.update(db, systemPrincipal(p.tenantId), 'opportunities', opportunityId, { eus_status: 'requested' }, { source: 'system' });
      await db.query(
        "INSERT INTO tasks (tenant_id, title, object, record_id, assignee_role, created_by) VALUES ($1,$2,'opportunities',$3,'rep',$4)",
        [p.tenantId, `Send the end-user statement for e-signature: ${String(opp.name)}`, opportunityId, p.actorId],
      );
    } else {
      if (!hasRole(p, 'trade_compliance', 'rep', 'sales_leader')) throw forbidden('role_required', 'Not allowed');
      await this.records.update(db, systemPrincipal(p.tenantId), 'opportunities', opportunityId, { eus_status: 'received' }, { source: 'system' });
      await db.query(
        "INSERT INTO compliance_checks (tenant_id, opportunity_id, kind, result, notes, decided_by) VALUES ($1,$2,'decision','clear',$3,$4)",
        [p.tenantId, opportunityId, `End-user statement received${input.reference ? `: ${input.reference}` : ''}`, p.actorId],
      );
    }
    return this.records.getRaw(db, 'opportunities', opportunityId);
  }

  /** FR-CMP-04: only Trade Compliance clears or blocks; every decision is recorded. */
  async decide(db: Db, p: Principal, opportunityId: string, body: unknown) {
    if (!hasRole(p, 'trade_compliance') || p.kind !== 'user') throw forbidden('trade_compliance_only', 'Only Trade Compliance can clear or block a deal');
    const input = validate(z.object({ decision: z.enum(['cleared', 'blocked']), notes: z.string().max(2000).optional(), licence_reference: z.string().max(100).optional() }), body);
    const opp = await this.records.getRaw(db, 'opportunities', opportunityId);
    if (!opp) throw notFound('Opportunity');
    const last = await one<{ result: string }>(db, "SELECT result FROM compliance_checks WHERE opportunity_id = $1 AND kind = 'screening' ORDER BY created_at DESC LIMIT 1", [opportunityId]);
    if (input.decision === 'cleared') {
      if (!last) throw unprocessable('not_screened', 'Screen the deal before clearing it');
      if (last.result === 'blocked') throw conflict('embargoed', 'Embargoed destination: cannot be cleared');
      if (last.result === 'licence_required' && !input.licence_reference) throw unprocessable('licence_reference_required', 'Record the licence or licence exception reference');
      if (opp.eus_status !== 'received') throw unprocessable('eus_required', 'The end-user statement has not been received');
    }
    await db.query(
      "INSERT INTO compliance_checks (tenant_id, opportunity_id, kind, result, notes, licence_determination, decided_by) VALUES ($1,$2,'decision',$3,$4,$5,$6)",
      [p.tenantId, opportunityId, input.decision === 'cleared' ? 'cleared' : 'rejected', input.notes ?? null, input.licence_reference ?? null, p.actorId],
    );
    const { record } = await this.records.update(db, p, 'opportunities', opportunityId, { compliance_status: input.decision });
    await db.query("UPDATE tasks SET status = 'done' WHERE record_id = $1 AND assignee_role = 'trade_compliance' AND status = 'open'", [opportunityId]);
    return record;
  }

  async checks(db: Db, opportunityId: string) {
    return many(db, 'SELECT * FROM compliance_checks WHERE opportunity_id = $1 ORDER BY created_at DESC', [opportunityId]);
  }

  /** Compliance work queue: deals waiting on Trade Compliance, worst first. */
  async queue(db: Db) {
    return many(
      db,
      `SELECT o.id, o.name, o.stage_key, o.compliance_status, o.eus_status, o.destination_country, o.end_user, o.gpu_model, o.gpu_count, o.channel,
              a.name AS account_name,
              (SELECT row_to_json(c) FROM (SELECT result, licence_determination, matches, created_at FROM compliance_checks
                 WHERE opportunity_id = o.id AND kind = 'screening' ORDER BY created_at DESC LIMIT 1) c) AS last_screening,
              (SELECT count(*)::int FROM compliance_checks WHERE opportunity_id = o.id AND kind = 'red_flag') AS red_flags
         FROM opportunities o LEFT JOIN accounts a ON a.id = o.account_id
        WHERE o.deleted_at IS NULL AND o.compliance_status IN ('not_screened','screening','flagged','blocked')
          AND o.stage_key NOT IN ('closed_won','closed_lost')
        ORDER BY CASE o.compliance_status WHEN 'blocked' THEN 0 WHEN 'flagged' THEN 1 WHEN 'screening' THEN 2 ELSE 3 END, o.updated_at DESC
        LIMIT 200`,
    );
  }
}
