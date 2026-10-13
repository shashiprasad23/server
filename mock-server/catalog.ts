/**
 * Reference catalog and business rules for the mock marketplace.
 * The values mirror test-data/mock.json; the real environment is driven by its own data file.
 */
export interface CatalogItem {
  sku: string;
  name: string;
  description: string;
  type: 'product' | 'service' | 'lease';
  basePrice: number;
  cost: number;
  leadTimeDays: number;
  availability: 'available' | 'discontinued' | 'unavailable';
  alternatives?: string[];
  specVersion: number;
  taxable: boolean;
  configurable?: boolean;
  lease?: { termMonths: number; depositMonths: number };
}

export const defaultCatalog = (): Record<string, CatalogItem> => ({
  'UV-AI-8X': {
    sku: 'UV-AI-8X',
    name: 'Uvation AI Server 8X',
    description: '8-GPU AI training server, 4U, dual-socket',
    type: 'product',
    basePrice: 45000,
    cost: 30000,
    leadTimeDays: 21,
    availability: 'available',
    specVersion: 1,
    taxable: true,
    configurable: true,
  },
  'UV-AI-4X-GEN1': {
    sku: 'UV-AI-4X-GEN1',
    name: 'Uvation AI Server 4X (Gen 1)',
    description: 'Discontinued 4-GPU server',
    type: 'product',
    basePrice: 25000,
    cost: 20000,
    leadTimeDays: 0,
    availability: 'discontinued',
    alternatives: ['UV-AI-8X'],
    specVersion: 1,
    taxable: true,
  },
  'NET-SW-400G': {
    sku: 'NET-SW-400G',
    name: '400G Spine Switch',
    description: '64-port 400GbE switch',
    type: 'product',
    basePrice: 4500,
    cost: 3000,
    leadTimeDays: 60,
    availability: 'available',
    specVersion: 1,
    taxable: true,
  },
  'SVC-RACK-INSTALL': svc('SVC-RACK-INSTALL', 'Rack installation & deployment', 2500),
  'SVC-WARRANTY-3Y': svc('SVC-WARRANTY-3Y', '3-year extended warranty', 6000),
  'SVC-SUPPORT-247': svc('SVC-SUPPORT-247', '24x7 technical support (1 year)', 4800),
  'SVC-SLA-GOLD': svc('SVC-SLA-GOLD', 'Gold SLA: 4-hour on-site response', 9000),
  'LEASE-H200-NODE': {
    sku: 'LEASE-H200-NODE',
    name: 'H200 node lease',
    description: 'Long-term lease of an 8x H200 node, billed monthly',
    type: 'lease',
    basePrice: 12000,
    cost: 8000,
    leadTimeDays: 14,
    availability: 'available',
    specVersion: 1,
    taxable: false,
    lease: { termMonths: 36, depositMonths: 2 },
  },
});

function svc(sku: string, name: string, price: number): CatalogItem {
  return {
    sku,
    name,
    description: name,
    type: 'service',
    basePrice: price,
    cost: price * 0.5,
    leadTimeDays: 0,
    availability: 'available',
    specVersion: 1,
    taxable: true,
  };
}

export const serverRules = {
  'UV-AI-8X': {
    cpus: ['XEON-8480', 'XEON-8580'],
    motherboards: ['X13-SPR'],
    gpuCounts: [1, 2, 4, 8],
    psuWatts: 6000,
    defaultPsu: 'PSU-6000',
    maxRamGb: 2048,
    maxStorageTb: 61,
    nics: ['100GbE', '200GbE', '400GbE'],
  },
};

export const gpus: Record<string, { price: number; watts: number; stock: number; requiresPsu?: string }> = {
  H200: { price: 32000, watts: 700, stock: 10_000 },
  'H100-SXM': { price: 28000, watts: 700, stock: 16 },
  B200: { price: 40000, watts: 1000, stock: 10_000 },
  L40S: { price: 9000, watts: 350, stock: 10_000, requiresPsu: 'PSU-6000-TI' },
};

export const optionPrices = {
  ramPerGb: 8,
  storagePerTb: 150,
  cpu: { 'XEON-8580': 1500 } as Record<string, number>,
};

export const negotiatedPrices: Record<string, Record<string, number>> = { 'C-ACME': { 'UV-AI-8X': 42000 } };

export const discountCodes: Record<string, { percent: number; expired?: boolean; emailDomain?: string }> = {
  AIWEEK10: { percent: 10 },
  SUMMER2025: { percent: 15, expired: true },
  EDU15: { percent: 15, emailDomain: '.edu' },
};

export const taxRates: Record<string, number> = { 'US-CA': 7.25, 'US-TX': 6.25, 'US-OR': 0 };
export const shippingRates: Record<string, number> = { ground: 250, express: 750, freight: 1500 };

export const policy = {
  supportedCurrencies: ['USD'],
  maxDiscountPercent: 30,
  salesRepDiscountAuthorityPercent: 10,
  highValueThreshold: 1_000_000,
  minMarginPercent: 15,
  validityDays: 30,
  pricingTimeoutMs: 2000,
};
