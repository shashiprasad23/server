import { test, expect } from '../../src/fixtures';
import { baseServerConfig, data, quoteInput, serverItem } from '../../src/data/factories';
import { pdfText } from '../../src/utils/pdf';

const s = data.server;

test.describe('AI server configuration and product validation', () => {
  test('SQ-011 Server model shows correct name, SKU and base configuration @P0 @smoke', async ({ sales }) => {
    const res = await sales.getProduct(s.sku);
    expect(res.status()).toBe(200);
    const p = await res.json();
    expect(p).toMatchObject({ sku: s.sku, basePrice: s.basePrice, availability: 'available' });
    expect(p.name).toBeTruthy();
    expect(p).not.toHaveProperty('cost'); // supplier cost is never exposed

    const q = await sales.createQuoteOk(quoteInput({ items: [serverItem(1)] }));
    expect(q.items[0]).toMatchObject({ sku: s.sku, name: p.name, unitPrice: s.basePrice });
  });

  test('SQ-012 Supported GPU counts are accepted, unsupported are blocked @P0', async ({ sales }) => {
    for (const count of s.supportedGpuCounts) {
      const v = await sales.validateConfigurationOk(baseServerConfig({ gpu: { model: s.gpuModel, count } }));
      expect(v.valid, `${count} GPUs`).toBe(true);
    }
    const bad = await sales.validateConfigurationOk(
      baseServerConfig({ gpu: { model: s.gpuModel, count: s.unsupportedGpuCount } }),
    );
    expect(bad.valid).toBe(false);
    expect(bad.errors.map((e) => e.field)).toContain('gpu.count');
    const res = await sales.createQuote(
      quoteInput({
        items: [
          serverItem(1, baseServerConfig({ gpu: { model: s.gpuModel, count: s.unsupportedGpuCount } })),
        ],
      }),
    );
    expect(res.status()).toBe(422);
  });

  test('SQ-013 Incompatible CPU or motherboard is rejected @P0', async ({ sales }) => {
    const cpu = await sales.validateConfigurationOk(baseServerConfig({ cpu: s.incompatibleCpu }));
    expect(cpu.valid).toBe(false);
    expect(cpu.errors.map((e) => e.field)).toContain('cpu');
    const mb = await sales.validateConfigurationOk(
      baseServerConfig({ motherboard: s.incompatibleMotherboard }),
    );
    expect(mb.valid).toBe(false);
    expect(mb.errors.map((e) => e.field)).toContain('motherboard');
    const res = await sales.createQuote(
      quoteInput({ items: [serverItem(1, baseServerConfig({ cpu: s.incompatibleCpu }))] }),
    );
    expect(res.status()).toBe(422);
  });

  test('SQ-014 GPUs exceeding power/thermal capacity are blocked with an alternative @P0', async ({
    sales,
  }) => {
    const cfg = baseServerConfig({ gpu: { model: s.overPowerGpuModel, count: s.overPowerGpuCount } });
    const v = await sales.validateConfigurationOk(cfg);
    expect(v.valid).toBe(false);
    expect(v.errors.map((e) => e.message).join(' ')).toMatch(/W|power|thermal/i);
    expect(v.alternatives.length).toBeGreaterThan(0);
    expect((await sales.createQuote(quoteInput({ items: [serverItem(1, cfg)] }))).status()).toBe(422);
  });

  test('SQ-015 RAM and storage beyond limits cannot be quoted @P1', async ({ sales }) => {
    for (const cfg of [
      baseServerConfig({ ramGb: s.maxRamGb * 2 }),
      baseServerConfig({ storageTb: s.maxStorageTb + 1 }),
    ]) {
      const v = await sales.validateConfigurationOk(cfg);
      expect(v.valid).toBe(false);
      expect((await sales.createQuote(quoteInput({ items: [serverItem(1, cfg)] }))).status()).toBe(422);
    }
    const atLimit = await sales.validateConfigurationOk(
      baseServerConfig({ ramGb: s.maxRamGb, storageTb: s.maxStorageTb }),
    );
    expect(atLimit.valid, 'boundary values are allowed').toBe(true);
  });

  test('SQ-016 Unsupported NIC is rejected @P1', async ({ sales }) => {
    const v = await sales.validateConfigurationOk(baseServerConfig({ nic: s.unsupportedNic }));
    expect(v.valid).toBe(false);
    expect(v.errors.map((e) => e.field)).toContain('nic');
    expect((await sales.validateConfigurationOk(baseServerConfig({ nic: s.supportedNic }))).valid).toBe(true);
  });

  test('SQ-017 Configured-to-order server: every selected option is on the quote @P0 @smoke', async ({
    sales,
  }) => {
    const cfg = baseServerConfig();
    const q = await sales.createQuoteOk(quoteInput({ items: [serverItem(2, cfg)] }));
    expect(q.items[0].configuration).toMatchObject(cfg);
    expect(q.items[0].quantity).toBe(2);
    expect(q.items[0].unitPrice).toBeGreaterThan(s.basePrice);
  });

  test('SQ-018 Discontinued product shows availability warning and alternatives @P1', async ({ sales }) => {
    const p = await (await sales.getProduct(data.unavailableSku)).json();
    expect(p.availability).not.toBe('available');
    expect(p.alternatives?.length).toBeGreaterThan(0);
    const res = await sales.createQuote(quoteInput({ items: [{ sku: data.unavailableSku, quantity: 1 }] }));
    expect(res.status()).toBe(422);
    const body = await res.json();
    expect(JSON.stringify(body)).toMatch(/discontinued|unavailable/i);
    expect(body.alternatives).toEqual(expect.arrayContaining(p.alternatives));
  });

  test('SQ-019 Installation, warranty and support are separate, priced line items @P1', async ({ sales }) => {
    const svc = data.serviceSkus;
    const q = await sales.createQuoteOk(
      quoteInput({
        items: [
          serverItem(1),
          ...[svc.installation, svc.warranty, svc.support].map((sku) => ({ sku, quantity: 1 })),
        ],
      }),
    );
    expect(q.items).toHaveLength(4);
    for (const sku of [svc.installation, svc.warranty, svc.support]) {
      const line = q.items.find((l) => l.sku === sku)!;
      const product = await (await sales.getProduct(sku)).json();
      expect(line.type).toBe('service');
      expect(line.unitPrice).toBe(product.basePrice);
      expect(line.lineTotal).toBe(product.basePrice);
    }
  });

  test('SQ-020 Changing GPU/RAM before sending recalculates totals and the document @P0', async ({
    sales,
  }) => {
    const q = await sales.createQuoteOk(
      quoteInput({ items: [serverItem(1, baseServerConfig({ gpu: { model: s.gpuModel, count: 4 } }))] }),
    );
    const upgraded = baseServerConfig({ gpu: { model: s.gpuModel, count: 8 }, ramGb: 2048 });
    const u = await sales.updateQuoteOk(q.id, {
      items: [{ sku: s.sku, quantity: 1, configuration: upgraded }],
    });
    expect(u.items[0].configuration).toMatchObject(upgraded);
    expect(u.subtotal).toBeGreaterThan(q.subtotal);
    expect(u.grandTotal).toBeGreaterThan(q.grandTotal);
    const text = await pdfText(await (await sales.pdf(q.id)).body());
    expect(text).toContain(u.grandTotal.toFixed(2));
    expect(text).toMatch(/2048/);
  });
});
