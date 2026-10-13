import { test, expect } from '../../src/fixtures';
import { data, newCustomer, quoteInput } from '../../src/data/factories';
import { pdfText } from '../../src/utils/pdf';

test.describe('Security, permissions, audit, and reliability', () => {
  test('SQ-055 Each role can perform only its authorized actions @P0 @smoke', async ({
    sales,
    approver,
    customer,
    admin,
    finance,
  }) => {
    // create
    expect((await sales.createQuote(quoteInput())).status()).toBe(201);
    expect((await admin.createQuote(quoteInput())).status()).toBe(201);
    expect((await approver.createQuote(quoteInput())).status()).toBe(403);
    expect((await finance.createQuote(quoteInput())).status()).toBe(403);

    // approve / reject
    const q = await sales.createQuoteOk(quoteInput({ manualDiscountPercent: 20 }));
    await sales.submit(q.id);
    expect((await sales.action(q.id, 'approve')).status()).toBe(403);
    expect((await customer.action(q.id, 'approve')).status()).toBeGreaterThanOrEqual(403);
    expect((await approver.action(q.id, 'approve')).status()).toBe(200);

    // send / override / audit are staff-only
    const own = await sales.createQuoteOk(quoteInput({ customer: { email: data.registeredCustomer.email } }));
    expect((await customer.getQuote(own.id)).status(), 'customer can read own company quote').toBe(200);
    expect((await customer.send(own.id, [data.registeredCustomer.email])).status()).toBe(403);
    expect((await customer.overridePrice(own.id, own.items[0].lineId, 1, 'x')).status()).toBe(403);
    expect((await customer.ctx.get(`/api/quotes/${own.id}/audit`)).status()).toBe(403);
    expect((await approver.overridePrice(own.id, own.items[0].lineId, 1, 'x')).status()).toBe(403);
    expect(
      (await admin.overridePrice(own.id, own.items[0].lineId, 40000, 'admin can override')).status(),
    ).toBe(200);
  });

  test("SQ-056 A customer cannot open another company's quote by ID @P0", async ({
    sales,
    customer,
    otherCustomer,
  }) => {
    const acme = await sales.createQuoteOk(
      quoteInput({ customer: { email: data.registeredCustomer.email } }),
    );
    const res = await otherCustomer.getQuote(acme.id);
    expect([403, 404]).toContain(res.status());
    const body = await res.text();
    expect(body).not.toContain(acme.number);
    expect(body).not.toContain(data.registeredCustomer.companyName);
    expect([403, 404]).toContain((await otherCustomer.pdf(acme.id)).status());
    expect([403, 404]).toContain((await otherCustomer.accept(acme.id)).status());
    const list = await (await otherCustomer.listQuotes()).json();
    expect(list.map((q: any) => q.id)).not.toContain(acme.id);
    expect((await customer.getQuote(acme.id)).status(), 'owner still has access').toBe(200);
  });

  test('SQ-057 Private quote links require a valid secure token @P0', async ({ quoteIn, anonymous }) => {
    const q = await quoteIn('Sent');
    expect((await anonymous.getQuote(q.id)).status(), 'API without auth').toBe(401);
    expect([401, 403, 404]).toContain((await anonymous.sharedQuote(q.id)).status()); // quote id is not a token
    const tampered = q.shareToken!.slice(0, -1) + (q.shareToken!.endsWith('a') ? 'b' : 'a');
    expect([401, 403, 404]).toContain((await anonymous.sharedQuote(tampered)).status());
    expect([401, 403, 404]).toContain((await anonymous.acceptViaLink(tampered)).status());
    expect((await anonymous.sharedQuote(q.shareToken!)).status()).toBe(200);
    const badToken = await anonymous.ctx.get(`/api/quotes/${q.id}`, {
      headers: { Authorization: 'Bearer forged-token' },
    });
    expect(badToken.status()).toBe(401);
  });

  test('SQ-058 Price override records original, new price, user, time and reason @P0', async ({ sales }) => {
    const q = await sales.createQuoteOk(quoteInput());
    const line = q.items[0];
    expect((await sales.overridePrice(q.id, line.lineId, 41000)).status(), 'reason is mandatory').toBe(422);
    const res = await sales.overridePrice(q.id, line.lineId, 41000, 'Competitive match vs. OEM bid');
    expect(res.status()).toBe(200);
    const entry = (await sales.audit(q.id)).find((a) => a.action === 'price-override')!;
    expect(entry).toMatchObject({
      actor: expect.stringContaining('sales'),
      details: { originalPrice: line.unitPrice, newPrice: 41000, reason: 'Competitive match vs. OEM bid' },
    });
    expect(Date.now() - new Date(entry.at).getTime()).toBeLessThan(5 * 60_000);
    expect((await sales.submit(q.id)).approval.reasons, 'override requires approval').toContain(
      'price-override',
    );
  });

  const injections = [
    `<script>alert(1)</script>`,
    `"><img src=x onerror=alert(1)>`,
    `' OR '1'='1`,
    `'; DROP TABLE quotes; --`,
    `{{7*7}}`,
    `\${7*7}`,
  ];
  for (const payload of injections) {
    test(`SQ-059 Injection payload is stored literally and harmless: ${payload} @P0`, async ({ sales }) => {
      const res = await sales.createQuote(
        quoteInput({ customer: newCustomer({ companyName: payload }), notes: payload }),
      );
      expect(res.status()).toBeLessThan(500);
      if (res.status() === 201) {
        const q = await res.json();
        const fetched = await sales.getQuoteOk(q.id);
        expect(fetched.customer.companyName, 'no template evaluation / mangling').toBe(payload);
        expect((await sales.pdf(q.id)).status()).toBe(200);
      }
      expect((await sales.listQuotes()).status(), 'store still healthy').toBe(200);
    });
  }

  test('SQ-060 Concurrent edits: second writer gets a version conflict @P1', async ({ sales, admin }) => {
    const q = await sales.createQuoteOk(quoteInput());
    const [a, b] = await Promise.all([
      sales.updateQuote(q.id, { items: [{ sku: data.server.sku, quantity: 2 }] }, q.version),
      admin.updateQuote(q.id, { items: [{ sku: data.server.sku, quantity: 5 }] }, q.version),
    ]);
    const statuses = [a.status(), b.status()].sort();
    expect(statuses).toEqual([200, 409]);
    const winner = a.status() === 200 ? 2 : 5;
    expect((await sales.getQuoteOk(q.id)).items[0].quantity).toBe(winner);
  });

  test('SQ-062 Audit trail covers create, edit, approve, send, revise and cancel @P1', async ({
    sales,
    approver,
  }) => {
    const q = await sales.createQuoteOk(quoteInput({ manualDiscountPercent: 15 }));
    await sales.updateQuoteOk(q.id, { notes: 'updated' });
    await sales.submit(q.id);
    await approver.approve(q.id);
    await sales.send(q.id, [q.customer.email]);
    await sales.updateQuoteOk(q.id, { items: [{ sku: data.server.sku, quantity: 2 }] });
    await sales.cancel(q.id, 'Customer withdrew');
    const log = await sales.audit(q.id);
    const actions = log.map((a) => a.action);
    for (const a of ['created', 'updated', 'submitted', 'approved', 'sent', 'revised', 'cancelled'])
      expect(actions).toContain(a);
    for (const e of log) {
      expect(e.actor).toBeTruthy();
      expect(Number.isNaN(Date.parse(e.at))).toBe(false);
    }
    expect(log.find((a) => a.action === 'approved')!.actor).toContain('approver');
  });

  test('SQ-063 Quote PDF, shared link and email expose no internal data @P0', async ({
    quoteIn,
    sales,
    anonymous,
    mailbox,
  }) => {
    const q = await quoteIn('Sent');
    const shared = await (await anonymous.sharedQuote(q.shareToken!)).json();
    const sharedText = JSON.stringify(shared);
    for (const secret of [
      'cost',
      'margin',
      'createdBy',
      'audit',
      q.customer.email,
      q.customer.phone ?? '__none__',
    ])
      expect(sharedText, `shared link leaks ${secret}`).not.toContain(secret);
    const product = await (await anonymous.getProduct(data.server.sku)).json();
    expect(product).not.toHaveProperty('cost');
    const pdf = await pdfText(await (await sales.pdf(q.id)).body());
    expect(pdf).not.toMatch(/margin|supplier cost/i);
    const [m] = await mailbox.waitFor(`to:${q.customer.email}`);
    expect(m.To.map((t) => t.Address)).toEqual([q.customer.email]);
    expect(m.Bcc ?? []).toHaveLength(0);
  });
});
