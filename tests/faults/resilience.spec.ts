/**
 * Scenarios that change global state (catalog prices, supplier cost, email provider outage, crashes).
 * They run serially in their own CI stage so they cannot disturb the parallel functional suites.
 */
import { test, expect } from '../../src/fixtures';
import { Faults } from '../../src/utils/faults';
import { data, idempotencyKey, quoteInput, serverItem } from '../../src/data/factories';
import type { Quote } from '../../src/api/types';

test.describe.configure({ mode: 'serial' });
test.beforeEach(() => Faults.requireEnabled());

test('SQ-032 Price-list change mid-session honours the price lock and records repricing @P0', async ({
  sales,
  faults,
}) => {
  const q = await sales.createQuoteOk(quoteInput({ items: [serverItem(1)] }));
  await faults.set({ catalog: { sku: data.server.sku, basePrice: data.server.basePrice + 5000 } });

  expect((await sales.getQuoteOk(q.id)).items[0].unitPrice, 'existing quote is not silently repriced').toBe(
    q.items[0].unitPrice,
  );
  const qtyChange = await sales.updateQuoteOk(q.id, { items: [{ sku: data.server.sku, quantity: 2 }] });
  expect(qtyChange.items[0].unitPrice, 'locked price kept during edits').toBe(q.items[0].unitPrice);

  const repriced = await sales.updateQuoteOk(q.id, { reprice: true });
  expect(repriced.items[0].unitPrice).toBe(data.server.basePrice + 5000);
  expect(repriced.priceLock.priceListVersion).toBeGreaterThan(q.priceLock.priceListVersion);
  const entry = (await sales.audit(q.id)).find((a) => a.action === 'repriced');
  expect(entry?.details).toMatchObject({ from: q.items[0].unitPrice, to: data.server.basePrice + 5000 });

  const fresh = await sales.createQuoteOk(quoteInput({ items: [serverItem(1)] }));
  expect(fresh.items[0].unitPrice, 'new quotes use the new list price').toBe(data.server.basePrice + 5000);
});

test('SQ-040 Email provider failure is logged, visible and retryable without duplicates @P0', async ({
  quoteIn,
  sales,
  faults,
  mailbox,
}) => {
  const q = await quoteIn('Approved');
  await faults.set({ emailFailure: true });
  const failed = await sales.send(q.id, [q.customer.email]);
  expect(failed.status()).toBeGreaterThanOrEqual(500);
  const body = await failed.json();
  expect(body.correlationId).toBeTruthy();
  expect((await sales.emails(q.id)).map((e) => e.status)).toContain('failed');
  expect((await sales.audit(q.id)).map((a) => a.action)).toContain('email-failed');
  expect((await sales.getQuoteOk(q.id)).status, 'not marked Sent on failure').toBe('Approved');
  expect((await faults.logs(body.correlationId)).some((l) => l.level === 'error')).toBe(true);

  await faults.set({ emailFailure: false });
  expect((await sales.send(q.id, [q.customer.email])).status(), 'retry succeeds').toBe(200);
  await mailbox.waitFor(`to:${q.customer.email}`);
  const sameCustomer: Quote[] = await (await sales.listQuotes({ customerEmail: q.customer.email })).json();
  expect(sameCustomer, 'no duplicate quote created').toHaveLength(1);
});

test('SQ-053 Item becoming unavailable blocks conversion with a fulfillment exception @P1', async ({
  quoteIn,
  sales,
  faults,
}) => {
  const q = await quoteIn('Accepted', { items: [{ sku: 'NET-SW-400G', quantity: 2 }] });
  await faults.set({ catalog: { sku: 'NET-SW-400G', availability: 'unavailable' } });
  const res = await sales.convert(q.id);
  expect(res.status()).toBe(409);
  expect((await res.json()).error).toMatch(/no longer available|fulfil/i);
  expect(await (await sales.ordersForQuote(q.id)).json()).toHaveLength(0);
  expect((await sales.audit(q.id)).map((a) => a.action)).toContain('conversion-blocked');
});

