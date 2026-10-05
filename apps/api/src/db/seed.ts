import { Client } from 'pg';
import { loadConfig } from '../config/config';
import { DEMO_CATALOG, DEMO_RESTRICTED_PARTIES } from '../cpq/catalog-seed';

export const SEED = {
  tenantId: '00000000-0000-0000-0000-000000000001',
  users: {
    admin: { id: '00000000-0000-0000-0001-000000000001', email: 'admin@uvation.com', name: 'Sales Ops Admin', roles: ['admin'] },
    leader: { id: '00000000-0000-0000-0001-000000000002', email: 'vp.sales@uvation.com', name: 'VP Sales', roles: ['sales_leader'] },
    rep1: { id: '00000000-0000-0000-0001-000000000003', email: 'asha.rep@uvation.com', name: 'Asha (AE)', roles: ['rep'] },
    rep2: { id: '00000000-0000-0000-0001-000000000004', email: 'marco.rep@uvation.com', name: 'Marco (AE)', roles: ['rep'] },
    presales: { id: '00000000-0000-0000-0001-000000000005', email: 'presales@uvation.com', name: 'Presales Architect', roles: ['presales'] },
    dealDesk: { id: '00000000-0000-0000-0001-000000000006', email: 'dealdesk@uvation.com', name: 'Deal Desk', roles: ['deal_desk'] },
    finance: { id: '00000000-0000-0000-0001-000000000007', email: 'finance.ops@uvation.com', name: 'Finance Ops', roles: ['finance'] },
    compliance: { id: '00000000-0000-0000-0001-000000000008', email: 'trade.compliance@uvation.com', name: 'Trade Compliance', roles: ['trade_compliance'] },
  },
} as const;

/** AI-server stage model (FR-PIPE-01) with its entry gates. */
export const STAGES: { key: string; label: string; closed?: boolean; won?: boolean; rules?: string[] }[] = [
  { key: 'lead', label: 'Lead' },
  { key: 'qualified', label: 'Qualified' },
  { key: 'discovery', label: 'Discovery and requirements' },
  { key: 'solution_design', label: 'Solution design and BOM', rules: ['has_account', 'has_requirements'] },
  { key: 'supply_dealreg', label: 'Supply and deal registration', rules: ['has_requirements'] },
  { key: 'proposal', label: 'Proposal / quote', rules: ['has_requirements', 'has_value'] },
  { key: 'negotiation', label: 'Negotiation', rules: ['has_value'] },
  { key: 'compliance_check', label: 'Compliance clearance' },
  { key: 'po_received', label: 'Customer PO received', rules: ['has_account'] },
  { key: 'closed_won', label: 'Closed won', closed: true, won: true, rules: ['compliance_cleared', 'order_confirmed'] },
  { key: 'closed_lost', label: 'Closed lost', closed: true, rules: ['lost_reason_required'] },
];

export async function seed(connectionString: string): Promise<void> {
  const c = new Client({ connectionString });
  await c.connect();
  try {
    await c.query('BEGIN');
    await c.query('INSERT INTO tenants (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING', [SEED.tenantId, 'Uvation']);
    for (const u of Object.values(SEED.users)) {
      await c.query(
        `INSERT INTO users (id, tenant_id, email, name, roles) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name, roles = EXCLUDED.roles`,
        [u.id, SEED.tenantId, u.email, u.name, u.roles],
      );
    }
    for (const [i, s] of STAGES.entries()) {
      await c.query(
        `INSERT INTO pipeline_stages (tenant_id, key, label, position, is_closed, is_won, entry_rules) VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (tenant_id, key) DO UPDATE SET label = EXCLUDED.label, position = EXCLUDED.position,
           is_closed = EXCLUDED.is_closed, is_won = EXCLUDED.is_won, entry_rules = EXCLUDED.entry_rules`,
        [SEED.tenantId, s.key, s.label, (i + 1) * 10, !!s.closed, !!s.won, s.rules ?? []],
      );
    }
    await c.query(
      `INSERT INTO settings (tenant_id, key, value) VALUES ($1, 'routing.rules', $2) ON CONFLICT (tenant_id, key) DO NOTHING`,
      [SEED.tenantId, JSON.stringify({ rep_pool: [SEED.users.rep1.id, SEED.users.rep2.id] })],
    );
    await c.query(
      `INSERT INTO field_definitions (tenant_id, object, key, label, type, options) VALUES ($1,'accounts','nvidia_partner_tier','NVIDIA partner tier','enum',$2)
       ON CONFLICT (tenant_id, object, key) DO NOTHING`,
      [SEED.tenantId, JSON.stringify(['none', 'registered', 'preferred', 'elite'])],
    );
    for (const p of DEMO_CATALOG) {
      await c.query(
        `INSERT INTO products (tenant_id, sku, name, category, oem, gpu_model, gpus_per_unit, power_kw, rack_units, cooling, unit,
                               list_price, cost, stock, lead_time_weeks, export_class, price_valid_until, source, attrs)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, current_date + 30, 'demo_price_list', $17)
         ON CONFLICT (tenant_id, sku) DO NOTHING`,
        [
          SEED.tenantId, p.sku, p.name, p.category, p.oem ?? null, p.gpu_model ?? null, p.gpus_per_unit ?? 0, p.power_kw ?? 0,
          p.rack_units ?? 0, p.cooling ?? 'air', p.unit ?? 'each', p.list_price, p.cost, p.stock, p.lead_time_weeks, p.export_class,
          JSON.stringify(p.attrs ?? {}),
        ],
      );
    }
    const rp = await c.query('SELECT count(*)::int AS n FROM restricted_parties WHERE tenant_id = $1', [SEED.tenantId]);
    if (rp.rows[0].n === 0) {
      for (const r of DEMO_RESTRICTED_PARTIES) {
        await c.query('INSERT INTO restricted_parties (tenant_id, name, country, list_name, aliases) VALUES ($1,$2,$3,$4,$5)', [
          SEED.tenantId, r.name, r.country, r.list_name, r.aliases,
        ]);
      }
    }
    await c.query('COMMIT');
  } catch (err) {
    await c.query('ROLLBACK');
    throw err;
  } finally {
    await c.end();
  }
}

if (require.main === module) {
  const config = loadConfig();
  seed(config.MIGRATION_DATABASE_URL)
    .then(() => console.log('seed complete'))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
