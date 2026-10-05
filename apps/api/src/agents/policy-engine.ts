import type { Role } from '../common/principal';
import type { ObjectName } from '../records/record-types';
import { ACTION_REVERSIBILITY, ActionType, AgentDefinition, AgentOverrides, HUMAN_ONLY_ACTIONS, Reversibility } from './agent-definitions';

export interface ProposedAction {
  type: ActionType;
  target?: { object: ObjectName; id: string };
  payload: Record<string, unknown>;
  confidence: number;
  evidence?: unknown[];
  summary: string;
  model?: string;
  promptVersion?: string;
}

export interface AgentState {
  enabled: boolean;
  killed: boolean;
  overrides: AgentOverrides;
  actionsToday: number;
}

export type PolicyDecision =
  | { decision: 'execute'; reversibility: Reversibility; reason: string }
  | { decision: 'queue'; reversibility: Reversibility; reason: string; reviewerRole: Role }
  | { decision: 'block'; reversibility: Reversibility; reason: string };

export function effectiveDefinition(def: AgentDefinition, overrides: AgentOverrides): AgentDefinition {
  return { ...def, ...overrides };
}

/** Fields an action would write, as "object.field" strings, for scope checks. */
function fieldsTouched(action: ProposedAction): { object: ObjectName; fields: string[] } | null {
  if (action.type === 'update_fields' && action.target) {
    const fields = Object.keys((action.payload.fields as Record<string, unknown>) ?? {});
    const custom = Object.keys(((action.payload.fields as Record<string, unknown>)?.custom as Record<string, unknown>) ?? {});
    return { object: action.target.object, fields: [...fields.filter((f) => f !== 'custom'), ...custom.map((c) => `custom.${c}`)] };
  }
  return null;
}

/**
 * Decides what happens to an agent's proposed action (FR-AI-01..04, section 2.7 of the requirements):
 * agents act on reversible work above their confidence threshold; outbound messages follow the
 * agent's outbound mode and approved templates; binding and irreversible actions always wait for a
 * person; regulated actions are never available to agents; kill switch and daily caps stop everything.
 */
export function evaluatePolicy(base: AgentDefinition, state: AgentState, action: ProposedAction): PolicyDecision {
  const def = effectiveDefinition(base, state.overrides);
  const reversibility = ACTION_REVERSIBILITY[action.type];

  if (state.killed) return { decision: 'block', reversibility, reason: 'kill_switch: agent is stopped' };
  if (!state.enabled) return { decision: 'block', reversibility, reason: 'disabled: agent is not enabled for this tenant' };
  if (HUMAN_ONLY_ACTIONS.has(action.type)) {
    return { decision: 'block', reversibility, reason: `human_only: agents may not perform ${action.type}` };
  }
  if (state.actionsToday >= def.dailyActionCap) {
    return { decision: 'block', reversibility, reason: `daily_cap: ${def.dailyActionCap} actions per day reached` };
  }
  if (!(action.confidence >= 0 && action.confidence <= 1)) {
    return { decision: 'block', reversibility, reason: 'invalid_confidence: must be between 0 and 1' };
  }

  // Scope checks: anything outside the agent's boundary is blocked and surfaced, never silently dropped.
  const touched = fieldsTouched(action);
  if (touched) {
    const allowed = def.writableFields[touched.object] ?? [];
    const outside = touched.fields.filter((f) => !allowed.includes(f) && !(f.startsWith('custom.') && allowed.includes('custom.*')));
    if (outside.length) {
      return { decision: 'block', reversibility, reason: `out_of_scope: may not write ${touched.object}.${outside.join(', ')}` };
    }
  }
  if (action.type === 'create_record') {
    const object = action.payload.object as ObjectName;
    if (!def.creatable.includes(object)) return { decision: 'block', reversibility, reason: `out_of_scope: may not create ${object}` };
  }
  if (action.type === 'send_email' && !def.channels.includes('email')) {
    return { decision: 'block', reversibility, reason: 'out_of_scope: email channel not permitted' };
  }

  const confident = action.confidence >= def.confidenceThreshold;
  switch (reversibility) {
    case 'reversible':
      return confident
        ? { decision: 'execute', reversibility, reason: `confidence ${action.confidence.toFixed(2)} >= ${def.confidenceThreshold}` }
        : {
            decision: 'queue',
            reversibility,
            reason: `low_confidence: ${action.confidence.toFixed(2)} < ${def.confidenceThreshold}`,
            reviewerRole: def.reviewerRole,
          };
    case 'compensable': {
      const template = action.payload.template as string | undefined;
      if (!template || !def.templates.includes(template)) {
        return { decision: 'queue', reversibility, reason: 'off_template: outbound text needs approval', reviewerRole: def.reviewerRole };
      }
      if (def.outboundMode !== 'autonomous') {
        return { decision: 'queue', reversibility, reason: 'outbound_mode: approval required', reviewerRole: def.reviewerRole };
      }
      return confident
        ? { decision: 'execute', reversibility, reason: `approved template ${template}, autonomous outbound` }
        : { decision: 'queue', reversibility, reason: 'low_confidence', reviewerRole: def.reviewerRole };
    }
    case 'binding':
      return { decision: 'queue', reversibility, reason: 'binding: commercial commitment needs a person', reviewerRole: 'deal_desk' };
    case 'irreversible':
      return { decision: 'queue', reversibility, reason: 'irreversible: always needs a person', reviewerRole: 'sales_leader' };
  }
}
