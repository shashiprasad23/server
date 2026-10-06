import { DEMO_CATALOG } from './catalog-seed';
import { CatalogItem, configure } from './configurator';

const catalog: CatalogItem[] = DEMO_CATALOG.map((p, i) => ({
  id: String(i),
  sku: p.sku,
  name: p.name,
  category: p.category,
  oem: p.oem ?? null,
  gpu_model: p.gpu_model ?? null,
  gpus_per_unit: p.gpus_per_unit ?? 0,
  power_kw: p.power_kw ?? 0,
  rack_units: p.rack_units ?? 0,
  cooling: p.cooling ?? 'air',
  list_price: p.list_price,
  cost: p.cost,
  stock: p.stock,
  lead_time_weeks: p.lead_time_weeks,
  export_class: p.export_class,
  attrs: p.attrs ?? {},
}));
const qty = (c: ReturnType<typeof configure>, sku: string) => c.lines.find((l) => l.product.sku === sku)?.qty;

describe('configurator (FR-CPQ-02)', () => {
  it('builds a valid 64 x H200 training cluster with fabric, storage, racks, software and services', () => {
    const c = configure({ gpu_model: 'H200', gpu_count: 64, workload: 'training', kw_per_rack: 40, oem: 'Supermicro' }, catalog);
    expect(c.valid).toBe(true);
    expect(qty(c, 'SMC-HGX-H200-8G')).toBe(8);
    expect(qty(c, 'NV-QM9700')).toBe(3); // 2 leaf + 1 spine for 64 GPU ports
    expect(qty(c, 'STO-PFS-1PB')).toBe(1);
    expect(qty(c, 'SW-NVAIE-1Y')).toBe(64);
    expect(qty(c, 'SVC-CLUSTER-VAL')).toBe(1);
    expect(c.summary.racks).toBe(4); // 3 servers per 40 kW rack -> 3 racks, + 1 for network and storage
    expect(c.summary.fabric).toBe('infiniband');
  });

  it('rounds up to whole servers and says so', () => {
    const c = configure({ gpu_model: 'H200', gpu_count: 20, kw_per_rack: 40 }, catalog);
    expect(qty(c, 'SMC-HGX-H200-8G')).toBe(3);
    expect(c.warnings.join(' ')).toMatch(/Rounded up to 24 GPUs/);
  });

  it('refuses rack-scale systems where the site lacks the power, and offers hosting', () => {
    const c = configure({ gpu_model: 'GB200 NVL72', gpu_count: 72, kw_per_rack: 40, cooling: 'liquid' }, catalog);
    expect(c.valid).toBe(false);
    expect(c.errors.join(' ')).toMatch(/132 kW per rack.*Uvation hosting/);
  });

  it('picks an air-cooled system when the site has no liquid cooling', () => {
    const c = configure({ gpu_model: 'B200', gpu_count: 16, cooling: 'air', kw_per_rack: 30, oem: 'Dell' }, catalog);
    expect(c.valid).toBe(true);
    expect(c.lines[0].product.sku).toBe('SMC-HGX-B200-8G');
    expect(c.warnings.join(' ')).toMatch(/No Dell system/);
  });

  it('flags a single server that exceeds rack power', () => {
    const c = configure({ gpu_model: 'B200', gpu_count: 8, kw_per_rack: 10, cooling: 'air' }, catalog);
    expect(c.valid).toBe(false);
    expect(c.errors.join(' ')).toMatch(/draws 14.3 kW/);
  });

  it('reports what is missing from the requirement sheet', () => {
    const c = configure({ gpu_model: null, gpu_count: null }, catalog);
    expect(c.errors).toEqual(['GPU model is missing from the requirement sheet', 'GPU count or node count is missing from the requirement sheet']);
  });
});
