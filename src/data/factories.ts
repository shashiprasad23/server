import { randomUUID } from 'node:crypto';
import { loadTestData } from '../../config/env';
import type { CreateQuoteInput, QuoteItemInput, ServerConfiguration } from '../api/types';

export const data = loadTestData();

const runId = Date.now().toString(36);
let seq = 0;

/** Unique per run so tests never collide on shared environments. */
export function uniqueEmail(prefix = 'qa') {
  return `${prefix}+${runId}-${++seq}@uvation-qa.test`;
}

export const idempotencyKey = () => randomUUID();

export function newCustomer(overrides: Partial<CreateQuoteInput['customer']> = {}) {
  return {
    companyName: `QA Compute ${runId}-${seq}`,
    contactName: 'Automation Buyer',
    email: uniqueEmail('buyer'),
    phone: '+14155550123',
    ...overrides,
  };
}

export function baseServerConfig(overrides: Partial<ServerConfiguration> = {}): ServerConfiguration {
  const s = data.server;
  return {
    model: s.model,
    cpu: s.validCpu,
    motherboard: s.motherboard,
    gpu: { model: s.gpuModel, count: 8 },
    ramGb: 1024,
    storageTb: 30,
    nic: s.supportedNic,
    ...overrides,
  };
}

export function serverItem(quantity = 1, configuration?: ServerConfiguration): QuoteItemInput {
  return { sku: data.server.sku, quantity, configuration };
}

export function quoteInput(overrides: Partial<CreateQuoteInput> = {}): CreateQuoteInput {
  return {
    customer: newCustomer(),
    inquiryType: 'product',
    currency: data.currency,
    items: [serverItem(1)],
    shipping: { destination: data.shipping.destination, method: data.shipping.method },
    ...overrides,
  };
}
