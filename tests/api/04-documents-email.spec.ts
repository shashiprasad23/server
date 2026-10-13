import { test, expect } from '../../src/fixtures';
import {
  data,
  quoteInput,
  serverItem,
  uniqueEmail,
  baseServerConfig,
  newCustomer,
} from '../../src/data/factories';
import { isPdf, pdfText } from '../../src/utils/pdf';

const money = (n: number) => n.toFixed(2);

test.describe('Quote document generation and email delivery', () => {
  test('SQ-033 Valid quote generates a readable PDF with a unique quote number @P0 @smoke', async ({
    sales,
  }) => {
    const [a, b] = await Promise.all([sales.createQuoteOk(quoteInput()), sales.createQuoteOk(quoteInput())]);
    expect(a.number).not.toBe(b.number);
    const res = await sales.pdf(a.id);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('application/pdf');
    const buf = await res.body();
    expect(isPdf(buf)).toBe(true);
    expect(await pdfText(buf)).toContain(a.number);
  });

  test('SQ-034 PDF line items match the saved quote @P0', async ({ sales }) => {
    const svc = data.serviceSkus;
    const q = await sales.createQuoteOk(
      quoteInput({
        items: [
          serverItem(2, baseServerConfig()),
          { sku: svc.installation, quantity: 2 },
          { sku: svc.warranty, quantity: 1 },
        ],
      }),
    );
    const text = await pdfText(await (await sales.pdf(q.id)).body());
    for (const l of q.items) {
      expect(text).toContain(l.sku);
      expect(text).toContain(l.name);
      expect(text).toContain(money(l.unitPrice));
      expect(text).toContain(money(l.lineTotal));
      expect(text).toMatch(new RegExp(`Qty\\s*${l.quantity}`));
    }
    expect(text).toContain(money(q.grandTotal));
  });

  test('SQ-035 PDF commercial terms are present and correct @P0', async ({ sales }) => {
    const q = await sales.createQuoteOk(
      quoteInput({ items: [serverItem(1), { sku: data.serviceSkus.warranty, quantity: 1 }] }),
    );
    const text = await pdfText(await (await sales.pdf(q.id)).body());
    expect(text).toContain(q.terms.paymentTerms);
    expect(text).toContain(q.terms.deliveryEstimate);
    expect(text).toContain(q.terms.warranty);
    expect(text).toContain(q.terms.validUntil.slice(0, 10));
    expect(text).toContain(q.terms.exclusions);
    expect(text).toContain(money(q.taxTotal));
  });

  test('SQ-036 Send Quote emails the customer and references the quote @P0 @smoke', async ({
    quoteIn,
    sales,
    mailbox,
  }) => {
    const q = await quoteIn('Approved');
    const res = await sales.send(q.id, [q.customer.email]);
    expect(res.status()).toBe(200);
    expect((await sales.getQuoteOk(q.id)).status).toBe('Sent');
    const [mail] = await mailbox.waitFor(`to:${q.customer.email}`);
    expect(mail.Subject).toContain(q.number);
    const emails = await sales.emails(q.id);
    expect(emails.filter((e) => e.status === 'sent' || e.status === 'queued')).toHaveLength(1);
  });

  for (const bad of ['buyer@invalid', 'not-an-email', 'a@b', 'x@y.com, z@']) {
    test(`SQ-037 Malformed recipient "${bad}" is rejected before sending @P1`, async ({ quoteIn, sales }) => {
      const q = await quoteIn('Approved');
      const res = await sales.send(q.id, [bad]);
      expect(res.status()).toBe(422);
      expect((await res.json()).errors.recipients).toMatch(/invalid email/i);
      expect(await sales.emails(q.id)).toHaveLength(0);
      expect((await sales.getQuoteOk(q.id)).status).toBe('Approved');
    });
  }

  test('SQ-038 Multiple recipients each receive it without seeing each other @P1', async ({
    quoteIn,
    sales,
    mailbox,
  }) => {
    const q = await quoteIn('Approved');
    const recipients = [q.customer.email, uniqueEmail('procurement')];
    expect((await sales.send(q.id, recipients)).status()).toBe(200);
    for (const r of recipients) {
      const [m] = await mailbox.waitFor(`to:${r}`);
      const visible = [...m.To, ...(m.Cc ?? [])].map((a) => a.Address);
      const others = recipients.filter((x) => x !== r);
      for (const o of others) expect(visible, `${r} must not see ${o}`).not.toContain(o);
    }
  });

  test('SQ-039 Email has the correct PDF attachment and a working secure link @P0', async ({
    quoteIn,
    sales,
    anonymous,
    mailbox,
  }) => {
    const q = await quoteIn('Approved');
    await sales.send(q.id, [q.customer.email]);
    const [summary] = await mailbox.waitFor(`to:${q.customer.email}`);
    const mail = await mailbox.message(summary.ID);
    const pdfPart = mail.Attachments.find((a) => a.ContentType === 'application/pdf');
    expect(pdfPart, 'PDF attachment present').toBeTruthy();
    const pdf = await mailbox.attachment(summary.ID, pdfPart!.PartID);
    expect(await pdfText(pdf)).toContain(q.number);

    const link = mail.Text.match(/https?:\/\/\S+\/q\/([A-Za-z0-9_-]+)/);
    expect(link, 'secure quote link present').toBeTruthy();
    const shared = await anonymous.sharedQuote(link![1]);
    expect(shared.status()).toBe(200);
    expect((await shared.json()).number).toBe(q.number);
  });

  test('SQ-041 Resend sends the current revision and records the event @P1', async ({
    quoteIn,
    sales,
    mailbox,
  }) => {
    const q = await quoteIn('Sent');
    const res = await sales.resend(q.id);
    expect(res.status()).toBe(200);
    const mails = await mailbox.waitFor(`to:${q.customer.email}`, 2);
    for (const m of mails) expect(m.Subject).toContain(`revision ${q.revision}`);
    const emails = await sales.emails(q.id);
    expect(emails.map((e) => e.type)).toEqual(['send', 'resend']);
    expect(emails.every((e) => e.revision === q.revision)).toBe(true);
    expect((await sales.audit(q.id)).map((a) => a.action)).toContain('resent');
  });

  test('SQ-042 PDF carries approved branding and contact details @P2', async ({
    quoteIn,
    sales,
    mailbox,
  }) => {
    const q = await quoteIn('Sent');
    const text = await pdfText(await (await sales.pdf(q.id)).body());
    expect(text).toMatch(/UVATION/);
    expect(text).toMatch(/quotes@uvation\.com/);
    expect(text).toMatch(/www\.uvation\.com/);
    const [m] = await mailbox.waitFor(`to:${q.customer.email}`);
    expect((await mailbox.message(m.ID)).Text).toMatch(/Uvation/);
  });

  test('SQ-043 Unicode and long multi-line descriptions render without loss @P2', async ({ sales }) => {
    const longName = 'Ünïcødé Résearch GmbH — Δ-Compute Ωmega Labs ±µ';
    const description = [
      'Custom 8× H200 node — liquid-cooled, Größe 4U',
      'Line 2: NVLink® switch fabric, 3.2 Tb/s',
      'Line 3: ' + 'very long specification text '.repeat(15).trim(),
    ].join('\n');
    const q = await sales.createQuoteOk(
      quoteInput({
        customer: newCustomer({ companyName: longName }),
        items: [{ sku: data.server.sku, quantity: 1, description }],
      }),
    );
    expect(q.items[0].description).toBe(description);
    const text = (await pdfText(await (await sales.pdf(q.id)).body())).replace(/\s+/g, ' ');
    expect(text).toContain(longName.normalize('NFKC'));
    for (const fragment of ['8× H200', 'Größe 4U', 'NVLink®', '3.2 Tb/s']) expect(text).toContain(fragment);
    expect(text).toContain('very long specification text very long specification text');
  });
});
