import { Injectable, OnModuleInit } from '@nestjs/common';
import { Db, DbService, one } from '../../db/db.service';
import { DomainEvent, EventBus } from '../../events/event-bus';
import { LlmService } from '../../llm/llm.service';
import { Signals } from '../../llm/signals';
import { MetadataService } from '../../metadata/metadata.service';
import { RecordsService, Row } from '../../records/records.service';
import { AgentRuntime } from '../agent-runtime.service';
import { opportunityPatch } from './signal-fields';

export interface LeadScore {
  fit: number;
  intent: number;
  reasons: { reason: string; points: number; quote?: string }[];
  qualified: boolean;
}

/** Transparent, explainable scoring (FR-LEAD-03): every point has a reason, most with a quote. */
export function scoreLead(signals: Signals, ctx: { businessDomain: boolean; segment?: string | null; namedAccount: boolean }): LeadScore {
  const reasons: LeadScore['reasons'] = [];
  const quote = (f: string) => signals.evidence.find((e) => e.field === f)?.quote;
  let fit = 0;
  let intent = 0;
  const add = (kind: 'fit' | 'intent', points: number, reason: string, q?: string) => {
    if (kind === 'fit') fit += points;
    else intent += points;
    reasons.push({ reason, points, quote: q });
  };

  if (ctx.businessDomain) add('fit', 20, 'Business email domain');
  if (ctx.namedAccount) add('fit', 25, 'Named account');
  if (ctx.segment && ['enterprise', 'ai_native', 'gpu_cloud', 'research'].includes(ctx.segment)) add('fit', 10, `Segment: ${ctx.segment}`);
  if (signals.gpu_model) add('fit', 15, `Asks for ${signals.gpu_model}`, quote('gpu_model'));
  const gpus = signals.gpu_count ?? (signals.node_count ? signals.node_count * 8 : null);
  if (gpus && gpus >= 64) add('fit', 30, `${gpus} GPUs: large deployment`, quote('gpu_count') ?? quote('node_count'));
  else if (gpus && gpus >= 8) add('fit', 20, `${gpus} GPUs`, quote('gpu_count') ?? quote('node_count'));
  if (signals.workload && signals.workload !== 'unknown') add('fit', 5, `Workload: ${signals.workload}`, quote('workload'));

  if (signals.intent === 'rfq') add('intent', 45, 'Asks for a quote', signals.summary);
  if (signals.intent === 'purchase_order') add('intent', 60, 'Mentions a purchase order', signals.summary);
  if (signals.timeline) add('intent', 25, `Timeline given: ${signals.timeline}`, quote('timeline'));
  if (signals.deployment_location && signals.deployment_location !== 'unknown') add('intent', 10, 'Deployment site known', quote('deployment_location'));

  fit = Math.min(100, fit);
  intent = Math.min(100, intent);
  return { fit, intent, reasons, qualified: fit >= 40 && intent >= 40 };
}

/** Qualifying questions for whatever the enquiry did not say (FR-LEAD-04). */
export function qualifyingQuestions(signals: Signals): string[] {
  const q: string[] = [];
  if (!signals.workload || signals.workload === 'unknown') q.push('What will the systems be used for: training, fine-tuning or inference?');
  if (!signals.gpu_model) q.push('Do you have a GPU model in mind (for example H200, B200 or GB200 NVL72), or should we recommend one?');
  if (!signals.gpu_count && !signals.node_count) q.push('How many GPUs or servers do you need now, and over the next 12 months?');
  if (!signals.deployment_location || signals.deployment_location === 'unknown')
    q.push('Where will they run: your own datacentre, a colocation site, or hosted by Uvation?');
  if (!signals.cooling || signals.cooling === 'unknown') q.push('How much power per rack is available, and is liquid cooling an option?');
  if (!signals.timeline) q.push('When do you need the systems installed?');
  q.push('Who is the end user, and which country will the systems be shipped to?');
  return q;
}

/**
 * Inbound SDR agent: scores and routes each new lead, fills opportunity fields from the enquiry,
 * and drafts the first reply from an approved template (sent automatically only once its outbound
 * mode is switched to autonomous).
 */
@Injectable()
export class InboundSdrAgent implements OnModuleInit {
  static readonly id = 'inbound_sdr';

  constructor(
    private readonly events: EventBus,
    private readonly dbs: DbService,
    private readonly records: RecordsService,
    private readonly runtime: AgentRuntime,
    private readonly llm: LlmService,
    private readonly metadata: MetadataService,
  ) {}

  onModuleInit() {
    this.events.subscribe('leads.created', 'inbound-sdr-agent', (e) => this.onLead(e));
  }

  private async pickRep(db: Db, pool: readonly string[]): Promise<string | null> {
    if (!pool.length) return null;
    // Least-loaded rep over the last 7 days.
    const loads = await Promise.all(
      pool.map(async (id) => ({
        id,
        n: Number(
          (await one<{ n: string }>(db, "SELECT count(*) AS n FROM leads WHERE routed_to = $1 AND created_at > now() - interval '7 days'", [id]))?.n ?? 0,
        ),
      })),
    );
    loads.sort((a, b) => a.n - b.n);
    return loads[0].id;
  }

