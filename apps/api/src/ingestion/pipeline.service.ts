import { Injectable, Logger } from '@nestjs/common';
import { Db, DbService, many, one } from '../db/db.service';
import { Principal } from '../common/principal';
import { MetadataService } from '../metadata/metadata.service';
import { RecordsService } from '../records/records.service';
import { redactCardNumbers, stripTransactionData } from '../records/transaction-guardrail';
import { captureSkipReason, externalParticipants, isInternal } from './capture-rules';
import { IdentityService, ResolvedIdentity } from './identity.service';
import { NormalizedEvent, Source } from './normalized-event';
import { normalize } from './normalizers/normalizers';
import { heuristicSignals } from '../llm/heuristic.provider';

export interface IngestResult {
  id: string;
  status: 'processed' | 'skipped' | 'failed' | 'received';
  duplicate: boolean;
  skipReason?: string | null;
  linked?: Record<string, unknown>;
  error?: string;
}

const integration = (tenantId: string, source: Source): Principal => ({
  tenantId,
  kind: 'integration',
  actorId: source,
  roles: ['integration'],
});

const ACTIVITY_TYPE = { email: 'email', meeting: 'meeting', call: 'call', chat: 'chat' } as const;

/**
 * The data pipeline (tech spec 6, FR-CH-01, FR-CAP-01): ingest -> normalise -> privacy rules ->
 * identity match -> map to CRM records -> one customer timeline. Events are stored first and
 * processed idempotently, so a failed event can be replayed.
 */
@Injectable()
export class PipelineService {
  private readonly log = new Logger('Pipeline');

  constructor(
    private readonly dbs: DbService,
    private readonly records: RecordsService,
    private readonly identity: IdentityService,
    private readonly metadata: MetadataService,
  ) {}

  async ingest(tenantId: string, source: Source, raw: unknown): Promise<IngestResult> {
    const event = normalize(source, raw);
    const stored = stripTransactionData(raw);
    const inserted = await this.dbs.tx(tenantId, (db) =>
      one<{ id: string }>(
        db,
        `INSERT INTO channel_events (tenant_id, source, type, external_id, payload) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (tenant_id, source, external_id) DO NOTHING RETURNING id`,
        [tenantId, source, event.type, event.externalId, JSON.stringify(stored)],
      ),
    );
    if (!inserted) {
      const existing = await this.dbs.tx(tenantId, (db) =>
        one<{ id: string; status: IngestResult['status']; skip_reason: string | null; linked: Record<string, unknown> }>(
          db,
          'SELECT id, status, skip_reason, linked FROM channel_events WHERE source = $1 AND external_id = $2',
          [source, event.externalId],
        ),
      );
      return { id: existing!.id, status: existing!.status, duplicate: true, skipReason: existing!.skip_reason, linked: existing!.linked };
    }
    return { ...(await this.process(tenantId, inserted.id, event)), duplicate: false };
  }

  /** Re-run a stored event (after a fix or for a failed event). */
  async replay(tenantId: string, id: string): Promise<IngestResult> {
    const row = await this.dbs.tx(tenantId, (db) =>
      one<{ source: Source; payload: unknown; status: string }>(db, 'SELECT source, payload, status FROM channel_events WHERE id = $1', [id]),
    );
    if (!row) throw new Error('event not found');
    if (row.status === 'processed') return { id, status: 'processed', duplicate: true };
    return { ...(await this.process(tenantId, id, normalize(row.source, row.payload))), duplicate: false };
  }

