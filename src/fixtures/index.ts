import { test as base, expect } from '@playwright/test';
import { QuoteApi } from '../api/QuoteApi';
import type { CreateQuoteInput, Quote } from '../api/types';
import { Faults } from '../utils/faults';
import { Mailbox } from '../utils/mail';
import { quoteInput } from '../data/factories';

type Apis = {
  admin: QuoteApi;
  sales: QuoteApi;
  approver: QuoteApi;
  finance: QuoteApi;
  customer: QuoteApi;
  otherCustomer: QuoteApi;
  anonymous: QuoteApi;
};

type Fixtures = Apis & {
  mailbox: Mailbox;
  faults: Faults;
  /** Creates a quote as Sales and drives it to the requested lifecycle state. */
  quoteIn: (
    state: 'Draft' | 'Approved' | 'Sent' | 'Accepted',
    input?: Partial<CreateQuoteInput>,
  ) => Promise<Quote>;
};

function apiFixture(role: keyof Apis) {
  return async ({}, use: (api: QuoteApi) => Promise<void>) => {
    const api = await QuoteApi.create(role === 'anonymous' ? 'anonymous' : role);
    await use(api);
    await api.dispose();
  };
}

export const test = base.extend<Fixtures>({
  admin: apiFixture('admin'),
  sales: apiFixture('sales'),
  approver: apiFixture('approver'),
  finance: apiFixture('finance'),
  customer: apiFixture('customer'),
  otherCustomer: apiFixture('otherCustomer'),
  anonymous: apiFixture('anonymous'),
  mailbox: async ({}, use) => use(new Mailbox()),
  faults: async ({}, use) => {
    const faults = new Faults();
    await use(faults);
    // Never leak an injected fault into the next test.
    if (process.env.FAULT_INJECTION !== 'false') await faults.reset().catch(() => undefined);
  },
  quoteIn: async ({ sales, approver, anonymous }, use) => {
    await use(async (state, input = {}) => {
      let q = await sales.createQuoteOk(quoteInput(input));
      if (state === 'Draft') return q;
      q = await sales.submit(q.id);
      if (q.status === 'PendingApproval') q = await approver.approve(q.id);
      expect(q.status).toBe('Approved');
      if (state === 'Approved') return q;
      const sent = await sales.send(q.id, [q.customer.email]);
      expect(sent.status(), await sent.text()).toBe(200);
      q = await sales.getQuoteOk(q.id);
      if (state === 'Sent') return q;
      const acc = await anonymous.acceptViaLink(q.shareToken!);
      expect(acc.status(), await acc.text()).toBe(200);
      return sales.getQuoteOk(q.id);
    });
  },
});

export { expect };
