/**
 * Configurator (FR-CPQ-02): turns a requirement sheet into a valid AI-server bill of materials,
 * with power and cooling per rack. Pure function over the catalogue so it is easy to test and the
 * same logic serves the configure-and-quote agent and the presales UI.
 */
export interface CatalogItem {
  id: string;
  sku: string;
  name: string;
  category: string;
  oem: string | null;
  gpu_model: string | null;
  gpus_per_unit: number;
  power_kw: number;
  rack_units: number;
  cooling: string;
  list_price: number;
  cost: number;
  stock: number;
  lead_time_weeks: number;
  export_class: string;
  attrs: Record<string, unknown>;
}

export interface Requirements {
  gpu_model?: string | null;
  gpu_count?: number | null;
  node_count?: number | null;
  workload?: string | null;
  cooling?: string | null;
  kw_per_rack?: number | null;
  oem?: string | null;
  fabric?: 'infiniband' | 'ethernet' | null;
  include_storage?: boolean | null;
}

export interface BomLine {
  product: CatalogItem;
  qty: number;
  reason: string;
}

export interface Configuration {
  valid: boolean;
  errors: string[];
  warnings: string[];
  lines: BomLine[];
  summary: {
    server_sku: string | null;
    units: number;
    gpus: number;
    racks: number;
    power_kw_total: number;
    kw_per_rack_needed: number;
    cooling: 'air' | 'liquid';
    fabric: string | null;
    max_lead_time_weeks: number;
  };
}

const DEFAULT_KW_PER_RACK = 40;
const norm = (s?: string | null) => (s ?? '').toLowerCase().replace(/\s+/g, '');

