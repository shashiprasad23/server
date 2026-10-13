import { request, test } from '@playwright/test';
import { env } from '../../config/env';
import { endpoints } from '../../config/endpoints';

export type Fault =
  | { emailFailure: boolean }
  | { pricingLatencyMs: number }
  | { crashDuringCreate: boolean }
  | {
      catalog: {
        sku: string;
        basePrice?: number;
        cost?: number;
        specVersion?: number;
        availability?: string;
      };
    }
  | { expireQuote: string };

/** Fault-injection hooks. Tests needing them are skipped on environments without the /__test endpoints. */
export class Faults {
  static requireEnabled() {
    test.skip(
      !env.faultInjection,
      'Fault injection hooks are disabled on this environment (FAULT_INJECTION=false)',
    );
  }

  private async post(path: string, data: unknown) {
    const ctx = await request.newContext({ baseURL: env.apiBaseUrl });
    try {
      const res = await ctx.post(path, { data });
      if (!res.ok()) throw new Error(`Fault hook ${path} failed: ${res.status()} ${await res.text()}`);
      return res.json();
    } finally {
      await ctx.dispose();
    }
  }

  set(fault: Fault) {
    return this.post(endpoints.fault, fault);
  }

  reset() {
    return this.post(endpoints.fault, { reset: true });
  }

  restartService() {
    return this.post(endpoints.restart, {});
  }

  async logs(correlationId: string): Promise<{ level: string; message: string; correlationId: string }[]> {
    const ctx = await request.newContext({ baseURL: env.apiBaseUrl });
    try {
      return await (await ctx.get('/__test/logs', { params: { correlationId } })).json();
    } finally {
      await ctx.dispose();
    }
  }
}
