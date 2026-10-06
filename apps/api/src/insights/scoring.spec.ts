import { DealFacts, scoreDeal, scoreHealth } from './scoring';
import { parseQuestion } from './insights.service';
import { redFlags, screenParties, similarity } from '../compliance/compliance.service';

const base: DealFacts = {
  stage: 'proposal',
  daysSinceActivity: 2,
  contacts: 3,
  hasEconomicBuyer: true,
  quoteStatus: 'sent',
  quoteDaysToExpiry: 10,
  supplyConstrainedWeeks: 0,
  weeksToShip: 8,
  activeDealReg: true,
  oem: 'Dell',
  complianceStatus: 'screening',
  eusStatus: 'requested',
  siteGaps: 0,
  hasRequirements: true,
};

describe('deal scoring (FR-PIPE-05)', () => {
  it('scores a healthy deal low with stage-based probability', () => {
    const s = scoreDeal(base);
    expect(s.risk).toBe(0);
    expect(s.probability).toBe(50);
  });

  it('explains each risk and suggests the matching next action', () => {
    const s = scoreDeal({ ...base, daysSinceActivity: 30, contacts: 1, hasEconomicBuyer: false, supplyConstrainedWeeks: 14, weeksToShip: 6, activeDealReg: false, stage: 'negotiation' });
    expect(s.risk).toBeGreaterThanOrEqual(70);
    expect(s.reasons.map((r) => r.reason).join(' ')).toMatch(/No customer activity for 30 days/);
    expect(s.nextActions).toContain('Hold stock or offer an in-stock alternative');
    expect(s.probability).toBeLessThan(65);
  });

  it('treats a compliance block as critical', () => {
    expect(scoreDeal({ ...base, complianceStatus: 'blocked' }).risk).toBeGreaterThanOrEqual(50);
  });

  it('scores account health from tickets, RMAs and engagement', () => {
    const h = scoreHealth({ ticketsLast90: 2, rmasLast90: 2, creditHold: false, daysSinceActivity: 5, openOpportunities: 0 });
    expect(h.score).toBe(34);
  });
});

describe('compliance matching (FR-CMP-01, 05)', () => {
  const list = [{ name: 'Red Harbor Compute Ltd', aliases: ['RHC Ltd'], list_name: 'DEMO' }];
  it('matches name variants and ignores corporate suffixes', () => {
    expect(similarity('Red Harbour Compute Limited', 'Red Harbor Compute Ltd')).toBeGreaterThan(0.6);
    expect(screenParties([{ role: 'end_user', name: 'Red Harbor Compute' }], list)).toHaveLength(1);
    expect(screenParties([{ role: 'customer', name: 'Nimbus AI' }], list)).toHaveLength(0);
  });

  it('finds red-flag phrases', () => {
    expect(redFlags('The end user is confidential and our freight forwarder will handle it', ['end user is confidential', 'freight forwarder will handle'])).toHaveLength(2);
  });
});

describe('Ask-the-CRM question parser (FR-AI-10)', () => {
  it('turns a manager question into filters', () => {
    const f = parseQuestion('Which open deals need liquid cooling and ship in Q2 2027 with more than 64 GPUs?');
    expect(f).toMatchObject({ cooling: 'liquid', ship_quarter: '2027-Q2', min_gpus: 64 });
    expect(parseQuestion('show my B200 deals at risk')).toMatchObject({ gpu_model: 'B200', at_risk: true, mine: true });
  });
});
