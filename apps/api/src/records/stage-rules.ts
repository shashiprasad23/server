/**
 * Named entry rules for pipeline stages. Stages are configured per tenant (pipeline_stages.entry_rules),
 * so the gates can change without code changes; the rule implementations live here.
 */
export type Opp = Record<string, unknown>;

export const STAGE_RULES: Record<string, { message: string; check: (o: Opp) => boolean }> = {
  has_account: { message: 'Link the opportunity to an account first', check: (o) => !!o.account_id },
  has_requirements: {
    message: 'Record the GPU model and count (requirement sheet) first',
    check: (o) => !!o.gpu_model && Number(o.gpu_count) > 0,
  },
  has_value: { message: 'Set the expected deal value first', check: (o) => o.expected_value != null },
  compliance_cleared: {
    message: 'Trade Compliance must clear the end user and destination first (FR-CMP-04)',
    check: (o) => o.compliance_status === 'cleared',
  },
  order_confirmed: {
    message: 'Record the NetSuite sales order ID (or the Marketplace order reference) first (FR-NS-04)',
    check: (o) => !!o.netsuite_sales_order_id || !!o.order_reference,
  },
  lost_reason_required: { message: 'Give a reason for closing as lost', check: (o) => !!o.lost_reason },
};

export function failedRules(rules: string[], opp: Opp): { rule: string; message: string }[] {
  return rules
    .map((rule) => {
      const def = STAGE_RULES[rule];
      if (!def) return { rule, message: `Unknown stage rule "${rule}"` };
      return def.check(opp) ? null : { rule, message: def.message };
    })
    .filter((x): x is { rule: string; message: string } => x !== null);
}
