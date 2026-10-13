import { test, expect } from '../../src/fixtures';
import { data, idempotencyKey, newCustomer, quoteInput, uniqueEmail } from '../../src/data/factories';
import type { Quote } from '../../src/api/types';

test.describe('Quote initiation and customer details (API)', () => {
  test('SQ-002 Customer lookup returns registered details, 404 "No data found" otherwise @P0 @smoke', async ({
    admin,
  }) => {
    const found = await admin.lookupCustomer(data.registeredCustomer.email);
    expect(found.status()).toBe(200);
    expect(await found.json()).toMatchObject({
      email: data.registeredCustomer.email,
      companyName: data.registeredCustomer.companyName,
    });
    const missing = await admin.lookupCustomer(uniqueEmail('nobody'));
    expect(missing.status()).toBe(404);
    expect((await missing.json()).error).toMatch(/no data found/i);
  });

  test('SQ-003 Valid lead quote creates the customer and the quote request @P0 @smoke', async ({ sales }) => {
    const input = quoteInput();
    const q = await sales.createQuoteOk(input);
    expect(q.id).toBeTruthy();
    expect(q.number).toMatch(/\S+/);
    expect(q.status).toBe('Draft');
    expect(q.customer).toMatchObject({
      email: input.customer.email,
      companyName: input.customer.companyName,
    });
    expect(q.customer.id).toBeTruthy();
    expect((await sales.lookupCustomer(input.customer.email!)).status()).toBe(200);
  });

  test('SQ-004 Email is mandatory, company details are optional @P1', async ({ sales }) => {
    const noEmail = await sales.createQuote(quoteInput({ customer: { companyName: 'No Email Inc' } }));
    expect(noEmail.status()).toBe(422);
    expect((await noEmail.json()).errors.email).toMatch(/email required/i);

    const emailOnly = await sales.createQuote(quoteInput({ customer: { email: uniqueEmail('only') } }));
    expect(emailOnly.status(), 'company details are not mandatory').toBe(201);
  });

  for (const email of [
    'buyer@invalid',
    'buyer.invalid.com',
    'buyer@@acme.com',
    'buyer @acme.com',
    '<script>@x.com',
  ]) {
    test(`SQ-005 Invalid email "${email}" is rejected @P1`, async ({ sales }) => {
      const res = await sales.createQuote(quoteInput({ customer: newCustomer({ email }) }));
      expect(res.status()).toBe(422);
      expect((await res.json()).errors.email).toMatch(/invalid email/i);
    });
  }

  for (const phone of ['abcdefghij', '12', '+1-555-CALL-NOW', '555;DROP']) {
    test(`SQ-006 Invalid contact number "${phone}" is rejected @P1`, async ({ sales }) => {
      const res = await sales.createQuote(quoteInput({ customer: newCustomer({ phone }) }));
      expect(res.status()).toBe(422);
      expect((await res.json()).errors.phone).toMatch(/invalid phone/i);
    });
  }

  test('SQ-007 No product requires a selection unless it is a general inquiry @P1', async ({ sales }) => {
    const res = await sales.createQuote(quoteInput({ items: [] }));
    expect(res.status()).toBe(422);
    expect((await res.json()).errors.items).toMatch(/select a product/i);

    const general = await sales.createQuoteOk(
      quoteInput({ items: [], inquiryType: 'general', notes: 'Looking for 32x H200 training capacity' }),
    );
    expect(general.inquiryType).toBe('general');
    expect(general.items).toHaveLength(0);
  });

  test('SQ-008 Retried submission with the same idempotency key creates one quote @P0', async ({ sales }) => {
    const input = quoteInput();
    const key = idempotencyKey();
    const [a, b] = await Promise.all([sales.createQuote(input, key), sales.createQuote(input, key)]);
    const c = await sales.createQuote(input, key); // retry after a "slow response"
    const ids = await Promise.all([a, b, c].map(async (r) => (await r.json()).id));
    expect(new Set(ids).size).toBe(1);
    const list: Quote[] = await (await sales.listQuotes({ customerEmail: input.customer.email! })).json();
    expect(list).toHaveLength(1);
  });

  test('SQ-009 Quote for an existing business account links the saved company @P1', async ({ sales }) => {
    const rc = data.registeredCustomer;
    const q = await sales.createQuoteOk(quoteInput({ customer: { email: rc.email } }));
    expect(q.customer).toMatchObject({
      email: rc.email,
      companyName: rc.companyName,
      contactName: rc.contactName,
      phone: rc.phone,
      guest: false,
    });
  });

  test('SQ-010 Guest (not signed in) request gets a guest reference @P1', async ({ anonymous }) => {
    const input = quoteInput();
    const q = await anonymous.createQuoteOk(input);
    expect(q.customer.guest).toBe(true);
    expect(q.customer.guestReference).toMatch(/^GUEST-/);
    expect(q.customer).toMatchObject({ email: input.customer.email, phone: input.customer.phone });

    const noContact = await anonymous.createQuote(quoteInput({ customer: { email: uniqueEmail('g') } }));
    expect(noContact.status(), 'guest needs verifiable contact information').toBe(422);
  });
});