  private async process(tenantId: string, id: string, event: NormalizedEvent): Promise<Omit<IngestResult, 'duplicate'>> {
    try {
      return await this.dbs.tx(tenantId, async (db) => {
        const rules = await this.metadata.setting(db, 'capture.rules');
        const skip = captureSkipReason(rules, event);
        if (skip) {
          await db.query("UPDATE channel_events SET status = 'skipped', skip_reason = $2, processed_at = now(), attempts = attempts + 1 WHERE id = $1", [id, skip]);
          return { id, status: 'skipped' as const, skipReason: skip };
        }
        const p = integration(tenantId, event.source);
        const linked = await this.map(db, p, id, event);
        await db.query("UPDATE channel_events SET status = 'processed', linked = $2, processed_at = now(), attempts = attempts + 1, error = NULL WHERE id = $1", [
          id,
          JSON.stringify(linked),
        ]);
        return { id, status: 'processed' as const, linked };
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log.error(`event ${id} (${event.source}/${event.type}) failed: ${message}`);
      await this.dbs.tx(tenantId, (db) =>
        db.query("UPDATE channel_events SET status = 'failed', error = $2, attempts = attempts + 1 WHERE id = $1", [id, message.slice(0, 2000)]),
      );
      return { id, status: 'failed', error: message };
    }
  }

  private async customerIdentity(db: Db, p: Principal, event: NormalizedEvent): Promise<ResolvedIdentity> {
    const rules = await this.metadata.setting(db, 'capture.rules');
    if (event.customer && (event.customer.email || event.customer.phone || event.customer.marketplaceUserId || event.customer.uspUserId)) {
      return this.identity.resolve(db, p, rules, event.customer, event.source);
    }
    const ext = event.communication ? externalParticipants(rules, event.communication.participants) : [];
    const primary = ext.find((x) => x.role === 'from') ?? ext[0];
    if (!primary) return { accountId: null, contactId: null, created: { account: false, contact: false } };
    const resolved = await this.identity.resolve(db, p, rules, { email: primary.email, name: primary.name, phone: primary.phone }, event.source);
    // Every other external participant becomes a contact too (buying committee).
    for (const other of ext.filter((x) => x !== primary && x.email)) {
      await this.identity.resolve(db, p, rules, { email: other.email, name: other.name }, event.source);
    }
    return resolved;
  }

  private async activity(db: Db, p: Principal, eventId: string, event: NormalizedEvent, who: ResolvedIdentity, opportunityId: string | null, extra: Record<string, unknown> = {}) {
    const rules = await this.metadata.setting(db, 'capture.rules');
    const c = event.communication;
    const from = c?.participants.find((x) => x.role === 'from');
    const direction = !c ? 'inbound' : from?.email && isInternal(rules, from.email) ? 'outbound' : 'inbound';
    const rec = await this.records.create(db, p, 'activities', {
      account_id: who.accountId,
      contact_id: who.contactId,
      opportunity_id: opportunityId,
      type: c ? ACTIVITY_TYPE[c.channel] : 'web',
      source: event.source,
      direction,
      subject: c?.subject ?? null,
      body: c ? redactCardNumbers(c.body) : null,
      occurred_at: event.occurredAt,
      participants: c?.participants ?? [],
      thread_id: c?.threadId ?? null,
      ...extra,
    });
    await db.query('UPDATE activities SET channel_event_id = $2 WHERE id = $1', [rec.id, eventId]);
    return rec.id;
  }

  private async newLead(db: Db, p: Principal, event: NormalizedEvent, who: ResolvedIdentity, summary: string, opportunityName: string) {
    const opp = await this.records.create(db, p, 'opportunities', {
      account_id: who.accountId,
      primary_contact_id: who.contactId,
      name: opportunityName,
      type: 'hardware',
      channel: event.source === 'outlook' ? 'outlook' : event.source,
    });
    const lead = await this.records.create(db, p, 'leads', {
      account_id: who.accountId,
      contact_id: who.contactId,
      opportunity_id: opp.id,
      channel: event.source === 'outlook' ? 'outlook' : event.source,
      source: event.type,
      summary: summary.slice(0, 20000),
    });
    return { opportunityId: opp.id, leadId: lead.id };
  }

  private async accountName(db: Db, accountId: string | null, fallback = 'New customer'): Promise<string> {
    if (!accountId) return fallback;
    return (await one<{ name: string }>(db, 'SELECT name FROM accounts WHERE id = $1', [accountId]))?.name ?? fallback;
  }

  /** Maps a normalised event onto CRM records. Returns the ids it touched. */
  private async map(db: Db, p: Principal, eventId: string, event: NormalizedEvent): Promise<Record<string, unknown>> {
    const who = await this.customerIdentity(db, p, event);
    const rules = await this.metadata.setting(db, 'capture.rules');
    const base = { accountId: who.accountId, contactId: who.contactId, createdAccount: who.created.account, createdContact: who.created.contact };
    const d = event.data;
    const text = (v: unknown) => (typeof v === 'string' ? v : '');

    switch (event.kind) {
      case 'communication': {
        const c = event.communication!;
        // New external thread to a shared sales mailbox becomes a lead (FR-CAP-03).
        if (c.mailbox && rules.lead_mailboxes.includes(c.mailbox)) {
          const open = await this.identity.openOpportunity(db, who.accountId);
          if (!open) {
            const name = await this.accountName(db, who.accountId);
            const summary = [c.subject, c.body].filter(Boolean).join('\n\n');
            const signals = heuristicSignals(summary);
            const { opportunityId, leadId } = await this.newLead(db, p, event, who, summary, `${name}: ${signals.gpu_model ?? 'AI servers'} enquiry`);
            const activityId = await this.activity(db, p, eventId, event, who, opportunityId);
            return { ...base, activityId, leadId, opportunityId };
          }
        }
        const opportunityId = await this.identity.openOpportunity(db, who.accountId);
        const activityId = await this.activity(db, p, eventId, event, who, opportunityId);
        return { ...base, activityId, opportunityId };
      }
      case 'rfq': {
        const name = await this.accountName(db, who.accountId, event.customer?.company ?? 'Marketplace buyer');
        const summary = [text(d.message), text(d.configuration), d.gpu_model ? `GPU: ${text(d.gpu_model)}` : '', d.quantity ? `Quantity: ${String(d.quantity)}` : '']
          .filter(Boolean)
          .join('\n');
        const signals = heuristicSignals(summary);
        const { opportunityId, leadId } = await this.newLead(db, p, event, who, summary, `${name}: ${signals.gpu_model || text(d.gpu_model) || 'AI servers'} RFQ`);
        const activityId = await this.activity(db, p, eventId, event, who, opportunityId, { type: 'web', subject: 'Marketplace request for quote', body: summary });
        return { ...base, leadId, opportunityId, activityId };
      }
      case 'signup':
      case 'behaviour': {
        const activityId = await this.activity(db, p, eventId, event, who, await this.identity.openOpportunity(db, who.accountId), {
          type: 'web',
          subject: event.kind === 'signup' ? `${event.source === 'usp' ? 'USP' : 'Marketplace'} sign-up` : `Viewed ${text(d.product) || 'a product'}`,
          body: null,
        });
        return { ...base, activityId };
      }
      case 'cart': {
        const opportunityId = await this.identity.openOpportunity(db, who.accountId);
        const items = Array.isArray(d.items) ? (d.items as { name?: string; sku?: string; qty?: number }[]) : [];
        const body = items.map((i) => `${i.qty ?? 1} x ${i.name ?? i.sku ?? 'item'}`).join('\n');
        const activityId = await this.activity(db, p, eventId, event, who, opportunityId, { type: 'cart', subject: 'Abandoned Marketplace cart', body });
        const routing = await this.metadata.setting(db, 'routing.rules');
        const value = Number(d.cart_value ?? 0);
        let taskId: string | null = null;
        if (value >= routing.assisted_min_value) {
          taskId = (
            await one<{ id: string }>(
              db,
              "INSERT INTO tasks (tenant_id, title, object, record_id, assignee_role, created_by) VALUES ($1,$2,'activities',$3,'rep','pipeline') RETURNING id",
              [p.tenantId, `Follow up abandoned cart worth ${value.toLocaleString('en-US')} from ${await this.accountName(db, who.accountId)}`, activityId],
            )
          )!.id;
        }
        return { ...base, activityId, opportunityId, taskId };
      }
      case 'order': {
        // The order itself is processed outside the CRM (NetSuite later); ATLAS-I keeps the reference only (FR-CH-07).
        const reference = text(d.order_reference) || event.externalId;
        const name = await this.accountName(db, who.accountId, 'Marketplace buyer');
        const opp = await this.records.create(db, p, 'opportunities', {
          account_id: who.accountId,
          primary_contact_id: who.contactId,
          name: `${name}: Marketplace order ${reference}`,
          type: 'hardware',
          channel: 'marketplace',
          order_reference: reference,
          gpu_model: text(d.gpu_model) || null,
          gpu_count: typeof d.gpu_count === 'number' ? d.gpu_count : null,
          destination_country: text(d.ship_to_country) || null,
          stage_key: 'compliance_check',
        });
        const task = await one<{ id: string }>(
          db,
          "INSERT INTO tasks (tenant_id, title, object, record_id, assignee_role, created_by) VALUES ($1,$2,'opportunities',$3,'trade_compliance','pipeline') RETURNING id",
          [p.tenantId, `Screen Marketplace order ${reference} before fulfilment`, opp.id],
        );
        const activityId = await this.activity(db, p, eventId, event, who, opp.id, { type: 'order', subject: `Marketplace order ${reference}`, body: null });
        return { ...base, opportunityId: opp.id, activityId, taskId: task!.id };
      }
      case 'service_request': {
        const name = await this.accountName(db, who.accountId);
        const opp = await this.records.create(db, p, 'opportunities', {
          account_id: who.accountId,
          primary_contact_id: who.contactId,
          name: `${name}: ${text(d.service_type) || 'service'} request`,
          type: 'service',
          channel: 'usp',
        });
        const activityId = await this.activity(db, p, eventId, event, who, opp.id, {
          type: 'service_request',
          subject: text(d.subject) || 'USP service request',
          body: text(d.description) || null,
        });
        return { ...base, opportunityId: opp.id, activityId };
      }
      case 'ticket': {
        const activityId = await this.activity(db, p, eventId, event, who, await this.identity.openOpportunity(db, who.accountId), {
          type: 'ticket',
          subject: `${event.type === 'rma' ? 'RMA' : 'Support ticket'}: ${text(d.subject)}`,
          body: text(d.description) || null,
        });
        return { ...base, activityId };
      }
      case 'contract_expiring': {
        const name = await this.accountName(db, who.accountId);
        const opp = await this.records.create(db, p, 'opportunities', {
          account_id: who.accountId,
          primary_contact_id: who.contactId,
          name: `${name}: renewal of ${text(d.contract_name) || 'support contract'}`,
          type: 'renewal',
          channel: 'usp',
        });
        return { ...base, opportunityId: opp.id };
      }
    }
  }

  async failed(tenantId: string) {
    return this.dbs.tx(tenantId, (db) =>
      many(db, "SELECT id, source, type, external_id, error, attempts, received_at FROM channel_events WHERE status = 'failed' ORDER BY received_at DESC LIMIT 200"),
    );
  }
}
