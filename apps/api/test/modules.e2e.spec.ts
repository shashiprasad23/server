import { TestContext, U, setup, teardown } from './helpers';

const day = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

describe('ATLAS-I modules end to end', () => {
  let ctx: TestContext;
  let rep: string, leader: string, dealDesk: string, compliance: string, procurement: string;
  const auth = (t: string) => ({ authorization: `Bearer ${t}` });
  let accountId: string;

  const newDeal = async (fields: Record<string, unknown>) =>
    (
      await ctx.http
        .post('/v1/records/opportunities')
        .set(auth(rep))
        .send({ account_id: accountId, ...fields })
        .expect(201)
    ).body.id as string;

  beforeAll(async () => {
    ctx = await setup();
    rep = await ctx.token(U.rep1.email);
    leader = await ctx.token(U.leader.email);
    dealDesk = await ctx.token(U.dealDesk.email);
    compliance = await ctx.token(U.compliance.email);
    await ctx.owner.query("INSERT INTO users (tenant_id, email, name, roles) VALUES ($1, 'supply@uvation.com', 'Supply', '{procurement}')", [
      '00000000-0000-0000-0000-000000000001',
    ]);
    procurement = await ctx.token('supply@uvation.com');
    accountId = (await ctx.http.post('/v1/records/accounts').set(auth(rep)).send({ name: 'Nimbus AI', domain: 'nimbus-ai.com' }).expect(201)).body.id;
    await ctx.http.post('/v1/records/contacts').set(auth(rep)).send({ account_id: accountId, name: 'Priya Shah', email: 'priya@nimbus-ai.com' }).expect(201);
  });
  afterAll(() => teardown(ctx));

  describe('configure, price and quote', () => {
    let oppId: string;
    let quoteId: string;

    beforeAll(async () => {
      oppId = await newDeal({ name: 'Nimbus H200 cluster', gpu_model: 'H200', gpu_count: 64, workload: 'training', kw_per_rack: 40, cooling: 'liquid', oem: 'Supermicro' });
    });

    it('configures a BOM with supply status per line', async () => {
      const r = await ctx.http.post(`/v1/opportunities/${oppId}/configure`).set(auth(rep)).send({}).expect(201);
      expect(r.body.valid).toBe(true);
      expect(r.body.lines[0]).toMatchObject({ sku: 'SMC-HGX-H200-8G', qty: 8, supply: { status: 'in_stock' } });
      expect(r.body.summary).toMatchObject({ gpus: 64, fabric: 'infiniband' });
    });

    it('creates a versioned quote with margin hidden from reps', async () => {
      const r = await ctx.http.post(`/v1/opportunities/${oppId}/quotes`).set(auth(rep)).send({ discount_pct: 12 }).expect(201);
      quoteId = r.body.id;
      expect(r.body).toMatchObject({ version: 1, status: 'draft' });
      expect(r.body).not.toHaveProperty('margin');
      expect(r.body.lines[0]).not.toHaveProperty('unit_cost');
      const desk = await ctx.http.get(`/v1/quotes/${quoteId}`).set(auth(dealDesk)).expect(200);
      expect(desk.body.margin).toBeGreaterThan(0);
      expect(desk.body.total).toBeCloseTo(desk.body.subtotal + desk.body.freight, 2);
    });

    it('applies the approval matrix: 12% discount on a $1M+ deal needs a sales leader', async () => {
      const s = await ctx.http.post(`/v1/quotes/${quoteId}/submit`).set(auth(rep)).expect(201);
      expect(s.body).toMatchObject({ status: 'pending_approval', approval_role: 'sales_leader' });
      expect(s.body.approval_reasons.join(' ')).toMatch(/Discount 12% above 5%.*Deal value at or above 1,000,000/);
      await ctx.http.post(`/v1/quotes/${quoteId}/approve`).set(auth(rep)).send({}).expect(403);
      await ctx.http.post(`/v1/quotes/${quoteId}/approve`).set(auth(dealDesk)).send({}).expect(403);
      await ctx.http.post(`/v1/quotes/${quoteId}/publish`).set(auth(rep)).send({ channel: 'marketplace' }).expect(409);
      await ctx.http.post(`/v1/quotes/${quoteId}/approve`).set(auth(leader)).send({ note: 'Matches deal reg pricing' }).expect(201);
    });

    it('lets a small in-policy quote approve itself', async () => {
      const small = await newDeal({ name: 'Small L40S', gpu_model: 'L40S', gpu_count: 8, kw_per_rack: 20 });
      const q = (await ctx.http.post(`/v1/opportunities/${small}/quotes`).set(auth(rep)).send({ discount_pct: 3 }).expect(201)).body;
      const s = (await ctx.http.post(`/v1/quotes/${q.id}/submit`).set(auth(rep)).expect(201)).body;
      expect(s).toMatchObject({ status: 'approved', approved_by: 'policy' });
    });

    it('publishes to the Marketplace, accepts, and updates the deal', async () => {
      const pub = await ctx.http.post(`/v1/quotes/${quoteId}/publish`).set(auth(rep)).send({ channel: 'marketplace' }).expect(201);
      expect(pub.body).toMatchObject({ status: 'sent', published_to: 'marketplace' });
      const acc = await ctx.http.post(`/v1/quotes/${quoteId}/accept`).set(auth(rep)).expect(201);
      expect(acc.body.status).toBe('accepted');
      const opp = await ctx.http.get(`/v1/records/opportunities/${oppId}`).set(auth(rep)).expect(200);
      expect(opp.body.expected_value).toBeCloseTo(acc.body.total, 0);
      expect(opp.body.stage_key).toBe('negotiation');
    });

    it('renders a proposal without cost or margin', async () => {
      const r = await ctx.http.get(`/v1/quotes/${quoteId}/proposal`).set(auth(rep)).expect(200);
      expect(r.headers['content-type']).toMatch(/text\/html/);
      expect(r.text).toContain('SMC-HGX-H200-8G');
      expect(r.text).toContain('Delivery plan');
      expect(r.text).not.toMatch(/unit_cost|cost_total|margin_pct|Est. margin|Rebate/);
    });

    it('flags re-validation when cost moves after quoting', async () => {
      const q2 = (await ctx.http.post(`/v1/opportunities/${oppId}/quotes`).set(auth(rep)).send({}).expect(201)).body;
      expect(q2.version).toBe(2);
      await ctx.http.post('/v1/catalog/import').set(auth(procurement)).send([{ sku: 'SMC-HGX-H200-8G', cost: 300000 }]).expect(201);
      const r = await ctx.http.post(`/v1/quotes/${q2.id}/revalidate`).set(auth(rep)).expect(201);
      expect(r.body.changes.map((c: { kind: string }) => c.kind)).toContain('cost');
    });
  });

  describe('supply holds and deal registration', () => {
    it('holds stock without double allocation (FR-CPQ-04)', async () => {
      const a = await newDeal({ name: 'Deal A', gpu_model: 'B200', gpu_count: 16 });
      const b = await newDeal({ name: 'Deal B', gpu_model: 'B200', gpu_count: 16 });
      await ctx.http.post(`/v1/opportunities/${a}/holds`).set(auth(rep)).send({ sku: 'SMC-HGX-B200-8G', qty: 2 }).expect(201);
      const r = await ctx.http.post(`/v1/opportunities/${b}/holds`).set(auth(rep)).send({ sku: 'SMC-HGX-B200-8G', qty: 1 }).expect(409);
      expect(r.body.error.message).toMatch(/2 held for other deals/);
      const cfg = await ctx.http.post(`/v1/opportunities/${b}/configure`).set(auth(rep)).send({ cooling: 'air', kw_per_rack: 30 }).expect(201);
      expect(cfg.body.lines[0].supply).toMatchObject({ status: 'lead_time', held_by_others: 2 });
    });

    it('drafts, submits and approves an OEM deal registration', async () => {
      const opp = await newDeal({ name: 'Deal C', gpu_model: 'H200', gpu_count: 8, oem: 'Dell' });
      const d = await ctx.http.post(`/v1/opportunities/${opp}/deal-registrations`).set(auth(rep)).send({ oem: 'Dell' }).expect(201);
      await ctx.http.post(`/v1/opportunities/${opp}/deal-registrations`).set(auth(rep)).send({ oem: 'Dell' }).expect(409);
      const s = await ctx.http.post(`/v1/deal-registrations/${d.body.id}/submit`).set(auth(rep)).send({}).expect(201);
      expect(s.body.portal_reference).toMatch(/^DR-DEL-/);
      const ap = await ctx.http.post(`/v1/deal-registrations/${d.body.id}/approve`).set(auth(dealDesk)).send({ protected_discount_pct: 8, expires_at: day(90) }).expect(201);
      expect(ap.body.status).toBe('approved');
    });
  });

  describe('configure-and-quote agent', () => {
    it('drafts a quote and deal registration when a deal reaches solution design, and both roll back', async () => {
      const opp = await newDeal({ name: 'Agent deal', gpu_model: 'L40S', gpu_count: 16, oem: 'Dell', workload: 'inference', kw_per_rack: 20 });
      await ctx.http.patch(`/v1/records/opportunities/${opp}`).set(auth(rep)).send({ stage_key: 'solution_design' }).expect(200);
      await ctx.drain();
      const quotes = (await ctx.http.get(`/v1/quotes?opportunityId=${opp}`).set(auth(rep)).expect(200)).body;
      expect(quotes[0]).toMatchObject({ status: 'draft', created_by: 'agent:quote_agent' });
      const regs = (await ctx.http.get(`/v1/deal-registrations?opportunityId=${opp}`).set(auth(rep)).expect(200)).body;
      expect(regs[0]).toMatchObject({ oem: 'Dell', status: 'draft' });
      const actions = (await ctx.http.get(`/v1/agents/actions?agentId=quote_agent&targetId=${opp}`).set(auth(rep)).expect(200)).body;
      const draft = actions.find((a: { action_type: string }) => a.action_type === 'draft_quote');
      const rb = await ctx.http.post(`/v1/agents/actions/${draft.id}/rollback`).set(auth(rep)).expect(201);
      expect(rb.body.reverted[0]).toMatch(/withdrawn/);
      expect((await ctx.http.get(`/v1/quotes/${quotes[0].id}`).set(auth(rep)).expect(200)).body.status).toBe('withdrawn');
    });

    it('asks presales for missing requirements instead of guessing', async () => {
      const opp = await newDeal({ name: 'Vague deal', gpu_model: 'H200', gpu_count: 8 });
      await ctx.owner.query("UPDATE opportunities SET gpu_count = NULL WHERE id = $1", [opp]);
      await ctx.owner.query("UPDATE opportunities SET stage_key = 'discovery' WHERE id = $1", [opp]);
      await ctx.owner.query("UPDATE opportunities SET gpu_count = 8 WHERE id = $1", [opp]);
      await ctx.owner.query("UPDATE opportunities SET gpu_model = 'Z999' WHERE id = $1", [opp]);
      await ctx.http.patch(`/v1/records/opportunities/${opp}`).set(auth(rep)).send({ stage_key: 'solution_design' }).expect(200);
      await ctx.drain();
      const tasks = (await ctx.http.get('/v1/timeline/tasks').set(auth(leader)).expect(200)).body;
      expect(tasks.map((t: { title: string }) => t.title).join(' ')).toMatch(/Complete requirements for Vague deal: No catalogue system found for GPU model "Z999"/);
    });
  });

  describe('trade compliance', () => {
    it('flags a restricted-party match and licence destination, and gates clearance', async () => {
      const opp = await newDeal({ name: 'HK deal', gpu_model: 'H100', gpu_count: 64, end_user: 'Red Harbour Compute Limited', destination_country: 'Hong Kong' });
      const s = await ctx.http.post(`/v1/compliance/opportunities/${opp}/screen`).set(auth(compliance)).expect(201);
      expect(s.body.result).toBe('potential_match');
      expect(s.body.matches[0].listed).toBe('Red Harbor Compute Ltd');
      await ctx.http.post(`/v1/compliance/opportunities/${opp}/decision`).set(auth(rep)).send({ decision: 'cleared' }).expect(403);
      const no = await ctx.http.post(`/v1/compliance/opportunities/${opp}/decision`).set(auth(compliance)).send({ decision: 'cleared' }).expect(422);
      expect(no.body.error.code).toBe('eus_required');
      const blocked = await ctx.http.post(`/v1/compliance/opportunities/${opp}/decision`).set(auth(compliance)).send({ decision: 'blocked', notes: 'Listed party' }).expect(201);
      expect(blocked.body.compliance_status).toBe('blocked');
    });

    it('clears a clean deal once the end-user statement is in', async () => {
      const opp = await newDeal({ name: 'Clean deal', gpu_model: 'H200', gpu_count: 16, end_user: 'Nimbus AI', destination_country: 'India' });
      expect((await ctx.http.post(`/v1/compliance/opportunities/${opp}/screen`).set(auth(compliance)).expect(201)).body.result).toBe('clear');
      await ctx.http.post(`/v1/compliance/opportunities/${opp}/eus/request`).set(auth(rep)).send({}).expect(201);
      await ctx.http.post(`/v1/compliance/opportunities/${opp}/eus/receive`).set(auth(compliance)).send({ reference: 'EUS-2026-114' }).expect(201);
      const ok = await ctx.http.post(`/v1/compliance/opportunities/${opp}/decision`).set(auth(compliance)).send({ decision: 'cleared' }).expect(201);
      expect(ok.body.compliance_status).toBe('cleared');
    });

    it('raises red flags from customer emails', async () => {
      const opp = await newDeal({ name: 'Forwarder deal', gpu_model: 'H200', gpu_count: 8 });
      await ctx.http
        .post('/v1/records/activities')
        .set(auth(rep))
        .send({ account_id: accountId, opportunity_id: opp, type: 'email', source: 'outlook', direction: 'inbound', subject: 'Shipping', body: 'Our freight forwarder will handle the re-export.' })
        .expect(201);
      await ctx.drain();
      const o = await ctx.http.get(`/v1/records/opportunities/${opp}`).set(auth(rep)).expect(200);
      expect(o.body.compliance_status).toBe('flagged');
      const q = (await ctx.http.get('/v1/compliance/queue').set(auth(compliance)).expect(200)).body;
      expect(q.find((x: { id: string }) => x.id === opp).red_flags).toBe(1);
    });
  });

  describe('insights, forecast, renewals', () => {
    it('loads demo data and fills the dashboard', async () => {
      const r = await ctx.http.post('/v1/dev/demo-data').set(auth(leader)).expect(201);
      expect(r.body.loaded).toBe(true);
      await ctx.drain();
      const d = await ctx.http.get('/v1/insights/dashboard').set(auth(leader)).expect(200);
      expect(d.body.kpis.open_deals).toBeGreaterThan(5);
      expect(d.body.kpis.open_pipeline).toBeGreaterThan(1_000_000);
      expect(d.body.byStage.find((s: { key: string }) => s.key === 'closed_won').count).toBeGreaterThanOrEqual(1);
    });

    it('scores deal risk with reasons and writes them through the deal coach agent', async () => {
      await ctx.http.post('/v1/agents/deal_coach/run').set(auth(leader)).expect(201);
      const insp = (await ctx.http.get('/v1/insights/inspection').set(auth(leader)).expect(200)).body;
      const redHarbor = insp.find((x: { name: string }) => x.name === 'Red Harbor: 128 x H100');
      expect(redHarbor.risk).toBeGreaterThan(0);
      expect(redHarbor.commentary).toMatch(/Watch:/);
      const brief = (await ctx.http.get(`/v1/opportunities/${redHarbor.id}/brief`).set(auth(rep)).expect(200)).body;
      expect(brief.headline).toMatch(/risk/);
      expect(brief.nextActions.length).toBeGreaterThan(0);
    });

    it('forecasts by month with a confidence range and rep call', async () => {
      const f = (await ctx.http.get('/v1/insights/forecast').set(auth(leader)).expect(200)).body;
      expect(f.periods).toHaveLength(6);
      expect(f.periods[0].rep_call).toBe(2500000);
      expect(f.periods.every((p: { low: number; high: number; ai_forecast: number }) => p.low <= p.ai_forecast && p.ai_forecast <= p.high)).toBe(true);
      const sd = (await ctx.http.get('/v1/insights/supply-demand').set(auth(leader)).expect(200)).body;
      expect(sd.find((x: { gpu_model: string }) => x.gpu_model === 'GB200 NVL72').min_lead_time_weeks).toBe(20);
    });

    it('answers questions about the pipeline with citations', async () => {
      const r = (await ctx.http.post('/v1/ask').set(auth(leader)).send({ question: 'Which deals need liquid cooling?' }).expect(201)).body;
      expect(r.filter.cooling).toBe('liquid');
      expect(r.citations.map((c: { name: string }) => c.name)).toEqual(expect.arrayContaining(['Orbital Labs: 2 x GB200 NVL72']));
    });

    it('finds revenue leaks and writes a weekly summary', async () => {
      const l = (await ctx.http.get('/v1/insights/leaks').set(auth(leader)).expect(200)).body;
      expect(l.items.map((i: { kind: string }) => i.kind)).toEqual(expect.arrayContaining(['unfiled_deal_registration', 'renewal_not_started']));
      const s = (await ctx.http.get('/v1/insights/weekly-summary').set(auth(leader)).expect(200)).body;
      expect(s.summary).toMatch(/Pipeline: \d+ open deals/);
    });

    it('renewal agent opens renewals for expiring support and flags old GPUs for refresh', async () => {
      const r = (await ctx.http.post('/v1/agents/renewal_agent/run').set(auth(leader)).expect(201)).body;
      expect(r.renewals).toBe(2);
      expect(r.refresh).toBe(1); // the 2023 H100 servers; the 11-month-old licences are not due a refresh
      const assets = (await ctx.http.get('/v1/installed-base').set(auth(rep)).expect(200)).body;
      expect(assets.every((a: { renewal_opportunity_id: string | null }) => a.renewal_opportunity_id)).toBe(true);
      const again = (await ctx.http.post('/v1/agents/renewal_agent/run').set(auth(leader)).expect(201)).body;
      expect(again).toEqual({ renewals: 0, refresh: 0 });
    });

    it('records installed base when a deal is won', async () => {
      const opp = await newDeal({ name: 'Win me', gpu_model: 'H200', gpu_count: 16, expected_value: 700000 });
      const q = (await ctx.http.post(`/v1/opportunities/${opp}/quotes`).set(auth(rep)).send({}).expect(201)).body;
      await ctx.http.post(`/v1/quotes/${q.id}/submit`).set(auth(rep)).expect(201);
      await ctx.owner.query("UPDATE opportunities SET compliance_status = 'cleared', netsuite_sales_order_id = 'SO-9' WHERE id = $1", [opp]);
      await ctx.http.patch(`/v1/records/opportunities/${opp}`).set(auth(rep)).send({ stage_key: 'closed_won' }).expect(200);
      await ctx.drain();
      const assets = (await ctx.http.get('/v1/installed-base').set(auth(rep)).expect(200)).body.filter((a: { opportunity_id: string }) => a.opportunity_id === opp);
      expect(assets.find((a: { category: string }) => a.category === 'gpu_server')).toMatchObject({ qty: 2 });
    });
  });
});
