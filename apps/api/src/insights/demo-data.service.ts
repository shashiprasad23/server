import { Injectable } from '@nestjs/common';
import { Db, DbService, one } from '../db/db.service';
import { systemPrincipal } from '../common/principal';
import { RecordsService } from '../records/records.service';
import { CpqService } from '../cpq/cpq.service';
import { SEED } from '../db/seed';

const day = (offset: number) => new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10);
const at = (offset: number) => new Date(Date.now() + offset * 864e5).toISOString();

interface DemoDeal {
  account: { name: string; domain: string; segment: string; hq_country: string };
  contacts: { name: string; email: string; title: string; committee_role?: string }[];
  opp: Record<string, unknown>;
  emails?: { subject: string; body: string; daysAgo: number }[];
  quote?: { discount_pct?: number; payment_terms?: string; submit?: boolean; send?: boolean };
}

/**
 * Development and demo only: a realistic Uvation AI-server pipeline across every stage, so the
 * dashboard, forecast, quotes, compliance queue and renewals have something to show.
 */
@Injectable()
export class DemoDataService {
  constructor(
    private readonly dbs: DbService,
    private readonly records: RecordsService,
    private readonly cpq: CpqService,
  ) {}

  private deals(): DemoDeal[] {
    const reps = [SEED.users.rep1.id, SEED.users.rep2.id];
    return [
      {
        account: { name: 'Nimbus AI', domain: 'nimbus-ai.com', segment: 'ai_native', hq_country: 'India' },
        contacts: [
          { name: 'Priya Shah', email: 'priya@nimbus-ai.com', title: 'Head of ML Platform', committee_role: 'ml_lead' },
          { name: 'Ravi Kumar', email: 'ravi@nimbus-ai.com', title: 'CTO', committee_role: 'economic_buyer' },
        ],
        opp: { name: 'Nimbus AI: 64 x H200 training cluster', stage_key: 'proposal', owner_id: reps[0], gpu_model: 'H200', gpu_count: 64, node_count: 8, oem: 'Supermicro', workload: 'training', cooling: 'liquid', kw_per_rack: 40, deployment_location: 'customer_site', destination_country: 'India', end_user: 'Nimbus AI', expected_ship_date: day(45), channel: 'marketplace' },
        emails: [{ subject: 'Re: H200 cluster', body: 'We can do 40 kW per rack with liquid cooling. Please send the final quote this week.', daysAgo: 2 }],
        quote: { submit: true, send: true },
      },
      {
        account: { name: 'Orbital Labs', domain: 'orbital-labs.io', segment: 'gpu_cloud', hq_country: 'Germany' },
        contacts: [{ name: 'Lena Fischer', email: 'lena@orbital-labs.io', title: 'VP Infrastructure', committee_role: 'it_infrastructure' }],
        opp: { name: 'Orbital Labs: 2 x GB200 NVL72', stage_key: 'solution_design', owner_id: reps[1], gpu_model: 'GB200 NVL72', gpu_count: 144, workload: 'training', cooling: 'liquid', kw_per_rack: 140, deployment_location: 'colocation', destination_country: 'Germany', expected_ship_date: day(130), expected_value: 7200000, channel: 'rep' },
        emails: [{ subject: 'GB200 timing', body: 'Our colocation partner confirms 140 kW per rack with direct liquid cooling. What is the lead time for two NVL72 racks?', daysAgo: 5 }],
      },
      {
        account: { name: 'Helios Research', domain: 'helios.edu', segment: 'research', hq_country: 'United States' },
        contacts: [
          { name: 'Sam Lee', email: 'sam@helios.edu', title: 'Director of Research Computing', committee_role: 'economic_buyer' },
          { name: 'Ana Ortiz', email: 'ana@helios.edu', title: 'Procurement', committee_role: 'procurement' },
        ],
        opp: { name: 'Helios Research: B200 inference pods', stage_key: 'negotiation', owner_id: reps[0], gpu_model: 'B200', gpu_count: 32, workload: 'inference', cooling: 'air', kw_per_rack: 30, deployment_location: 'customer_site', destination_country: 'United States', end_user: 'Helios Research', expected_ship_date: day(28), channel: 'rep', oem: 'Supermicro' },
        emails: [{ subject: 'Pricing', body: 'Procurement needs 12% off list to get this approved before our fiscal year closes.', daysAgo: 1 }],
        quote: { discount_pct: 12, submit: true },
      },
      {
        account: { name: 'Kestrel Compute', domain: 'kestrel-compute.com', segment: 'gpu_cloud', hq_country: 'Singapore' },
        contacts: [{ name: 'Dev Patel', email: 'dev@kestrel-compute.com', title: 'Founder' }],
        opp: { name: 'Kestrel Compute: L40S inference fleet', stage_key: 'qualified', owner_id: reps[1], gpu_model: 'L40S', gpu_count: 64, workload: 'inference', destination_country: 'Singapore', expected_ship_date: day(60), channel: 'marketplace' },
      },
      {
        account: { name: 'Red Harbor Compute Ltd', domain: 'redharbor-compute.hk', segment: 'reseller', hq_country: 'Hong Kong' },
        contacts: [{ name: 'K. Wong', email: 'k.wong@redharbor-compute.hk', title: 'Purchasing' }],
        opp: { name: 'Red Harbor: 128 x H100', stage_key: 'discovery', owner_id: reps[1], gpu_model: 'H100', gpu_count: 128, destination_country: 'Hong Kong', expected_ship_date: day(40), channel: 'rep' },
        emails: [{ subject: 'Order', body: 'The end user is confidential. Our freight forwarder will handle onward shipping.', daysAgo: 3 }],
      },
      {
        account: { name: 'Vega Robotics', domain: 'vegarobotics.ai', segment: 'ai_native', hq_country: 'United Kingdom' },
        contacts: [{ name: 'Tom Hughes', email: 'tom@vegarobotics.ai', title: 'Head of AI', committee_role: 'ml_lead' }],
        opp: { name: 'Vega Robotics: MI325X fine-tuning', stage_key: 'supply_dealreg', owner_id: reps[0], gpu_model: 'MI325X', gpu_count: 32, oem: 'Supermicro', workload: 'fine_tuning', cooling: 'air', kw_per_rack: 35, destination_country: 'United Kingdom', expected_ship_date: day(75), expected_value: 1350000, channel: 'rep' },
      },
      {
        account: { name: 'Atlas Bio', domain: 'atlasbio.com', segment: 'enterprise', hq_country: 'United Kingdom' },
        contacts: [{ name: 'Grace Lin', email: 'grace@atlasbio.com', title: 'CIO', committee_role: 'economic_buyer' }],
        opp: { name: 'Atlas Bio: H200 pilot', stage_key: 'closed_lost', lost_reason: 'Lead time too long', owner_id: reps[1], gpu_model: 'H200', gpu_count: 16, expected_value: 640000, channel: 'rep' },
      },
    ];
  }

