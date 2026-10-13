/**
 * Non-functional checks that are meaningful at CI scale. Peak-load and soak runs use k6 (perf/k6) against staging.
 * NFR-005, NFR-006 and NFR-009 need fault injection and live in tests/faults.
 */
import { test, expect } from '../../src/fixtures';
import { env } from '../../config/env';
import { data, newCustomer, quoteInput, serverItem } from '../../src/data/factories';
import { expectedTotals } from '../../src/utils/money';
import { pdfText } from '../../src/utils/pdf';
import { runLoad } from '../../src/utils/load';
import type { Quote } from '../../src/api/types';

test.skip(env.isProd, 'Load tests never run against production');
test.describe.configure({ mode: 'serial' });

const attach = (name: string, stats: unknown) =>
  test.info().annotations.push({ type: name, description: JSON.stringify(stats) });

test('NFR-001 Concurrent quote requests are not lost, duplicated or cross-linked @P0', async ({ sales }) => {
  const inputs = Array.from({ length: env.nfr.concurrency }, () => quoteInput());
  const responses = await Promise.all(inputs.map((i) => sales.createQuote(i)));
  const quotes: Quote[] = await Promise.all(responses.map((r) => r.json()));
  expect(responses.map((r) => r.status())).toEqual(inputs.map(() => 201));
  expect(new Set(quotes.map((q) => q.id)).size).toBe(inputs.length);
  expect(new Set(quotes.map((q) => q.number)).size).toBe(inputs.length);
  quotes.forEach((q, i) => expect(q.customer.email).toBe(inputs[i].customer.email!.toLowerCase()));
  for (const i of inputs) {
    const list: Quote[] = await (await sales.listQuotes({ customerEmail: i.customer.email! })).json();
    expect(list).toHaveLength(1);
  }
});

test('NFR-002 Quote generation at peak load meets the latency SLA @P0', async ({ sales }) => {
  const stats = await runLoad(env.nfr.concurrency * 4, env.nfr.concurrency, async () => {
    const r = await sales.createQuote(quoteInput({ items: [serverItem(1, undefined)] }));
    return r.status() === 201;
  });
  attach('load-stats', stats);
  expect(stats.errorRate).toBe(0);
  expect(stats.p95, `p95 ${stats.p95}ms`).toBeLessThanOrEqual(env.nfr.p95Ms);
});

test('NFR-003 Quote with hundreds of line items generates a complete PDF in time @P1', async ({ sales }) => {
  const skus = ['SVC-RACK-INSTALL', 'SVC-SUPPORT-247', 'SVC-WARRANTY-3Y', 'NET-SW-400G'];
  const items = Array.from({ length: 300 }, (_, i) => ({
    sku: skus[i % skus.length],
    quantity: 1,
    description: `Line ${i + 1}`,
  }));
  const q = await sales.createQuoteOk(quoteInput({ items }));
  expect(q.items).toHaveLength(300);
  const t = Date.now();
  const res = await sales.pdf(q.id);
  const elapsed = Date.now() - t;
  attach('pdf-ms', elapsed);
  expect(res.status()).toBe(200);
  expect(elapsed).toBeLessThan(15_000);
  const text = await pdfText(await res.body());
  expect(text).toContain('Line 1');
  expect(text).toContain('Line 300');
  expect(text).toContain(q.grandTotal.toFixed(2));
});

test('NFR-004 Burst of quote emails is fully delivered and tracked @P1', async ({
  quoteIn,
  sales,
  mailbox,
}) => {
  const burst = 15;
  const quotes = await Promise.all(Array.from({ length: burst }, () => quoteIn('Approved')));
  const sends = await Promise.all(quotes.map((q) => sales.send(q.id, [q.customer.email])));
  expect(sends.map((s) => s.status())).toEqual(quotes.map(() => 200));
  for (const q of quotes) {
    await mailbox.waitFor(`to:${q.customer.email}`, 1, 60_000);
    const records = await sales.emails(q.id);
    expect(records.filter((r) => r.status === 'failed')).toHaveLength(0);
  }
});

test('NFR-007 Persisted prices and totals stay consistent across updates @P0', async ({ sales }) => {
  const q = await sales.createQuoteOk(
    quoteInput({ items: [serverItem(2), { sku: data.serviceSkus.support, quantity: 1 }] }),
  );
  const steps = [
    {
      items: [
        { sku: data.server.sku, quantity: 5 },
        { sku: data.serviceSkus.support, quantity: 2 },
      ],
    },
    { discountCode: data.discounts.valid },
    { items: [{ sku: data.server.sku, quantity: 1 }] },
  ];
  for (const patch of steps) {
    const updated = await sales.updateQuoteOk(q.id, patch);
    const stored = await sales.getQuoteOk(q.id);
    expect(stored).toMatchObject({
      subtotal: updated.subtotal,
      grandTotal: updated.grandTotal,
      taxTotal: updated.taxTotal,
    });
    expect(stored).toMatchObject(
      expectedTotals(stored.items, stored.discount?.percent ?? 0, data.tax.ratePercent, stored.shippingTotal),
    );
    const listed: Quote[] = await (await sales.listQuotes({ customerEmail: q.customer.email })).json();
    expect(listed[0].grandTotal).toBe(stored.grandTotal);
  }
});

test('NFR-008 Unauthorized access and quote tampering are prevented @P0', async ({
  sales,
  anonymous,
  customer,
  otherCustomer,
}) => {
  const q = await sales.createQuoteOk(quoteInput({ customer: { email: data.registeredCustomer.email } }));
  const protectedCalls = [
    () => anonymous.getQuote(q.id),
    () => anonymous.listQuotes(),
    () => anonymous.pdf(q.id),
    () => anonymous.updateQuote(q.id, { notes: 'x' }),
    () => anonymous.action(q.id, 'submit'),
    () => anonymous.action(q.id, 'approve'),
    () => anonymous.ctx.get(`/api/quotes/${q.id}/audit`),
    () => anonymous.lookupCustomer(data.registeredCustomer.email),
  ];
  for (const call of protectedCalls) expect([401, 403, 404]).toContain((await call()).status());
  for (const call of [
    () => otherCustomer.updateQuote(q.id, { notes: 'x' }),
    () => customer.updateQuote(q.id, { notes: 'x' }),
  ])
    expect([403, 404]).toContain((await call()).status());

  // Mass-assignment: server-computed fields cannot be set by the client.
  const tampered = await sales.updateQuoteOk(q.id, {
    notes: 'tamper',
    ...({ grandTotal: 1, status: 'Approved', customer: { companyId: 'C-GLOBEX' } } as any),
  });
  expect(tampered.grandTotal).toBe(q.grandTotal);
  expect(tampered.status).toBe('Draft');
  expect(tampered.customer.companyId).toBe(q.customer.companyId);
});

test('NFR-010 Throughput scales with load within latency and error targets @P1', async ({ sales }) => {
  const stages = [
    Math.max(1, Math.floor(env.nfr.concurrency / 4)),
    Math.floor(env.nfr.concurrency / 2),
    env.nfr.concurrency,
  ];
  const results = [];
  for (const c of stages) {
    const stats = await runLoad(
      c * 3,
      c,
      async () => (await sales.createQuote(quoteInput({ customer: newCustomer() }))).status() === 201,
    );
    results.push({ concurrency: c, ...stats });
    expect(stats.errorRate, `error rate at ${c}`).toBeLessThan(0.01);
    expect(stats.p95, `p95 at concurrency ${c}`).toBeLessThanOrEqual(env.nfr.p95Ms);
  }
  attach('scalability', results);
});
