import { AGENTS, AgentDefinition } from './agent-definitions';
import { AgentState, ProposedAction, evaluatePolicy } from './policy-engine';

const sdr = AGENTS.find((a) => a.id === 'inbound_sdr') as AgentDefinition;
const state = (s: Partial<AgentState> = {}): AgentState => ({ enabled: true, killed: false, overrides: {}, actionsToday: 0, ...s });
const update = (fields: Record<string, unknown>, confidence = 0.9): ProposedAction => ({
  type: 'update_fields',
  target: { object: 'leads', id: 'l1' },
  payload: { fields },
  confidence,
  summary: 'test',
});
const email = (template?: string, confidence = 0.9): ProposedAction => ({
  type: 'send_email',
  payload: { template, to: 'a@b.com', body: 'hi' },
  confidence,
  summary: 'test',
});

describe('evaluatePolicy', () => {
  it('executes confident reversible actions inside scope', () => {
    expect(evaluatePolicy(sdr, state(), update({ fit_score: 80 })).decision).toBe('execute');
  });

  it('queues reversible actions below the confidence threshold for the reviewer role', () => {
    const d = evaluatePolicy(sdr, state(), update({ fit_score: 80 }, 0.4));
    expect(d).toMatchObject({ decision: 'queue', reviewerRole: 'rep' });
    expect(d.reason).toMatch(/low_confidence/);
  });

  it('blocks writes outside the agent boundary instead of failing silently', () => {
    const d = evaluatePolicy(sdr, state(), update({ compliance_status: 'cleared' }));
    expect(d.decision).toBe('block');
    expect(d.reason).toMatch(/out_of_scope/);
  });

  it('kill switch and daily cap stop everything', () => {
    expect(evaluatePolicy(sdr, state({ killed: true }), update({ fit_score: 1 })).reason).toMatch(/kill_switch/);
    expect(evaluatePolicy(sdr, state({ actionsToday: sdr.dailyActionCap }), update({ fit_score: 1 })).reason).toMatch(/daily_cap/);
  });

  it('holds outbound email for approval until the agent is promoted to autonomous', () => {
    expect(evaluatePolicy(sdr, state(), email('rfq_acknowledgement')).decision).toBe('queue');
    expect(evaluatePolicy(sdr, state({ overrides: { outboundMode: 'autonomous' } }), email('rfq_acknowledgement')).decision).toBe('execute');
  });

  it('never sends off-template text without a person, even when autonomous', () => {
    const d = evaluatePolicy(sdr, state({ overrides: { outboundMode: 'autonomous' } }), email(undefined));
    expect(d).toMatchObject({ decision: 'queue' });
    expect(d.reason).toMatch(/off_template/);
  });

  it('blocks action types the agent is not allowed to take', () => {
    const d = evaluatePolicy(sdr, state(), { type: 'draft_quote', payload: {}, confidence: 1, summary: 'q' });
    expect(d.decision).toBe('block');
    expect(d.reason).toMatch(/may not draft_quote/);
  });

  it('routes binding actions to deal desk and refuses regulated ones outright', () => {
    const withQuotes = { ...sdr, allowedActions: [...sdr.allowedActions, 'submit_quote' as const] };
    expect(evaluatePolicy(withQuotes, state(), { type: 'submit_quote', payload: {}, confidence: 1, summary: 'q' })).toMatchObject({
      decision: 'queue',
      reviewerRole: 'deal_desk',
    });
    expect(evaluatePolicy(sdr, state(), { type: 'clear_compliance', payload: {}, confidence: 1, summary: 'c' }).decision).toBe('block');
  });
});
