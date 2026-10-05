import { Signals } from './signals';

/**
 * Offline extraction used when no model is configured (local dev, CI, outages). Deliberately
 * conservative: it reports lower confidence than a model so agent actions built on it are more
 * likely to go to a human for confirmation.
 */
const GPU_MODELS: [RegExp, string][] = [
  [/\bGB300(\s*NVL72)?\b/i, 'GB300 NVL72'],
  [/\bGB200(\s*NVL72)?\b/i, 'GB200 NVL72'],
  [/\bB300\b/i, 'B300'],
  [/\bB200\b/i, 'B200'],
  [/\bH200\b/i, 'H200'],
  [/\bH100\b/i, 'H100'],
  [/\bL40S\b/i, 'L40S'],
  [/\bRTX\s*PRO\s*6000\b/i, 'RTX PRO 6000'],
  [/\bMI355X\b/i, 'MI355X'],
  [/\bMI325X\b/i, 'MI325X'],
  [/\bMI300X\b/i, 'MI300X'],
];
const OEMS = ['Dell', 'HPE', 'Supermicro', 'Lenovo', 'Gigabyte', 'ASUS', 'Cisco'];
const COUNTRIES = ['India', 'United States', 'USA', 'United Kingdom', 'UK', 'Germany', 'Singapore', 'UAE', 'Saudi Arabia', 'Japan', 'Canada', 'Australia'];

function quoteAround(text: string, index: number, length: number): string {
  const start = Math.max(0, text.lastIndexOf('.', index) + 1);
  const endDot = text.indexOf('.', index + length);
  const end = endDot === -1 ? Math.min(text.length, index + length + 80) : endDot + 1;
  return text.slice(start, end).trim().slice(0, 240);
}

export function heuristicSignals(text: string): Signals {
  const evidence: Signals['evidence'] = [];
  const found = <T>(field: string, m: RegExpMatchArray | null, value: T): T | null => {
    if (!m || m.index === undefined) return null;
    evidence.push({ field, quote: quoteAround(text, m.index, m[0].length) });
    return value;
  };

  let gpu_model: string | null = null;
  for (const [re, name] of GPU_MODELS) {
    const m = text.match(re);
    if (m) {
      gpu_model = found('gpu_model', m, name);
      break;
    }
  }
  const gpuCountM = text.match(/\b(\d{1,5})\s*(?:x\s*)?(?:[A-Z]{1,3}\d{2,3}[A-Z]?\s*)?GPUs?\b/i);
  const gpu_count = found('gpu_count', gpuCountM, gpuCountM ? Number(gpuCountM[1]) : null);
  const nodeM = text.match(/\b(\d{1,4})\s*(?:x\s*)?(?:nodes?|servers?|systems?)\b/i);
  const node_count = found('node_count', nodeM, nodeM ? Number(nodeM[1]) : null);
  const kwM = text.match(/\b(\d{1,3}(?:\.\d)?)\s*kW\b/i);
  const kw_per_rack = found('kw_per_rack', kwM, kwM ? Number(kwM[1]) : null);

  let oem: string | null = null;
  for (const o of OEMS) {
    const m = text.match(new RegExp(`\\b${o}\\b`, 'i'));
    if (m) {
      oem = found('oem', m, o);
      break;
    }
  }
  let destination_country: string | null = null;
  for (const c of COUNTRIES) {
    const m = text.match(new RegExp(`\\b${c}\\b`));
    if (m) {
      destination_country = found('destination_country', m, c === 'USA' ? 'United States' : c === 'UK' ? 'United Kingdom' : c);
      break;
    }
  }

  const workloadM = text.match(/\b(training|fine[- ]?tuning|inference|hpc)\b/i);
  const workloadWord = workloadM?.[1].toLowerCase().replace(/[- ]/, '_');
  const workload = found(
    'workload',
    workloadM,
    (workloadWord === 'fine_tuning' || workloadWord === 'finetuning' ? 'fine_tuning' : workloadWord) as Signals['workload'],
  );
  const coolingM = text.match(/\b(liquid[- ]cool\w*|direct liquid|DLC|air[- ]cool\w*|rear[- ]door)\b/i);
  const cooling = found(
    'cooling',
    coolingM,
    (coolingM ? (/air/i.test(coolingM[0]) ? 'air' : /rear/i.test(coolingM[0]) ? 'rear_door' : 'liquid') : null) as Signals['cooling'],
  );
  const locM = text.match(/\b(colo(?:cation)?|our (?:own )?(?:data ?cent(?:er|re)|site)|hosted by (?:you|uvation))\b/i);
  const deployment_location = found(
    'deployment_location',
    locM,
    (locM ? (/colo/i.test(locM[0]) ? 'colocation' : /hosted/i.test(locM[0]) ? 'uvation_hosted' : 'customer_site') : null) as Signals['deployment_location'],
  );
  const timelineM = text.match(/\b(by|before|in|within)\s+(Q[1-4](?:\s*\d{4})?|\w+\s+\d{4}|\d+\s+(?:weeks?|months?))\b/i);
  const timeline = found('timeline', timelineM, timelineM ? timelineM[0] : null);

  const intent: Signals['intent'] = /\b(purchase order|PO\s*#?\d+|attached (?:our )?PO)\b/i.test(text)
    ? 'purchase_order'
    : /\b(quote|quotation|pricing|price|RFQ|proposal|budgetary)\b/i.test(text)
      ? 'rfq'
      : /\b(RMA|broken|failed|error|down|support ticket)\b/i.test(text)
        ? 'support'
        : /\b(meet|call|schedule|calendar|available)\b/i.test(text)
          ? 'scheduling'
          : /\?/.test(text)
            ? 'question'
            : 'other';

  const filled = [gpu_model, gpu_count, node_count, oem, kw_per_rack, workload, cooling, deployment_location, destination_country].filter(
    (v) => v !== null,
  ).length;
  const firstSentence = text.replace(/\s+/g, ' ').trim().split(/(?<=[.?!])\s/)[0]?.slice(0, 200) ?? '';
  return {
    intent,
    workload,
    gpu_model,
    gpu_count,
    node_count,
    oem,
    deployment_location,
    cooling,
    kw_per_rack,
    destination_country,
    timeline,
    summary: gpu_model ? `${intent === 'rfq' ? 'Quote request' : 'Message'} about ${gpu_count ?? ''} ${gpu_model}`.replace(/\s+/g, ' ').trim() : firstSentence,
    evidence,
    confidence: filled === 0 ? 0.3 : Math.min(0.85, 0.6 + filled * 0.05),
  };
}
