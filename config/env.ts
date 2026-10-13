import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';

export type Role = 'admin' | 'sales' | 'approver' | 'finance' | 'customer' | 'otherCustomer';

function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === '') throw new Error(`Missing required environment variable ${name}`);
  return v;
}

const testEnv = process.env.TEST_ENV ?? 'mock';

export const env = {
  name: testEnv,
  isMock: testEnv === 'mock',
  isProd: testEnv === 'prod',
  baseUrl: req('BASE_URL', 'http://localhost:4010'),
  apiBaseUrl: req('API_BASE_URL', process.env.BASE_URL ?? 'http://localhost:4010'),
  mailApiUrl: process.env.MAIL_API_URL ?? 'http://localhost:4010/mailpit',
  faultInjection: (process.env.FAULT_INJECTION ?? (testEnv === 'mock' ? 'true' : 'false')) === 'true',
  nfr: {
    concurrency: Number(process.env.NFR_CONCURRENCY ?? 25),
    p95Ms: Number(process.env.NFR_P95_MS ?? 2000),
  },
  credentials: {
    admin: { email: req('ADMIN_EMAIL', 'admin@uvation.test'), password: req('ADMIN_PASSWORD', 'change-me') },
    sales: { email: req('SALES_EMAIL', 'sales@uvation.test'), password: req('SALES_PASSWORD', 'change-me') },
    approver: {
      email: req('APPROVER_EMAIL', 'approver@uvation.test'),
      password: req('APPROVER_PASSWORD', 'change-me'),
    },
    finance: {
      email: req('FINANCE_EMAIL', 'finance@uvation.test'),
      password: req('FINANCE_PASSWORD', 'change-me'),
    },
    customer: {
      email: req('CUSTOMER_EMAIL', 'buyer@acme-ai.test'),
      password: req('CUSTOMER_PASSWORD', 'change-me'),
    },
    otherCustomer: {
      email: req('OTHER_CUSTOMER_EMAIL', 'buyer@globex.test'),
      password: req('OTHER_CUSTOMER_PASSWORD', 'change-me'),
    },
  } satisfies Record<Role, { email: string; password: string }>,
};

/** Environment-specific test data (SKUs, price lists, discount codes). */
export function loadTestData(): TestData {
  const file = process.env.TEST_DATA_FILE ?? `test-data/${testEnv}.json`;
  return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8')) as TestData;
}

export interface TestData {
  currency: string;
  supportedCurrencies: string[];
  unsupportedCurrency: string;
  registeredCustomer: { email: string; companyName: string; contactName: string; phone: string };
  negotiatedCustomer: { email: string; sku: string; expectedUnitPrice: number };
  server: {
    model: string;
    sku: string;
    basePrice: number;
    validCpu: string;
    incompatibleCpu: string;
    motherboard: string;
    incompatibleMotherboard: string;
    gpuModel: string;
    supportedGpuCounts: number[];
    unsupportedGpuCount: number;
    overPowerGpuModel: string;
    overPowerGpuCount: number;
    maxRamGb: number;
    maxStorageTb: number;
    supportedNic: string;
    unsupportedNic: string;
    scarceGpuModel: string;
    psuDependentGpuModel: string;
  };
  volumeTiers: { qty: number; expectedUnitPrice: number }[];
  unavailableSku: string;
  serviceSkus: { installation: string; warranty: string; support: string; sla: string };
  leaseSku: string;
  discounts: { valid: string; validPercent: number; expired: string; invalid: string; ineligible: string };
  maxDiscountPercent: number;
  salesRepDiscountAuthorityPercent: number;
  highValueThreshold: number;
  tax: { destination: string; ratePercent: number };
  shipping: { destination: string; method: string; expectedCost: number };
}
