import { test, expect } from '../../src/fixtures';
import { baseServerConfig, data, quoteInput, serverItem } from '../../src/data/factories';
import { round2 } from '../../src/utils/money';
import { pdfText } from '../../src/utils/pdf';

const s = data.server;

test.describe('AI infrastructure-specific edge cases', () => {
  test('SQ-064 Scarce GPU quantity shows constraint with alternative and lead time @P1', async ({
    sales,
  }) => {
    const cfg = baseServerConfig({ gpu: { model: s.scarceGpuModel, count: 8 } });
    const q = await sales.createQuoteOk(quoteInput({ items: [serverItem(4, cfg)] }));
    const line = q.items[0];
    expect(line.availability.status).toBe('constrained');
    expect(line.availability.message).toMatch(/available|lead time/i);
    expect(line.availability.alternatives?.length).toBeGreaterThan(0);
    expect(line.leadTimeDays).toBeGreaterThan(0);
    expect(q.terms.deliveryEstimate).toContain(String(line.leadTimeDays));
  });

  test('SQ-065 GPU needing a different PSU updates the dependent component @P0', async ({ sales }) => {
    const cfg = baseServerConfig({ gpu: { model: s.psuDependentGpuModel, count: 8 } });
    const v = await sales.validateConfigurationOk(cfg);
    const psu = v.adjustments.find((a) => a.component === 'psu');
    // Either the configurator auto-corrects the PSU, or it blocks the configuration. Silent acceptance is a defect.
    expect(psu !== undefined || v.valid === false).toBe(true);
    if (psu) {
      const q = await sales.createQuoteOk(quoteInput({ items: [serverItem(1, cfg)] }));
      expect(q.items[0].configuration?.psu).toBe(psu.to);
    }
  });

  test('SQ-066 Custom-built server request is routed to technical and commercial review @P1', async ({
    sales,
  }) => {
    const customSpec = '16x GPU custom chassis, immersion cooling, 800V DC power shelf';
    const q = await sales.createQuoteOk(quoteInput({ customSpec, items: [serverItem(1)] }));
    expect(q.review).toEqual({ technical: true, commercial: true });
    const submitted = await sales.submit(q.id);
    expect(submitted.status).toBe('PendingApproval');
    expect(submitted.approval.reasons).toEqual(
      expect.arrayContaining(['technical-review', 'commercial-review']),
    );
    expect((await sales.getQuoteOk(q.id)).customSpec, 'custom specification is captured').toBe(customSpec);
  });

  test('SQ-067 Products with different lead times get per-item delivery estimates @P1', async ({ sales }) => {
    const q = await sales.createQuoteOk(
      quoteInput({ items: [serverItem(1), { sku: 'NET-SW-400G', quantity: 2 }] }),
    );
    const times = q.items.map((l) => l.leadTimeDays);
    expect(new Set(times).size).toBe(2);
    for (const l of q.items) expect(q.terms.deliveryEstimate).toContain(`${l.sku}: ${l.leadTimeDays} days`);
    const text = (await pdfText(await (await sales.pdf(q.id)).body())).replace(/\s+/g, ' ');
    for (const l of q.items) expect(text).toContain(`${l.sku}: ${l.leadTimeDays} days`);
  });

  test('SQ-068 GPU lease: recurring charge, term and deposit are correct @P1', async ({ sales }) => {
    const product = await (await sales.getProduct(data.leaseSku)).json();
    const qty = 2;
    const q = await sales.createQuoteOk(quoteInput({ items: [{ sku: data.leaseSku, quantity: qty }] }));
    const l = q.items[0];
    expect(l.type).toBe('lease');
    expect(l.recurring).toMatchObject({ period: 'month', termMonths: product.lease.termMonths });
    expect(l.recurring!.deposit).toBe(product.basePrice * product.lease.depositMonths);
    expect(l.recurring!.recurringTotal).toBe(round2(product.basePrice * product.lease.termMonths * qty));
    expect(l.lineTotal, 'due at signing = deposit + first month').toBe(
      round2((l.recurring!.deposit + l.unitPrice) * qty),
    );
  });

  test('SQ-069 Cloud GPU / managed AI infrastructure services @P1', async () => {
    test.info().annotations.push({
      type: 'NA',
      description: 'Marked NA in the test plan: service not offered on the marketplace',
    });
    test.skip(true, 'NA in test plan');
  });

  test('SQ-070 SLA and extended warranty terms are on the quote @P1', async ({ sales }) => {
    const svc = data.serviceSkus;
    const q = await sales.createQuoteOk(
      quoteInput({
        items: [serverItem(1), { sku: svc.sla, quantity: 1 }, { sku: svc.warranty, quantity: 1 }],
      }),
    );
    expect(q.items.map((l) => l.sku)).toEqual(expect.arrayContaining([svc.sla, svc.warranty]));
    expect(q.terms.warranty).toMatch(/3-year/i);
    expect(q.terms.warranty).toMatch(/SLA/i);
    const text = await pdfText(await (await sales.pdf(q.id)).body());
    expect(text).toMatch(/SLA/);
  });

  test('SQ-073 High-value quote requires finance approval @P0', async ({ sales, approver, finance }) => {
    const qty = Math.ceil(data.highValueThreshold / 300_000) + 1;
    const q = await sales.createQuoteOk(quoteInput({ items: [serverItem(qty, baseServerConfig())] }));
    expect(q.grandTotal).toBeGreaterThan(data.highValueThreshold);
    const pending = await sales.submit(q.id);
    expect(pending.status).toBe('PendingApproval');
    expect(pending.approval.reasons).toContain('high-value');
    expect((await approver.action(q.id, 'approve')).status(), 'regular approver is not enough').toBe(403);
    const approved = await finance.approve(q.id);
    expect(approved.status).toBe('Approved');
    expect(approved.approval.approvals.map((a) => a.role)).toContain('finance');
  });

  test('SQ-074 Unsupported component combination cannot be issued @P0', async ({ sales }) => {
    const cfg = baseServerConfig({
      cpu: s.incompatibleCpu,
      gpu: { model: s.overPowerGpuModel, count: s.overPowerGpuCount },
      nic: s.unsupportedNic,
    });
    const v = await sales.validateConfigurationOk(cfg);
    expect(v.valid).toBe(false);
    expect(v.errors.length).toBeGreaterThanOrEqual(3);
    const res = await sales.createQuote(
      quoteInput({ customSpec: 'Custom build', items: [serverItem(1, cfg)] }),
    );
    expect(res.status(), 'custom quote with invalid parts is not created').toBe(422);
  });
});
