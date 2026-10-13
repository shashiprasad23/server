import { test, expect } from '../../src/fixtures';
import { data, newCustomer, quoteInput, serverItem } from '../../src/data/factories';
import { expectedTotals, round2 } from '../../src/utils/money';

const noShipping = { shipping: undefined };

test.describe('Pricing, discounts, and tax calculations', () => {
  test('SQ-021 Line totals and subtotal are accurate @P0 @smoke', async ({ sales }) => {
    const svc = data.serviceSkus;
    const q = await sales.createQuoteOk(
      quoteInput({
        ...noShipping,
        items: [serverItem(2), { sku: svc.installation, quantity: 2 }, { sku: svc.support, quantity: 1 }],
      }),
    );
    for (const l of q.items) expect(l.lineTotal).toBe(round2(l.unitPrice * l.quantity));
    expect(q.items[0].unitPrice).toBe(data.server.basePrice);
    expect(q.subtotal).toBe(round2(q.items.reduce((s, l) => s + l.lineTotal, 0)));
  });

  test('SQ-022 Volume tiers apply for 1, 10 and 50 identical servers @P0', async ({ sales }) => {
    for (const tier of data.volumeTiers) {
      const q = await sales.createQuoteOk(quoteInput({ ...noShipping, items: [serverItem(tier.qty)] }));
      expect(q.items[0].unitPrice, `qty ${tier.qty}`).toBe(tier.expectedUnitPrice);
      expect(q.items[0].lineTotal).toBe(round2(tier.expectedUnitPrice * tier.qty));
    }
  });

  test('SQ-023 Negotiated customer price list is applied @P0', async ({ sales }) => {
    const nc = data.negotiatedCustomer;
    const q = await sales.createQuoteOk(
      quoteInput({ customer: { email: nc.email }, items: [{ sku: nc.sku, quantity: 1 }] }),
    );
    expect(q.items[0].unitPrice).toBe(nc.expectedUnitPrice);
    const list = await sales.createQuoteOk(quoteInput({ items: [{ sku: nc.sku, quantity: 1 }] }));
    expect(list.items[0].unitPrice, 'other customers get list price').toBe(data.server.basePrice);
  });

  test('SQ-024 Valid discount code is applied and totals updated @P1', async ({ sales }) => {
    const d = data.discounts;
    expect(await (await sales.validateDiscount(d.valid)).json()).toMatchObject({
      valid: true,
      percent: d.validPercent,
    });
    const q = await sales.createQuoteOk(quoteInput({ ...noShipping, discountCode: d.valid }));
    expect(q.discount?.percent).toBe(d.validPercent);
    expect(q.discountTotal).toBe(round2((q.subtotal * d.validPercent) / 100));
    expect(q.grandTotal).toBe(round2(q.subtotal - q.discountTotal + q.taxTotal + q.shippingTotal));
  });

  for (const kind of ['expired', 'invalid', 'ineligible'] as const) {
    test(`SQ-025 ${kind} discount code is rejected with a clear message @P1`, async ({ sales }) => {
      const code = data.discounts[kind];
      const v = await (await sales.validateDiscount(code, newCustomer().email)).json();
      expect(v.valid).toBe(false);
      expect(v.message).toMatch(
        new RegExp(kind === 'invalid' ? 'invalid' : kind === 'expired' ? 'expired' : 'eligible', 'i'),
      );
      const res = await sales.createQuote(quoteInput({ discountCode: code }));
      expect(res.status()).toBe(422);
      expect((await res.json()).errors.discountCode).toBeTruthy();
    });
  }

  test('SQ-026 Discount above the maximum is rejected; above rep authority needs approval @P0', async ({
    sales,
  }) => {
    const over = await sales.createQuote(quoteInput({ manualDiscountPercent: data.maxDiscountPercent + 1 }));
    expect(over.status()).toBe(422);
    const routed = await sales.createQuoteOk(
      quoteInput({ manualDiscountPercent: data.salesRepDiscountAuthorityPercent + 5 }),
    );
    const submitted = await sales.submit(routed.id);
    expect(submitted.status).toBe('PendingApproval');
    expect(submitted.approval.reasons).toContain('discount-exceeds-authority');
  });

  test('SQ-027 Tax: taxable base, tax and grand total are correct @P0', async ({ sales }) => {
    const q = await sales.createQuoteOk(
      quoteInput({
        items: [
          serverItem(1),
          { sku: data.serviceSkus.installation, quantity: 1 },
          { sku: data.leaseSku, quantity: 1 },
        ],
        discountCode: data.discounts.valid,
        shipping: { destination: data.tax.destination, method: data.shipping.method },
      }),
    );
    const exp = expectedTotals(q.items, q.discount?.percent ?? 0, data.tax.ratePercent, q.shippingTotal);
    expect(q).toMatchObject(exp);
    expect(q.items.find((l) => l.sku === data.leaseSku)!.taxable, 'lease is not taxable').toBe(false);
  });

  test('SQ-028 Shipping cost for destination and method is included @P1', async ({ sales }) => {
    const q = await sales.createQuoteOk(
      quoteInput({ shipping: { destination: data.shipping.destination, method: data.shipping.method } }),
    );
    expect(q.shippingTotal).toBe(data.shipping.expectedCost);
    expect(q.grandTotal).toBe(round2(q.subtotal - q.discountTotal + q.taxTotal + data.shipping.expectedCost));
  });

  test('SQ-029 Only supported currencies can be quoted; totals are consistent @P1', async ({ sales }) => {
    for (const currency of data.supportedCurrencies) {
      const q = await sales.createQuoteOk(quoteInput({ currency }));
      expect(q.currency).toBe(currency);
    }
    const res = await sales.createQuote(quoteInput({ currency: data.unsupportedCurrency }));
    expect(res.status()).toBe(422);
    expect((await res.json()).errors.currency).toMatch(/not supported/i);
  });

  for (const price of [0, -100]) {
    test(`SQ-030 Unit price ${price} is rejected @P0`, async ({ sales }) => {
      const q = await sales.createQuoteOk(quoteInput());
      const res = await sales.overridePrice(q.id, q.items[0].lineId, price, 'automation check');
      expect(res.status()).toBe(422);
      expect((await sales.getQuoteOk(q.id)).items[0].unitPrice).toBe(q.items[0].unitPrice);
    });
  }

  test('SQ-031 Quantity change after discount recalculates every total @P0', async ({ sales }) => {
    const q = await sales.createQuoteOk(
      quoteInput({ discountCode: data.discounts.valid, items: [serverItem(1)] }),
    );
    const u = await sales.updateQuoteOk(q.id, { items: [{ sku: data.server.sku, quantity: 3 }] });
    expect(u.items[0].quantity).toBe(3);
    expect(u.subtotal).toBe(round2(u.items[0].unitPrice * 3));
    expect(u).toMatchObject(
      expectedTotals(u.items, data.discounts.validPercent, data.tax.ratePercent, u.shippingTotal),
    );
    expect(u.discountTotal).toBeGreaterThan(q.discountTotal);
  });
});