export function configure(req: Requirements, catalog: CatalogItem[]): Configuration {
  const errors: string[] = [];
  const warnings: string[] = [];
  const lines: BomLine[] = [];
  const empty = (): Configuration => ({
    valid: false,
    errors,
    warnings,
    lines: [],
    summary: { server_sku: null, units: 0, gpus: 0, racks: 0, power_kw_total: 0, kw_per_rack_needed: 0, cooling: 'air', fabric: null, max_lead_time_weeks: 0 },
  });

  if (!req.gpu_model) errors.push('GPU model is missing from the requirement sheet');
  if (!req.gpu_count && !req.node_count) errors.push('GPU count or node count is missing from the requirement sheet');
  if (errors.length) return empty();

  const want = norm(req.gpu_model);
  let candidates = catalog.filter(
    (p) => (p.category === 'gpu_server' || p.category === 'rack_system') && (norm(p.gpu_model) === want || norm(p.gpu_model).startsWith(want)),
  );
  if (!candidates.length) {
    errors.push(`No catalogue system found for GPU model "${req.gpu_model}"`);
    return empty();
  }
  const airOnly = req.cooling === 'air';
  if (airOnly) {
    const air = candidates.filter((c) => c.cooling !== 'liquid');
    if (!air.length) {
      errors.push(`${req.gpu_model} systems in the catalogue need liquid cooling, but the site has air cooling only`);
      return empty();
    }
    candidates = air;
  }
  // Prefer the requested OEM, then stock on hand, then price.
  candidates.sort(
    (a, b) =>
      Number(norm(b.oem) === norm(req.oem)) - Number(norm(a.oem) === norm(req.oem)) ||
      Number(b.stock > 0) - Number(a.stock > 0) ||
      a.list_price - b.list_price,
  );
  const server = candidates[0];
  if (req.oem && norm(server.oem) !== norm(req.oem)) warnings.push(`No ${req.oem} system for ${req.gpu_model}; proposing ${server.oem}`);

  const rackScale = server.category === 'rack_system';
  const gpusWanted = req.gpu_count ?? (req.node_count ?? 0) * server.gpus_per_unit;
  const units = Math.max(1, Math.ceil(gpusWanted / server.gpus_per_unit));
  const gpus = units * server.gpus_per_unit;
  if (gpus !== gpusWanted) warnings.push(`Rounded up to ${gpus} GPUs (${units} x ${server.gpus_per_unit})`);
  lines.push({ product: server, qty: units, reason: `${gpusWanted} GPUs requested` });

  const kwLimit = req.kw_per_rack ?? DEFAULT_KW_PER_RACK;
  if (!req.kw_per_rack) warnings.push(`Site power per rack unknown; assumed ${DEFAULT_KW_PER_RACK} kW. Confirm in the readiness checklist`);
  const cooling: 'air' | 'liquid' = server.cooling === 'liquid' ? 'liquid' : 'air';
  if (cooling === 'liquid' && req.cooling !== 'liquid') warnings.push(`${server.sku} needs direct liquid cooling; confirm the site has it`);

  // Network fabric: one port per GPU (rail-optimised), leaf switches with half their ports facing servers.
  const multiNode = units > 1 || rackScale;
  const training = ['training', 'fine_tuning', 'hpc'].includes(req.workload ?? '');
  const fabric = req.fabric ?? (multiNode ? (training ? 'infiniband' : 'ethernet') : null);
  let switches = 0;
  if (fabric) {
    const sw = catalog.find((p) => p.category === 'networking' && p.attrs.fabric === fabric);
    if (!sw) errors.push(`No ${fabric} switch in the catalogue`);
    else {
      const ports = gpus;
      const downlinks = Number(sw.attrs.ports ?? 64) / 2;
      const leaf = Math.ceil(ports / downlinks);
      const spine = leaf > 1 ? Math.ceil(leaf / 2) : 0;
      switches = leaf + spine;
      lines.push({ product: sw, qty: switches, reason: `${fabric} fabric: ${leaf} leaf${spine ? ` + ${spine} spine` : ''} for ${ports} GPU ports` });
      const optics = catalog.find((p) => p.category === 'optics');
      if (optics) lines.push({ product: optics, qty: ports * 2 + spine * downlinks * 2, reason: 'Transceivers for server and inter-switch links' });
    }
  }

  let storageUnits = 0;
  const wantStorage = req.include_storage ?? training;
  if (wantStorage) {
    const st = catalog.find((p) => p.category === 'storage');
    if (st) {
      storageUnits = Math.max(1, Math.ceil(units / (rackScale ? 2 : 32)));
      lines.push({ product: st, qty: storageUnits, reason: `${req.workload ?? 'Training'} data pipeline` });
    }
  }

  const switchKw = lines.filter((l) => l.product.category === 'networking').reduce((a, l) => a + l.qty * l.product.power_kw, 0);
  const storageKw = lines.filter((l) => l.product.category === 'storage').reduce((a, l) => a + l.qty * l.product.power_kw, 0);
  const computeKw = units * server.power_kw;
  const powerTotal = computeKw + switchKw + storageKw;

  let racks: number;
  let kwPerRackNeeded: number;
  if (rackScale) {
    racks = units;
    kwPerRackNeeded = server.power_kw;
    if (kwLimit < server.power_kw) {
      errors.push(`${server.gpu_model} needs ${server.power_kw} kW per rack; the site supports ${kwLimit} kW. Offer Uvation hosting or a site upgrade`);
    }
  } else {
    if (server.power_kw > kwLimit) {
      errors.push(`One ${server.sku} draws ${server.power_kw} kW, more than the ${kwLimit} kW per rack available`);
    }
    const byPower = Math.max(1, Math.floor(kwLimit / server.power_kw));
    const bySpace = Math.max(1, Math.floor(42 / Math.max(1, server.rack_units)));
    const perRack = Math.min(byPower, bySpace);
    racks = Math.ceil(units / perRack) + (switches + storageUnits > 0 ? 1 : 0);
    kwPerRackNeeded = Math.min(units, perRack) * server.power_kw;
    const rack = catalog.find((p) => p.sku.startsWith('RACK-'));
    const pdu = catalog.find((p) => p.sku.startsWith('PDU-'));
    if (rack) lines.push({ product: rack, qty: racks, reason: `${perRack} servers per rack at ${kwLimit} kW per rack` });
    if (pdu) lines.push({ product: pdu, qty: racks, reason: 'Redundant power per rack' });
    if (kwPerRackNeeded > 48) warnings.push(`${kwPerRackNeeded.toFixed(1)} kW per rack exceeds what a rear-door heat exchanger handles; plan liquid cooling`);
  }

  const sw = catalog.find((p) => p.sku === 'SW-NVAIE-1Y');
  const nvidia = !/^MI/i.test(server.gpu_model ?? '');
  if (sw && nvidia) lines.push({ product: sw, qty: gpus, reason: 'Software licence per GPU' });

  const pick = (sku: string) => catalog.find((p) => p.sku === sku);
  if (rackScale) {
    const dep = pick('SVC-NVL72-DEPLOY');
    const sup = pick('SUP-3Y-NVL72');
    if (dep) lines.push({ product: dep, qty: units, reason: 'Deployment and commissioning' });
    if (sup) lines.push({ product: sup, qty: units, reason: '3-year support' });
  } else {
    const rs = pick('SVC-RACK-STACK');
    const sup = pick('SUP-3Y-NBD');
    if (rs) lines.push({ product: rs, qty: units, reason: 'Installation' });
    if (sup) lines.push({ product: sup, qty: units, reason: '3-year support' });
  }
  if (multiNode) {
    const val = pick('SVC-CLUSTER-VAL');
    if (val) lines.push({ product: val, qty: 1, reason: 'Burn-in and cluster validation' });
  }

  const maxLead = Math.max(...lines.map((l) => (l.product.stock >= l.qty ? 0 : l.product.lead_time_weeks)));
  if (maxLead > 8) warnings.push(`Longest lead time is ${maxLead} weeks; check alternatives or hold stock`);

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    lines,
    summary: {
      server_sku: server.sku,
      units,
      gpus,
      racks,
      power_kw_total: Math.round(powerTotal * 10) / 10,
      kw_per_rack_needed: Math.round(kwPerRackNeeded * 10) / 10,
      cooling,
      fabric,
      max_lead_time_weeks: maxLead,
    },
  };
}