test('SQ-061 Interrupted creation leaves no partial quote and is safely retryable @P0', async ({
  sales,
  faults,
}) => {
  const input = quoteInput();
  const key = idempotencyKey();
  await faults.set({ crashDuringCreate: true });
  const crashed = await sales.createQuote(input, key);
  expect(crashed.status()).toBeGreaterThanOrEqual(500);
  expect(await (await sales.listQuotes({ customerEmail: input.customer.email! })).json()).toHaveLength(0);

  await faults.set({ crashDuringCreate: false });
  const retried = await sales.createQuoteOk(input, key);
  const again = await sales.createQuoteOk(input, key);
  expect(again.id).toBe(retried.id);
  expect(await (await sales.listQuotes({ customerEmail: input.customer.email! })).json()).toHaveLength(1);
});

test('SQ-071 Catalog spec change does not alter an existing quote @P0', async ({ sales, faults }) => {
  const q = await sales.createQuoteOk(quoteInput({ items: [serverItem(1)] }));
  await faults.set({ catalog: { sku: data.server.sku, specVersion: 2 } });
  const after = await sales.getQuoteOk(q.id);
  expect(after.items[0].specVersion).toBe(q.items[0].specVersion);
  expect(after.items[0].unitPrice).toBe(q.items[0].unitPrice);
  const edited = await sales.updateQuoteOk(q.id, { items: [{ sku: data.server.sku, quantity: 2 }] });
  expect(edited.items[0].specVersion, 'edit keeps the quoted spec version').toBe(q.items[0].specVersion);
});

test('SQ-072 Supplier cost increase before approval re-evaluates margin @P0', async ({ sales, faults }) => {
  const q = await sales.createQuoteOk(quoteInput({ items: [serverItem(1)] }));
  await faults.set({ catalog: { sku: data.server.sku, cost: data.server.basePrice * 0.95 } });
  const submitted = await sales.submit(q.id);
  expect(submitted.status).toBe('PendingApproval');
  expect(submitted.approval.reasons).toContain('margin-below-threshold');
  expect(submitted.items[0].unitPrice, 'customer price stays locked').toBe(q.items[0].unitPrice);
});

test('NFR-005 Pricing latency: timeout fails safely, retry creates exactly one quote @P0', async ({
  sales,
  faults,
}) => {
  const input = quoteInput();
  const key = idempotencyKey();
  await faults.set({ pricingLatencyMs: 10_000 });
  const started = Date.now();
  const slow = await sales.createQuote(input, key);
  expect(slow.status()).toBe(503);
  expect(Date.now() - started, 'request bounded by pricing timeout').toBeLessThan(8_000);
  expect((await slow.json()).correlationId).toBeTruthy();
  expect(await (await sales.listQuotes({ customerEmail: input.customer.email! })).json()).toHaveLength(0);

  await faults.set({ pricingLatencyMs: 0 });
  await sales.createQuoteOk(input, key);
  await sales.createQuoteOk(input, key);
  expect(await (await sales.listQuotes({ customerEmail: input.customer.email! })).json()).toHaveLength(1);
});

test('NFR-006 Service restart keeps persisted quotes consistent and retries idempotent @P0', async ({
  sales,
  faults,
}) => {
  const key = idempotencyKey();
  const input = quoteInput();
  const before = await Promise.all([sales.createQuoteOk(input, key), sales.createQuoteOk(quoteInput())]);
  await faults.restartService();
  for (const q of before) {
    const after = await sales.getQuoteOk(q.id);
    expect(after).toMatchObject({
      number: q.number,
      grandTotal: q.grandTotal,
      subtotal: q.subtotal,
      status: q.status,
    });
  }
  const retry = await sales.createQuoteOk(input, key);
  expect(retry.id, 'idempotency survives restart').toBe(before[0].id);
});

test('NFR-009 Pricing, PDF and email failures are traceable by correlation ID @P1', async ({
  quoteIn,
  sales,
  faults,
}) => {
  const q = await quoteIn('Approved');
  await faults.set({ emailFailure: true, pricingLatencyMs: 10_000 });
  for (const res of [await sales.send(q.id, [q.customer.email]), await sales.createQuote(quoteInput())]) {
    const header = res.headers()['x-correlation-id'];
    const { correlationId } = await res.json();
    expect(header).toBeTruthy();
    expect(correlationId).toBe(header);
    const logs = await faults.logs(correlationId);
    expect(logs.length, `logs for ${res.url()}`).toBeGreaterThan(0);
    expect(logs[0].level).toBe('error');
  }
  const pdf = await sales.ctx.get(`/api/quotes/00000000-0000-0000-0000-000000000000/pdf`);
  expect(pdf.headers()['x-correlation-id']).toBeTruthy();
});
