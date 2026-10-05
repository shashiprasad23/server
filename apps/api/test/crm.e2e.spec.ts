import { TestContext, U, setup, teardown } from './helpers';

const now = () => new Date().toISOString();
let seq = 0;
const eid = (p: string) => `${p}-${Date.now()}-${++seq}`;

const rfq = (email: string, message: string) => ({
  event_id: eid('mp'),
  type: 'rfq',
  occurred_at: now(),
  customer: { email, name: 'Priya Shah', company: email.endsWith('nimbus-ai.com') ? 'Nimbus AI' : undefined, user_id: `mp-${email}` },
  data: { message },
});

const outlookMail = (from: string, to: string[], body: string, extra: Record<string, unknown> = {}) => ({
  kind: 'message',
  id: eid('graph'),
  conversationId: 'conv-1',
  mailbox: 'asha.rep@uvation.com',
  subject: 'Re: cluster sizing',
  body: { contentType: 'text', content: body },
  from: { emailAddress: { address: from, name: 'Customer' } },
  toRecipients: to.map((address) => ({ emailAddress: { address } })),
  sentDateTime: now(),
  ...extra,
});

describe('ATLAS-I end to end', () => {
  let ctx: TestContext;
  let rep: string, leader: string, finance: string, compliance: string, dealDesk: string, admin: string;
  const auth = (t: string) => ({ authorization: `Bearer ${t}` });

  beforeAll(async () => {
    ctx = await setup();
    rep = await ctx.token(U.rep1.email);
    leader = await ctx.token(U.leader.email);
    finance = await ctx.token(U.finance.email);
    compliance = await ctx.token(U.compliance.email);
    dealDesk = await ctx.token(U.dealDesk.email);
    admin = await ctx.token(U.admin.email);
  });
  afterAll(() => teardown(ctx));

  describe('channel ingestion and identity', () => {
    it('rejects unsigned or mis-signed webhooks', async () => {
      await ctx.send('marketplace', rfq('x@acme.com', 'quote'), 'sha256=bad').expect(401);
    });

    it('turns a Marketplace RFQ into account, contact, lead, opportunity and timeline entry', async () => {
      const r = await ctx.send('marketplace', rfq('priya@nimbus-ai.com', 'Please quote 64 H200 GPUs (8 nodes) for LLM training, liquid cooling, India, by Q1 2027.')).expect(202);
      expect(r.body).toMatchObject({ status: 'processed', duplicate: false });
      expect(r.body.linked).toMatchObject({ createdAccount: true, createdContact: true });
      const acct = await ctx.http.get(`/v1/records/accounts/${r.body.linked.accountId}`).set(auth(rep)).expect(200);
      expect(acct.body).toMatchObject({ domain: 'nimbus-ai.com', name: 'Nimbus AI', channel_first_seen: 'marketplace' });
      const contact = await ctx.http.get(`/v1/records/contacts/${r.body.linked.contactId}`).set(auth(rep)).expect(200);
      expect(contact.body.marketplace_user_id).toBe('mp-priya@nimbus-ai.com');
      const tl = await ctx.http.get(`/v1/timeline/accounts/${r.body.linked.accountId}`).set(auth(rep)).expect(200);
      expect(tl.body.items.map((i: { kind: string }) => i.kind)).toEqual(expect.arrayContaining(['activity', 'opportunity']));
    });

    it('is idempotent on the source event id', async () => {
      const body = rfq('dup@nimbus-ai.com', 'quote 8 B200');
      const first = await ctx.send('marketplace', body).expect(202);
      const second = await ctx.send('marketplace', body).expect(202);
      expect(second.body).toMatchObject({ id: first.body.id, duplicate: true });
    });

    it('logs customer email to the same account and skips internal or private mail', async () => {
      const ok = await ctx.send('outlook', outlookMail('cto@nimbus-ai.com', ['asha.rep@uvation.com'], 'We would like Dell instead.')).expect(202);
      expect(ok.body.status).toBe('processed');
      const internal = await ctx.send('outlook', outlookMail('marco.rep@uvation.com', ['asha.rep@uvation.com'], 'internal note')).expect(202);
      expect(internal.body).toMatchObject({ status: 'skipped', skipReason: expect.stringMatching(/internal_only/) });
      const priv = await ctx.send('outlook', outlookMail('cto@nimbus-ai.com', ['asha.rep@uvation.com'], 'personal', { sensitivity: 'private' })).expect(202);
      expect(priv.body.status).toBe('skipped');
      const nimbus = await ctx.http.get('/v1/records/accounts?domain=nimbus-ai.com').set(auth(rep)).expect(200);
      expect(nimbus.body.total).toBe(1);
      expect(ok.body.linked.accountId).toBe(nimbus.body.items[0].id);
    });

    it('redacts card numbers in captured communications and stores no order lines', async () => {
      const r = await ctx.send('outlook', outlookMail('ap@nimbus-ai.com', ['asha.rep@uvation.com'], 'Charge card 4111 1111 1111 1111 for the deposit')).expect(202);
      const act = await ctx.http.get(`/v1/records/activities/${r.body.linked.activityId}`).set(auth(rep)).expect(200);
      expect(act.body.body).toContain('[redacted: payment card]');
      expect(act.body.body).not.toContain('4111');
    });
  });

  describe('governed agents', () => {
    let leadId: string, opportunityId: string;

    beforeAll(async () => {
      const r = await ctx.send('marketplace', rfq('lena@orbital-labs.io', 'Need a quote for 128 B200 GPUs from Supermicro for training at our colocation site in Germany, within 3 months.')).expect(202);
      leadId = r.body.linked.leadId;
      opportunityId = r.body.linked.opportunityId;
      await ctx.drain();
    });

    it('SDR agent scores, explains and routes the lead autonomously', async () => {
      const lead = await ctx.http.get(`/v1/records/leads/${leadId}`).set(auth(rep)).expect(200);
      expect(lead.body.status).toBe('qualified');
      expect(lead.body.fit_score).toBeGreaterThanOrEqual(60);
      expect(lead.body.score_reasons.length).toBeGreaterThan(2);
      expect([U.rep1.id, U.rep2.id]).toContain(lead.body.routed_to);
      const opp = await ctx.http.get(`/v1/records/opportunities/${opportunityId}`).set(auth(rep)).expect(200);
      expect(opp.body).toMatchObject({ gpu_model: 'B200', gpu_count: 128, oem: 'Supermicro', destination_country: 'Germany' });
      const hist = await ctx.http.get(`/v1/records/opportunities/${opportunityId}/history`).set(auth(rep)).expect(200);
      const gpu = hist.body.find((h: { field: string }) => h.field === 'gpu_count');
      expect(gpu).toMatchObject({ source: 'agent', actor_id: 'inbound_sdr' });
      expect(gpu.evidence[0].quote).toContain('128 B200 GPUs');
    });

    it('holds the first outbound email for approval, then sends it from the queue', async () => {
      const queue = await ctx.http.get('/v1/approvals').set(auth(rep)).expect(200);
      const item = queue.body.find((a: { action_type: string; target_id: string }) => a.action_type === 'send_email' && a.target_id === leadId);
      expect(item).toBeDefined();
      expect(item.payload.body).toMatch(/end user/);
      expect(ctx.mailer.sent).toHaveLength(0);
      await ctx.http.post(`/v1/approvals/${item.id}/approve`).set(auth(rep)).send({ note: 'looks good' }).expect(201);
      await ctx.outbound.flushDue(new Date(Date.now() + 1000));
      expect(ctx.mailer.sent.map((m) => m.to)).toContain('lena@orbital-labs.io');
      await ctx.http.post(`/v1/approvals/${item.id}/approve`).set(auth(rep)).send({}).expect(409);
    });

    it('rolls back an agent action, leaving fields people changed since untouched', async () => {
      const actions = await ctx.http.get(`/v1/agents/actions?agentId=inbound_sdr&targetId=${opportunityId}`).set(auth(rep)).expect(200);
      const fill = actions.body.find((a: { action_type: string; decision: string }) => a.action_type === 'update_fields' && a.decision === 'executed');
      await ctx.http.patch(`/v1/records/opportunities/${opportunityId}`).set(auth(rep)).send({ oem: 'Dell' }).expect(200);
      const rb = await ctx.http.post(`/v1/agents/actions/${fill.id}/rollback`).set(auth(rep)).expect(201);
      expect(rb.body.reverted).toEqual(expect.arrayContaining(['opportunities.gpu_count']));
      expect(rb.body.skipped.join(' ')).toMatch(/opportunities.oem/);
      const opp = await ctx.http.get(`/v1/records/opportunities/${opportunityId}`).set(auth(rep)).expect(200);
      expect(opp.body).toMatchObject({ gpu_count: null, oem: 'Dell' });
    });

    it('capture agent never re-infers a field a person corrected', async () => {
      await ctx.http.patch(`/v1/records/opportunities/${opportunityId}`).set(auth(rep)).send({ gpu_count: 96 }).expect(200);
      await ctx.send('outlook', outlookMail('lena@orbital-labs.io', ['asha.rep@uvation.com'], 'Just to confirm, we still need 128 B200 GPUs and 16 nodes.')).expect(202);
      await ctx.drain();
      const opp = await ctx.http.get(`/v1/records/opportunities/${opportunityId}`).set(auth(rep)).expect(200);
      expect(opp.body.gpu_count).toBe(96);
      expect(opp.body.node_count).toBe(16);
    });

    it('kill switch blocks the agent and is visible in the audit trail', async () => {
      await ctx.http.post('/v1/agents/inbound_sdr/kill').set(auth(rep)).expect(403);
      await ctx.http.post('/v1/agents/inbound_sdr/kill').set(auth(leader)).expect(201);
      const r = await ctx.send('marketplace', rfq('ops@kestrel-compute.com', 'Quote 32 H100 GPUs please')).expect(202);
      await ctx.drain();
      const lead = await ctx.http.get(`/v1/records/leads/${r.body.linked.leadId}`).set(auth(rep)).expect(200);
      expect(lead.body.status).toBe('new');
      const blocked = await ctx.http.get('/v1/agents/actions?agentId=inbound_sdr&decision=blocked').set(auth(leader)).expect(200);
      expect(blocked.body[0].reason).toMatch(/kill_switch/);
      await ctx.http.post('/v1/agents/inbound_sdr/resume').set(auth(leader)).expect(201);
    });
  });

  describe('records, security and the NetSuite boundary', () => {
    let accountId: string;
    let oppId: string;

    beforeAll(async () => {
      const a = await ctx.http.post('/v1/records/accounts').set(auth(rep)).send({ name: 'Helios Research', domain: 'helios.edu', segment: 'research' }).expect(201);
      accountId = a.body.id;
      const o = await ctx.http
        .post('/v1/records/opportunities')
        .set(auth(rep))
        .send({ name: 'Helios GB200 cluster', account_id: accountId, gpu_model: 'GB200 NVL72', gpu_count: 72, expected_value: 3500000, destination_country: 'United States' })
        .expect(201);
      oppId = o.body.id;
      expect(o.body.stage_key).toBe('lead');
    });

    it('rejects sales transaction data anywhere on CRM records (FR-NS-02)', async () => {
      const r = await ctx.http.patch(`/v1/records/opportunities/${oppId}`).set(auth(rep)).send({ custom: { invoice_amount: 10 } }).expect(400);
      expect(r.body.error.code).toBe('transaction_data_rejected');
      await ctx.http.post('/v1/metadata/fields').set(auth(admin)).send({ object: 'opportunities', key: 'invoice_number', label: 'x', type: 'text' }).expect(400);
    });

    it('supports custom fields defined at runtime', async () => {
      await ctx.http.post('/v1/metadata/fields').set(auth(admin)).send({ object: 'opportunities', key: 'cluster_fabric', label: 'Cluster fabric', type: 'enum', options: ['infiniband', 'spectrum_x', 'roce'] }).expect(201);
      const r = await ctx.http.patch(`/v1/records/opportunities/${oppId}`).set(auth(rep)).send({ custom: { cluster_fabric: 'infiniband' } }).expect(200);
      expect(r.body.custom.cluster_fabric).toBe('infiniband');
      await ctx.http.patch(`/v1/records/opportunities/${oppId}`).set(auth(rep)).send({ custom: { cluster_fabric: 'token_ring' } }).expect(400);
    });

    it('hides margin from reps but not from deal desk (field-level security)', async () => {
      await ctx.http.patch(`/v1/records/opportunities/${oppId}`).set(auth(rep)).send({ est_margin: 1 }).expect(403);
      await ctx.http.patch(`/v1/records/opportunities/${oppId}`).set(auth(dealDesk)).send({ est_margin: 420000 }).expect(200);
      const asRep = await ctx.http.get(`/v1/records/opportunities/${oppId}`).set(auth(rep)).expect(200);
      expect(asRep.body).not.toHaveProperty('est_margin');
      const asDesk = await ctx.http.get(`/v1/records/opportunities/${oppId}`).set(auth(dealDesk)).expect(200);
      expect(asDesk.body.est_margin).toBe(420000);
    });

    it('enforces optimistic concurrency with If-Match', async () => {
      const cur = await ctx.http.get(`/v1/records/opportunities/${oppId}`).set(auth(rep)).expect(200);
      await ctx.http.patch(`/v1/records/opportunities/${oppId}`).set(auth(rep)).set('if-match', String(cur.body.version - 1)).send({ probability: 30 }).expect(409);
    });

    it('closes only through compliance clearance and a NetSuite sales order ID', async () => {
      const gate = await ctx.http.patch(`/v1/records/opportunities/${oppId}`).set(auth(rep)).send({ stage_key: 'closed_won' }).expect(422);
      expect(gate.body.error.details.map((d: { rule: string }) => d.rule)).toEqual(['compliance_cleared', 'order_confirmed']);
      await ctx.http.patch(`/v1/records/opportunities/${oppId}`).set(auth(rep)).send({ compliance_status: 'cleared' }).expect(403);
      await ctx.http.post(`/v1/opportunities/${oppId}/close-request`).set(auth(rep)).send({ customer_po_reference: 'PO-77', quote_id: 'Q-1' }).expect(422);
      await ctx.http.patch(`/v1/records/opportunities/${oppId}`).set(auth(compliance)).send({ compliance_status: 'cleared' }).expect(200);
      const req = await ctx.http.post(`/v1/opportunities/${oppId}/close-request`).set(auth(rep)).send({ customer_po_reference: 'PO-77', quote_id: 'Q-1' }).expect(201);
      expect(req.body.mode).toBe('manual');
      await ctx.http.patch(`/v1/records/opportunities/${oppId}`).set(auth(rep)).send({ netsuite_sales_order_id: 'SO-1' }).expect(403);
      await ctx.http.post(`/v1/opportunities/${oppId}/close-confirm`).set(auth(rep)).send({ netsuite_sales_order_id: 'SO-1' }).expect(403);
      const done = await ctx.http.post(`/v1/opportunities/${oppId}/close-confirm`).set(auth(finance)).send({ netsuite_sales_order_id: 'SO-10042' }).expect(201);
      expect(done.body).toMatchObject({ stage_key: 'closed_won', netsuite_sales_order_id: 'SO-10042', netsuite_status: 'open' });
      expect(done.body.closed_at).toBeTruthy();
    });

    it('routes Marketplace orders to compliance and keeps only the order reference', async () => {
      const r = await ctx
        .send('marketplace', {
          event_id: eid('mp'),
          type: 'order_placed',
          occurred_at: now(),
          customer: { email: 'buyer@zephyr-ai.com', company: 'Zephyr AI' },
          data: { order_reference: 'MP-ORD-9', gpu_model: 'L40S', gpu_count: 8, ship_to_country: 'Singapore', payment: { method: 'card', card_number: '4111111111111111' }, invoice_total: 99000 },
        })
        .expect(202);
      const opp = await ctx.http.get(`/v1/records/opportunities/${r.body.linked.opportunityId}`).set(auth(rep)).expect(200);
      expect(opp.body).toMatchObject({ stage_key: 'compliance_check', order_reference: 'MP-ORD-9', compliance_status: 'not_screened' });
      const stored = await ctx.owner.query('SELECT payload FROM channel_events WHERE id = $1', [r.body.id]);
      expect(JSON.stringify(stored.rows[0].payload)).not.toMatch(/4111|invoice_total|payment/);
      const tasks = await ctx.http.get('/v1/timeline/tasks').set(auth(compliance)).expect(200);
      expect(tasks.body.map((t: { title: string }) => t.title)).toContain('Screen Marketplace order MP-ORD-9 before fulfilment');
    });

    it('isolates tenants with row-level security', async () => {
      const other = '00000000-0000-0000-0000-0000000000ff';
      await ctx.owner.query("INSERT INTO tenants (id, name) VALUES ($1, 'Other') ON CONFLICT DO NOTHING", [other]);
      await ctx.owner.query("INSERT INTO accounts (tenant_id, name, domain) VALUES ($1, 'Hidden Co', 'hidden.example')", [other]);
      const r = await ctx.http.get('/v1/records/accounts?q=Hidden').set(auth(rep)).expect(200);
      expect(r.body.total).toBe(0);
    });

    it('requires authentication and validates input', async () => {
      await ctx.http.get('/v1/records/accounts').expect(401);
      const bad = await ctx.http.post('/v1/records/opportunities').set(auth(rep)).send({ gpu_count: 'lots' }).expect(400);
      expect(bad.body.error.details.map((d: { path: string }) => d.path)).toEqual(expect.arrayContaining(['gpu_count', 'name']));
      await ctx.http.get('/v1/records/opportunities/not-a-uuid').set(auth(rep)).expect(400);
    });
  });
});
