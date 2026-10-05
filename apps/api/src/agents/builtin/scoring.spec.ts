import { heuristicSignals } from '../../llm/heuristic.provider';
import { qualifyingQuestions, scoreLead } from './inbound-sdr.agent';
import { opportunityPatch } from './signal-fields';

describe('lead scoring and extraction', () => {
  const rfq = 'Please quote 64 H200 GPUs (8 nodes) from Supermicro for LLM training. We have liquid cooling at our own datacentre in India, needed by Q1 2027.';

  it('extracts AI-server signals with evidence', () => {
    const s = heuristicSignals(rfq);
    expect(s).toMatchObject({ intent: 'rfq', gpu_model: 'H200', gpu_count: 64, node_count: 8, oem: 'Supermicro', workload: 'training', cooling: 'liquid', destination_country: 'India' });
    expect(s.evidence.find((e) => e.field === 'gpu_count')?.quote).toContain('64 H200 GPUs');
  });

  it('qualifies a large, specific RFQ from a business domain with cited reasons', () => {
    const score = scoreLead(heuristicSignals(rfq), { businessDomain: true, namedAccount: false });
    expect(score.qualified).toBe(true);
    expect(score.fit).toBeGreaterThanOrEqual(60);
    expect(score.reasons.map((r) => r.reason)).toEqual(expect.arrayContaining(['Business email domain', 'Asks for a quote']));
  });

  it('sends a vague enquiry from a personal address to nurture', () => {
    const score = scoreLead(heuristicSignals('hi, do you sell computers?'), { businessDomain: false, namedAccount: false });
    expect(score.qualified).toBe(false);
  });

  it('only asks what the customer has not already said', () => {
    const qs = qualifyingQuestions(heuristicSignals(rfq));
    expect(qs.join(' ')).not.toMatch(/GPU model in mind/);
    expect(qs.join(' ')).toMatch(/end user/);
  });

  it('never overrides a field a person set (FR-CAP-13)', () => {
    const { fields } = opportunityPatch(heuristicSignals(rfq), { gpu_count: null, gpu_model: 'B200' }, new Set(['gpu_model']));
    expect(fields).toMatchObject({ gpu_count: 64 });
    expect(fields).not.toHaveProperty('gpu_model');
  });
});