  async onLead(event: DomainEvent) {
    await this.dbs.tx(event.tenantId, async (db) => {
      const lead = await this.records.getRaw(db, 'leads', String(event.payload.id));
      if (!lead || lead.status !== 'new') return;
      const contact = lead.contact_id ? await this.records.getRaw(db, 'contacts', String(lead.contact_id)) : undefined;
      const account = lead.account_id ? await this.records.getRaw(db, 'accounts', String(lead.account_id)) : undefined;
      const opp = lead.opportunity_id ? await this.records.getRaw(db, 'opportunities', String(lead.opportunity_id)) : undefined;

      const text = String(lead.summary ?? '');
      const { signals, model, promptVersion } = await this.llm.extractSignals(db, event.tenantId, InboundSdrAgent.id, text);
      const routing = await this.metadata.setting(db, 'routing.rules');
      const capture = await this.metadata.setting(db, 'capture.rules');
      const domain = String(account?.domain ?? contact?.email ?? '').split('@').pop()?.toLowerCase() ?? '';
      const namedAccount = !!domain && routing.named_account_domains.includes(domain);
      const score = scoreLead(signals, {
        businessDomain: !!account?.domain && !capture.personal_domains.includes(domain),
        segment: (account?.segment as string) ?? null,
        namedAccount,
      });

      const gpus = signals.gpu_count ?? (signals.node_count ? signals.node_count * 8 : 0);
      const assisted =
        namedAccount ||
        gpus >= routing.assisted_min_gpu_count ||
        Number(opp?.expected_value ?? 0) >= routing.assisted_min_value ||
        lead.channel !== 'marketplace';
      const rep = score.qualified && assisted ? await this.pickRep(db, routing.rep_pool) : null;
      const runId = this.runtime.newRun();

      await this.runtime.propose(db, event.tenantId, InboundSdrAgent.id, runId, {
        type: 'update_fields',
        target: { object: 'leads', id: lead.id },
        payload: {
          fields: {
            fit_score: score.fit,
            intent_score: score.intent,
            score_reasons: score.reasons,
            status: score.qualified ? 'qualified' : 'nurture',
            ...(rep ? { routed_to: rep } : {}),
          },
          routing: assisted ? 'assisted' : 'self_serve',
        },
        confidence: signals.confidence,
        evidence: signals.evidence,
        summary: `Score lead: fit ${score.fit}, intent ${score.intent}, ${score.qualified ? 'qualified' : 'nurture'}${rep ? ', routed to a rep' : ''}`,
        model,
        promptVersion,
      });

      if (opp) {
        const humanSet = await this.records.humanSetFields(db, 'opportunities', opp.id);
        const { fields, evidence } = opportunityPatch(signals, opp, humanSet);
        if (rep && !opp.owner_id) fields.owner_id = rep;
        if (Object.keys(fields).length) {
          await this.runtime.propose(db, event.tenantId, InboundSdrAgent.id, runId, {
            type: 'update_fields',
            target: { object: 'opportunities', id: opp.id },
            payload: { fields },
            confidence: signals.confidence,
            evidence,
            summary: `Fill ${String(opp.name)} from the enquiry`,
            model,
            promptVersion,
          });
        }
      }

      if (score.qualified && contact?.email && contact.consent_status !== 'opted_out') {
        await this.runtime.propose(db, event.tenantId, InboundSdrAgent.id, runId, {
          type: 'send_email',
          target: { object: 'leads', id: lead.id },
          payload: this.draftReply(contact, account, signals),
          confidence: signals.confidence,
          evidence: signals.evidence,
          summary: `First reply to ${String(contact.email)}`,
          model,
          promptVersion,
        });
      }
    });
  }

  draftReply(contact: Row, account: Row | undefined, signals: Signals) {
    const first = String(contact.name ?? '').split(' ')[0] || 'there';
    const what = signals.gpu_model ? `${signals.gpu_count ? `${signals.gpu_count} ` : ''}${signals.gpu_model}` : 'AI infrastructure';
    const questions = qualifyingQuestions(signals);
    const body = [
      `Hi ${first},`,
      '',
      `Thank you for your enquiry about ${what}${account?.name ? ` for ${String(account.name)}` : ''}. ` +
        'So we can send an accurate configuration, quote and lead time, could you tell us:',
      '',
      ...questions.map((q, i) => `${i + 1}. ${q}`),
      '',
      'If it is easier, reply with a time that suits you and we will set up a short call.',
      '',
      'Best regards,',
      'Uvation Sales',
    ].join('\n');
    return {
      template: 'rfq_acknowledgement',
      to: contact.email,
      subject: `Your Uvation enquiry: ${what}`,
      body,
    };
  }
}
