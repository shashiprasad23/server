/** Explainable deal risk, win probability and next best actions (FR-PIPE-03, FR-PIPE-05, FR-FCST-02). */

export const STAGE_PROBABILITY: Record<string, number> = {
  lead: 5,
  qualified: 10,
  discovery: 20,
  solution_design: 30,
  supply_dealreg: 40,
  proposal: 50,
  negotiation: 65,
  compliance_check: 75,
  po_received: 90,
  closed_won: 100,
  closed_lost: 0,
};

export const STAGE_ORDER = Object.keys(STAGE_PROBABILITY);
export const stageAtLeast = (stage: string, min: string) => STAGE_ORDER.indexOf(stage) >= STAGE_ORDER.indexOf(min);

export interface DealFacts {
  stage: string;
  daysSinceActivity: number | null;
  contacts: number;
  hasEconomicBuyer: boolean;
  quoteStatus: string | null;
  quoteDaysToExpiry: number | null;
  supplyConstrainedWeeks: number;
  weeksToShip: number | null;
  activeDealReg: boolean;
  oem: string | null;
  complianceStatus: string;
  eusStatus: string;
  siteGaps: number;
  hasRequirements: boolean;
}

export interface RiskItem {
  reason: string;
  points: number;
}

export interface DealScore {
  risk: number;
  reasons: RiskItem[];
  probability: number;
  nextActions: string[];
}

export function scoreDeal(f: DealFacts): DealScore {
  const reasons: RiskItem[] = [];
  const actions: string[] = [];
  const add = (points: number, reason: string, action?: string) => {
    reasons.push({ reason, points });
    if (action) actions.push(action);
  };
  const closed = f.stage === 'closed_won' || f.stage === 'closed_lost';
  if (closed) return { risk: 0, reasons: [], probability: STAGE_PROBABILITY[f.stage], nextActions: [] };

  if (f.daysSinceActivity === null) add(15, 'No customer activity recorded yet', 'Log a first call or let the SDR agent send the first reply');
  else if (f.daysSinceActivity > 21) add(25, `No customer activity for ${f.daysSinceActivity} days`, 'Re-engage: book a call this week');
  else if (f.daysSinceActivity > 10) add(10, `Quiet for ${f.daysSinceActivity} days`, 'Send a follow-up with the next step');

  if (f.contacts <= 1) add(10, 'Single-threaded: one contact', 'Add the ML lead, IT infrastructure and procurement contacts');
  if (!f.hasEconomicBuyer && stageAtLeast(f.stage, 'discovery')) add(10, 'No economic buyer identified', 'Identify and meet the economic buyer');
  if (!f.hasRequirements && stageAtLeast(f.stage, 'qualified')) add(10, 'Requirements incomplete (GPU model or count)', 'Complete the requirement sheet');

  if (f.supplyConstrainedWeeks > 0) {
    const late = f.weeksToShip !== null && f.supplyConstrainedWeeks > f.weeksToShip;
    add(late ? 20 : 8, `GPU supply lead time ${f.supplyConstrainedWeeks} weeks${late ? ', past the target ship date' : ''}`, 'Hold stock or offer an in-stock alternative');
  }
  if (!f.activeDealReg && f.oem && stageAtLeast(f.stage, 'supply_dealreg')) add(10, `No ${f.oem} deal registration filed`, `File the ${f.oem} deal registration today`);
  if (f.siteGaps > 0 && stageAtLeast(f.stage, 'solution_design')) add(8, `${f.siteGaps} datacentre readiness gaps`, 'Run the readiness checklist with the customer');
  if (f.quoteDaysToExpiry !== null && f.quoteDaysToExpiry <= 3 && (f.quoteStatus === 'sent' || f.quoteStatus === 'approved')) {
    add(10, `Quote expires in ${Math.max(0, f.quoteDaysToExpiry)} days`, 'Re-validate and re-quote before expiry');
  }
  if (!f.quoteStatus && stageAtLeast(f.stage, 'proposal')) add(10, 'In proposal stage without a quote', 'Generate the quote from the configurator');

  if (f.complianceStatus === 'blocked') add(50, 'Compliance blocked', 'Stop: Trade Compliance blocked this deal');
  else if (f.complianceStatus === 'flagged') add(20, 'Compliance flagged', 'Resolve the Trade Compliance review');
  else if (f.complianceStatus !== 'cleared' && stageAtLeast(f.stage, 'negotiation')) {
    add(12, 'Late stage without compliance clearance', f.eusStatus === 'not_requested' ? 'Request the end-user statement' : 'Chase the end-user statement and clearance');
  }

  const risk = Math.min(100, reasons.reduce((a, r) => a + r.points, 0));
  const base = STAGE_PROBABILITY[f.stage] ?? 10;
  const probability = Math.max(1, Math.round(base * (1 - risk / 200)));
  return { risk, reasons: reasons.sort((a, b) => b.points - a.points), probability, nextActions: actions.slice(0, 4) };
}

export interface HealthFacts {
  ticketsLast90: number;
  rmasLast90: number;
  creditHold: boolean;
  daysSinceActivity: number | null;
  openOpportunities: number;
}

/** FR-CS-03 account health, 0-100 with reasons. */
export function scoreHealth(f: HealthFacts): { score: number; reasons: RiskItem[] } {
  const reasons: RiskItem[] = [];
  if (f.ticketsLast90) reasons.push({ reason: `${f.ticketsLast90} support tickets in 90 days`, points: -Math.min(30, f.ticketsLast90 * 8) });
  if (f.rmasLast90) reasons.push({ reason: `${f.rmasLast90} RMAs in 90 days`, points: -Math.min(30, f.rmasLast90 * 15) });
  if (f.creditHold) reasons.push({ reason: 'On credit hold in NetSuite', points: -20 });
  if (f.daysSinceActivity === null || f.daysSinceActivity > 60) reasons.push({ reason: 'No engagement for 60+ days', points: -15 });
  if (f.openOpportunities) reasons.push({ reason: `${f.openOpportunities} open opportunities`, points: 10 });
  const score = Math.max(0, Math.min(100, 80 + reasons.reduce((a, r) => a + r.points, 0)));
  return { score, reasons };
}
