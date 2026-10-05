import { Injectable, OnModuleInit } from '@nestjs/common';
import { DbService } from '../../db/db.service';
import { DomainEvent, EventBus } from '../../events/event-bus';
import { LlmService } from '../../llm/llm.service';
import { RecordsService } from '../../records/records.service';
import { AgentRuntime } from '../agent-runtime.service';
import { opportunityPatch } from './signal-fields';

const CAPTURABLE = new Set(['email', 'meeting', 'call', 'chat']);

/**
 * Capture agent: reads every captured communication, stores a cited summary on the activity and
 * fills empty opportunity fields from what the customer said (FR-CAP-07, F017).
 */
@Injectable()
export class CaptureAgent implements OnModuleInit {
  static readonly id = 'capture';

  constructor(
    private readonly events: EventBus,
    private readonly dbs: DbService,
    private readonly records: RecordsService,
    private readonly runtime: AgentRuntime,
    private readonly llm: LlmService,
  ) {}

  onModuleInit() {
    this.events.subscribe('activities.created', 'capture-agent', (e) => this.onActivity(e));
  }

  async onActivity(event: DomainEvent) {
    // Ignore activities the agent layer itself created, to avoid loops.
    if (event.payload.source === 'agent') return;
    await this.dbs.tx(event.tenantId, async (db) => {
      const activity = await this.records.getRaw(db, 'activities', String(event.payload.id));
      if (!activity || !CAPTURABLE.has(String(activity.type)) || !activity.body) return;
      if (activity.direction === 'outbound' && !activity.opportunity_id) return;

      const text = [activity.subject, activity.body].filter(Boolean).join('\n\n');
      const { signals, model, promptVersion } = await this.llm.extractSignals(db, event.tenantId, CaptureAgent.id, text);
      const runId = this.runtime.newRun();

      // Nothing worth recording (no recognisable signals): leave the activity as captured.
      if (signals.confidence < 0.5) return;
      await this.runtime.propose(db, event.tenantId, CaptureAgent.id, runId, {
        type: 'update_fields',
        target: { object: 'activities', id: activity.id },
        payload: { fields: { extracted: { intent: signals.intent, summary: signals.summary, timeline: signals.timeline, evidence: signals.evidence } } },
        confidence: signals.confidence,
        evidence: signals.evidence,
        summary: `Summarise ${activity.type}: ${signals.summary}`,
        model,
        promptVersion,
      });

      if (!activity.opportunity_id) return;
      const opp = await this.records.getRaw(db, 'opportunities', String(activity.opportunity_id));
      if (!opp) return;
      const humanSet = await this.records.humanSetFields(db, 'opportunities', opp.id);
      const { fields, evidence } = opportunityPatch(signals, opp, humanSet);
      if (!Object.keys(fields).length) return;
      await this.runtime.propose(db, event.tenantId, CaptureAgent.id, runId, {
        type: 'update_fields',
        target: { object: 'opportunities', id: opp.id },
        payload: { fields, activityId: activity.id },
        confidence: signals.confidence,
        evidence,
        summary: `Update ${String(opp.name)} from ${activity.type}: ${Object.entries(fields)
          .map(([k, v]) => `${k}=${v}`)
          .join(', ')}`,
        model,
        promptVersion,
      });
    });
  }
}
