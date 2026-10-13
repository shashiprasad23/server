import { test, expect } from '../../src/fixtures';
import { data, quoteInput, serverItem } from '../../src/data/factories';
import type { Quote } from '../../src/api/types';
import { Faults } from '../../src/utils/faults';

test.describe('Approval, quote lifecycle, and order conversion', () => {
  test('SQ-044 Quote within rep discount authority is approved without escalation @P0 @smoke', async ({
    sales,
  }) => {
    const q = await sales.createQuoteOk(
      quoteInput({ manualDiscountPercent: data.salesRepDiscountAuthorityPercent }),
    );
    const s = await sales.submit(q.id);
    expect(s.status).toBe('Approved');
    expect(s.approval.required).toBe(false);
  });

  test('SQ-045 High discount cannot be issued until the approver acts @P0', async ({ sales, approver }) => {
    const q = await sales.createQuoteOk(
      quoteInput({ manualDiscountPercent: data.salesRepDiscountAuthorityPercent + 5 }),
    );
    const pending = await sales.submit(q.id);
    expect(pending.status).toBe('PendingApproval');
    const early = await sales.send(q.id, [q.customer.email]);
    expect(early.status(), 'cannot send before approval').toBe(409);
    expect((await sales.approve(q.id).catch((e) => e)).message, 'sales cannot self-approve').toMatch(/403/);
    const approved = await approver.approve(q.id);
    expect(approved.status).toBe('Approved');
    expect(approved.approval.approvals[0]).toMatchObject({ role: 'approver' });
    expect((await sales.send(q.id, [q.customer.email])).status()).toBe(200);
  });

  test('SQ-046 Rejection records the reason and returns quote for correction @P1', async ({
    sales,
    approver,
  }) => {
    const q = await sales.createQuoteOk(quoteInput({ manualDiscountPercent: 20 }));
    await sales.submit(q.id);
    const noReason = await approver.action(q.id, 'reject', {});
    expect(noReason.status(), 'reason is mandatory').toBe(422);
    const rejected = await approver.reject(q.id, 'Discount too high for this account; max 12%');
    expect(rejected.status).toBe('Rejected');
    expect(rejected.approval.rejectionReason).toContain('max 12%');
    const corrected = await sales.updateQuoteOk(q.id, { manualDiscountPercent: 8 });
    expect(corrected.status).toBe('Draft');
    expect((await sales.submit(q.id)).status).toBe('Approved');
    expect((await sales.audit(q.id)).find((a) => a.action === 'rejected')?.details).toMatchObject({
      comment: expect.stringContaining('max 12%'),
    });
  });

  test('SQ-047 Status transitions follow business rules @P0', async ({ sales, approver, anonymous }) => {
    const q = await sales.createQuoteOk(quoteInput({ manualDiscountPercent: 15 }));
    const seen: string[] = [q.status];
    seen.push((await sales.submit(q.id)).status);
    seen.push((await approver.approve(q.id)).status);
    await sales.send(q.id, [q.customer.email]);
    const sent = await sales.getQuoteOk(q.id);
    seen.push(sent.status);
    await anonymous.acceptViaLink(sent.shareToken!);
    seen.push((await sales.getQuoteOk(q.id)).status);
    expect(seen).toEqual(['Draft', 'PendingApproval', 'Approved', 'Sent', 'Accepted']);

    // Illegal transitions are refused
    const d = await sales.createQuoteOk(quoteInput());
    expect((await sales.send(d.id, [d.customer.email])).status(), 'Draft -> Sent').toBe(409);
    expect((await sales.accept(d.id)).status(), 'sales cannot accept').toBe(403);
    expect((await sales.convert(d.id)).status(), 'Draft -> Converted').toBe(409);
  });

  test('SQ-048 Expired quote cannot be accepted @P0', async ({ quoteIn, faults, sales, anonymous }) => {
    Faults.requireEnabled();
    const q = await quoteIn('Sent');
    await faults.set({ expireQuote: q.id });
    const res = await anonymous.acceptViaLink(q.shareToken!);
    expect(res.status()).toBe(409);
    expect((await res.json()).error).toMatch(/expired/i);
    const after = await sales.getQuoteOk(q.id);
    expect(after.status).toBe('Expired');
    expect(after.acceptedAt).toBeUndefined();
  });

  test('SQ-049 Revising an issued quote creates a new revision and keeps the old one @P0', async ({
    quoteIn,
    sales,
  }) => {
    const q = await quoteIn('Sent');
    const revised = await sales.updateQuoteOk(q.id, { items: [{ sku: data.server.sku, quantity: 4 }] });
    expect(revised.revision).toBe(q.revision + 1);
    const revisions: Quote[] = await (await sales.revisions(q.id)).json();
    expect(revisions.map((r) => r.revision)).toEqual([1, 2]);
    expect(revisions[0].items[0].quantity).toBe(q.items[0].quantity);
    expect(revisions[0].grandTotal).toBe(q.grandTotal);
    expect(revisions[1].items[0].quantity).toBe(4);
  });

  test('SQ-050 Customer acceptance is recorded with timestamp and revision @P0 @smoke', async ({
    quoteIn,
    sales,
    anonymous,
  }) => {
    const q = await quoteIn('Sent');
    const before = Date.now();
    const res = await anonymous.acceptViaLink(q.shareToken!);
    expect(res.status()).toBe(200);
    const a = await sales.getQuoteOk(q.id);
    expect(a.status).toBe('Accepted');
    expect(a.acceptedRevision).toBe(q.revision);
    expect(new Date(a.acceptedAt!).getTime()).toBeGreaterThanOrEqual(before - 5000);
  });

  test('SQ-051 Accepted quote converts to an order with identical commercial data @P0 @smoke', async ({
    quoteIn,
    sales,
  }) => {
    const q = await quoteIn('Accepted', {
      items: [serverItem(2), { sku: data.serviceSkus.installation, quantity: 2 }],
      discountCode: data.discounts.valid,
    });
    const res = await sales.convert(q.id);
    expect(res.status()).toBe(201);
    const order = await res.json();
    expect(order).toMatchObject({
      quoteId: q.id,
      currency: q.currency,
      subtotal: q.subtotal,
      discountTotal: q.discountTotal,
      taxTotal: q.taxTotal,
      shippingTotal: q.shippingTotal,
      grandTotal: q.grandTotal,
      terms: q.terms,
    });
    expect(order.customer).toMatchObject({ email: q.customer.email, companyName: q.customer.companyName });
    expect(order.items.map((l: any) => [l.sku, l.quantity, l.unitPrice])).toEqual(
      q.items.map((l) => [l.sku, l.quantity, l.unitPrice]),
    );
    expect((await sales.getQuoteOk(q.id)).status).toBe('Converted');
  });

  test('SQ-052 Converting twice (incl. concurrently) creates one order @P0', async ({ quoteIn, sales }) => {
    const q = await quoteIn('Accepted');
    const results = await Promise.all([sales.convert(q.id), sales.convert(q.id)]);
    const again = await sales.convert(q.id);
    const statuses = [...results, again].map((r) => r.status());
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(2);
    expect(await (await sales.ordersForQuote(q.id)).json()).toHaveLength(1);
  });

  test('SQ-054 Cancel records reason and blocks further actions @P1', async ({
    quoteIn,
    sales,
    anonymous,
  }) => {
    const q = await quoteIn('Sent');
    expect((await sales.cancel(q.id, '')).status(), 'reason required').toBe(422);
    const res = await sales.cancel(q.id, 'Customer postponed budget to next FY');
    expect(res.status()).toBe(200);
    const c = await sales.getQuoteOk(q.id);
    expect(c.status).toBe('Cancelled');
    expect(c.cancellationReason).toContain('next FY');
    expect((await anonymous.acceptViaLink(q.shareToken!)).status()).toBe(409);
    expect((await sales.resend(q.id)).status()).toBe(409);
    expect((await sales.updateQuote(q.id, { notes: 'x' })).status()).toBe(409);
    const draft = await sales.createQuoteOk(quoteInput());
    expect(
      (await sales.cancel(draft.id, 'Duplicate request')).status(),
      'unsent quotes can be cancelled',
    ).toBe(200);
  });
});