  async load(tenantId: string) {
    return this.dbs.tx(tenantId, async (db) => {
      const sys = systemPrincipal(tenantId);
      if (await one(db, "SELECT id FROM accounts WHERE domain = 'orbital-labs.io' AND deleted_at IS NULL")) return { loaded: false, reason: 'Demo data already present' };
      const created: string[] = [];
      for (const d of this.deals()) {
        const existing = await one<{ id: string }>(db, 'SELECT id FROM accounts WHERE lower(domain) = $1 AND deleted_at IS NULL', [d.account.domain]);
        const account = existing ?? (await this.records.create(db, sys, 'accounts', { ...d.account, channel_first_seen: d.opp.channel }));
        const contactIds: string[] = [];
        for (const c of d.contacts) {
          const known = await one<{ id: string }>(db, 'SELECT id FROM contacts WHERE lower(email) = $1 AND deleted_at IS NULL', [c.email]);
          contactIds.push(known?.id ?? (await this.records.create(db, sys, 'contacts', { ...c, account_id: account.id })).id);
          if (known && c.committee_role) await db.query('UPDATE contacts SET committee_role = coalesce(committee_role, $2), title = coalesce(title, $3) WHERE id = $1', [known.id, c.committee_role, c.title]);
        }
        const stage = String(d.opp.stage_key);
        const opp = await this.records.create(db, sys, 'opportunities', {
          ...d.opp,
          stage_key: 'lead',
          account_id: account.id,
          primary_contact_id: contactIds[0],
        });
        created.push(opp.id);
        for (const e of d.emails ?? []) {
          await this.records.create(db, sys, 'activities', {
            account_id: account.id,
            contact_id: contactIds[0],
            opportunity_id: opp.id,
            type: 'email',
            source: 'outlook',
            direction: 'inbound',
            subject: e.subject,
            body: e.body,
            occurred_at: at(-e.daysAgo),
            participants: [{ email: d.contacts[0].email, role: 'from' }],
          });
        }
        if (d.quote) {
          const q = await this.cpq.createQuote(db, sys, opp.id, { discount_pct: d.quote.discount_pct ?? 0, payment_terms: d.quote.payment_terms ?? 'Net 30' });
          if (d.quote.submit) {
            const sub = await this.cpq.submitQuote(db, sys, q.id);
            if (d.quote.send && sub.status === 'approved') await this.cpq.publishQuote(db, sys, q.id, 'marketplace');
          }
        }
        // Move to the target stage with whatever the gates need.
        const patch: Record<string, unknown> = { stage_key: stage };
        if (stage === 'negotiation') Object.assign(patch, { compliance_status: 'cleared', eus_status: 'received' });
        if (['proposal', 'negotiation'].includes(stage) && d.opp.expected_value == null) {
          const q = await one<{ total: string }>(db, 'SELECT total FROM quotes WHERE opportunity_id = $1 ORDER BY version DESC LIMIT 1', [opp.id]);
          patch.expected_value = q ? Number(q.total) : 500000;
        }
        await this.records.update(db, sys, 'opportunities', opp.id, patch);
      }

      // A won deal with installed base near renewal, and older systems due a refresh.
      const zephyr = await this.records.create(db, sys, 'accounts', { name: 'Zephyr AI', domain: 'zephyr-ai.com', segment: 'ai_native', hq_country: 'Singapore', channel_first_seen: 'marketplace' });
      const zc = await this.records.create(db, sys, 'contacts', { account_id: zephyr.id, name: 'Mia Chen', email: 'mia@zephyr-ai.com', title: 'Platform Lead', committee_role: 'economic_buyer' });
      const won = await this.records.create(db, sys, 'opportunities', {
        account_id: zephyr.id,
        primary_contact_id: zc.id,
        name: 'Zephyr AI: H100 cluster (2023)',
        gpu_model: 'H100',
        gpu_count: 64,
        expected_value: 2100000,
        channel: 'marketplace',
        compliance_status: 'cleared',
        netsuite_sales_order_id: 'SO-2023-0412',
        netsuite_status: 'settled',
        stage_key: 'closed_won',
      });
      await this.insertAsset(db, tenantId, zephyr.id, won.id, 'SMC-HGX-H100-8G', 'Supermicro HGX H100 8-GPU server', 'gpu_server', 'H100', 8, day(-900), day(85));
      await this.insertAsset(db, tenantId, zephyr.id, won.id, 'SW-NVAIE-1Y', 'NVIDIA AI Enterprise licences', 'software', 'H100', 64, day(-330), null, day(35));
      for (const [i, subject] of ['RMA: GPU 3 failing on node 5', 'Support ticket: NCCL timeouts', 'RMA: PSU replacement'].entries()) {
        await this.records.create(db, sys, 'activities', {
          account_id: zephyr.id,
          type: 'ticket',
          source: 'usp',
          direction: 'inbound',
          subject,
          body: 'Opened in the Uvation Service Portal.',
          occurred_at: at(-(i * 9 + 4)),
        });
      }
      await db.query(
        "INSERT INTO forecast_calls (tenant_id, user_id, period, amount, note) VALUES ($1,$2,$3,$4,'Rep call') ON CONFLICT DO NOTHING",
        [tenantId, SEED.users.rep1.id, new Date().toISOString().slice(0, 7), 2500000],
      );
      return { loaded: true, opportunities: created.length + 1 };
    });
  }

  private async insertAsset(db: Db, tenantId: string, accountId: string, oppId: string, sku: string, description: string, category: string, gpu: string, qty: number, delivered: string, supportEnd: string | null, licenceEnd?: string) {
    await db.query(
      `INSERT INTO installed_assets (tenant_id, account_id, opportunity_id, sku, description, category, gpu_model, qty, delivered_at, warranty_end, support_end, licence_end, site)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9::date + interval '1 year',$10,$11,'colocation')`,
      [tenantId, accountId, oppId, sku, description, category, gpu, qty, delivered, supportEnd, licenceEnd ?? null],
    );
  }
}
