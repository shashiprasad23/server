import type { Signals } from '../../llm/signals';

export const OPPORTUNITY_SIGNAL_FIELDS = [
  'workload',
  'gpu_model',
  'gpu_count',
  'node_count',
  'oem',
  'deployment_location',
  'cooling',
  'kw_per_rack',
  'destination_country',
] as const;

/**
 * Turn extracted signals into an opportunity patch: only non-null values, never a field a person
 * set or corrected (FR-CAP-13), and never a value that is already there.
 */
export function opportunityPatch(
  signals: Signals,
  current: Record<string, unknown>,
  humanSet: Set<string>,
): { fields: Record<string, unknown>; evidence: Signals['evidence'] } {
  const fields: Record<string, unknown> = {};
  for (const f of OPPORTUNITY_SIGNAL_FIELDS) {
    const v = signals[f];
    if (v === null || v === undefined || v === 'unknown') continue;
    if (humanSet.has(f)) continue;
    if (JSON.stringify(current[f] ?? null) === JSON.stringify(v)) continue;
    fields[f] = v;
  }
  const evidence = signals.evidence.filter((e) => e.field in fields);
  return { fields, evidence };
}
