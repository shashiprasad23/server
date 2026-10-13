import { test, expect } from '../../src/fixtures';
import { QuoteFormPage } from '../../src/ui/pages/QuoteFormPage';
import { data, newCustomer, uniqueEmail } from '../../src/data/factories';
import type { Quote } from '../../src/api/types';

test.describe('Quote initiation and customer details (UI)', () => {
  let form: QuoteFormPage;
  test.beforeEach(async ({ page }) => {
    form = new QuoteFormPage(page);
  });

  test('SQ-001 Send quote from Admin page opens the quote page @P0 @smoke', async ({ page }) => {
    await form.openFromAdmin();
    await expect(page.locator('[data-testid="quote-form"]')).toBeVisible();
  });

  test('SQ-002 Customer validation shows registered details or "No data found" @P0 @smoke', async () => {
    await form.openAdmin();
    const registered = await form.lookupCustomer(data.registeredCustomer.email);
    await expect(registered).toContainText(data.registeredCustomer.companyName);
    await expect(registered).toContainText(data.registeredCustomer.email);

    const unknown = await form.lookupCustomer(uniqueEmail('unknown'));
    await expect(unknown).toHaveText(/no data found/i);
  });

  test('SQ-003 Lead quote with valid customer details creates user and quote @P0 @smoke', async ({
    admin,
  }) => {
    const c = newCustomer();
    await form.openAdmin();
    await form.fill({ ...c, sku: data.server.sku, quantity: 1 });
    await form.submit();
    const number = await form.expectCreated();

    const quotes: Quote[] = await (await admin.listQuotes({ customerEmail: c.email })).json();
    expect(quotes.map((q) => q.number)).toContain(number);
    expect((await admin.lookupCustomer(c.email)).status(), 'customer is now registered').toBe(200);
  });

  test('SQ-004 Mandatory email blocks submission with field-level message @P1', async () => {
    await form.openAdmin();
    await form.fill({ companyName: '', contactName: '', email: '', sku: data.server.sku });
    await form.submit();
    await expect(form.fieldError('email')).toHaveText(/email required/i);
    await form.expectBlocked();
  });

  test('SQ-005 Invalid email format is rejected @P1', async () => {
    await form.openAdmin();
    await form.fill({ ...newCustomer(), email: 'buyer@invalid', sku: data.server.sku });
    await form.submit();
    await expect(form.fieldError('email')).toHaveText(/invalid email/i);
    await form.expectBlocked();
  });

  for (const phone of ['abcdefghij', '12', '+1-555-CALL-NOW']) {
    test(`SQ-006 Invalid contact number "${phone}" is rejected @P1`, async () => {
      await form.openAdmin();
      await form.fill({ ...newCustomer(), phone, sku: data.server.sku });
      await form.submit();
      await expect(form.fieldError('phone')).toHaveText(/invalid phone/i);
      await form.expectBlocked();
    });
  }

  test('SQ-007 Submit without product asks for a product, general inquiry is accepted @P1', async () => {
    await form.openAdmin();
    await form.fill(newCustomer());
    await form.submit();
    await expect(form.fieldError('items')).toHaveText(/select a product/i);
    await form.expectBlocked();

    await form.fill({ generalInquiry: true, notes: 'Need a 64-GPU training cluster, budget TBD' });
    await form.submit();
    await form.expectCreated();
  });

  test('SQ-008 Double-click on Submit creates exactly one quote @P0', async ({ page, admin }) => {
    const c = newCustomer();
    await form.openAdmin();
    await form.fill({ ...c, sku: data.server.sku });
    // Slow the API down so the second click lands while the first request is still in flight.
    await page.route('**/api/quotes', async (route) => {
      await new Promise((r) => setTimeout(r, 1500));
      await route.continue();
    });
    await page.locator('[data-testid="submit-quote"]').dblclick();
    await page
      .locator('[data-testid="submit-quote"]')
      .click({ force: true })
      .catch(() => undefined);
    await form.expectCreated();
    await page.waitForTimeout(2000);
    const quotes: Quote[] = await (await admin.listQuotes({ customerEmail: c.email })).json();
    expect(quotes).toHaveLength(1);
  });

  test('SQ-009 Existing business account details are linked to the request @P1', async ({ admin }) => {
    const rc = data.registeredCustomer;
    await form.openAdmin();
    await form.lookupCustomer(rc.email);
    await form.fill({ sku: data.server.sku });
    await form.submit();
    const number = await form.expectCreated();
    const quotes: Quote[] = await (await admin.listQuotes({ customerEmail: rc.email })).json();
    const q = quotes.find((x) => x.number === number)!;
    expect(q.customer).toMatchObject({
      companyName: rc.companyName,
      contactName: rc.contactName,
      email: rc.email,
      phone: rc.phone,
    });
    expect(q.customer.guest).toBe(false);
  });
});

test.describe('Guest B2B quote request (UI)', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('SQ-010 Guest request gets a guest reference and verifiable contact info @P1', async ({
    page,
    admin,
  }) => {
    const form = new QuoteFormPage(page);
    const c = newCustomer();
    await form.openGuest();
    await form.fill({ ...c, sku: data.server.sku });
    await form.submit();
    const number = await form.expectCreated();
    await expect(page.locator('[data-testid="guest-reference"]')).toHaveText(/^GUEST-/);

    const quotes: Quote[] = await (await admin.listQuotes({ customerEmail: c.email })).json();
    const q = quotes.find((x) => x.number === number)!;
    expect(q.customer.guest).toBe(true);
    expect(q.customer).toMatchObject({ email: c.email, contactName: c.contactName, phone: c.phone });
  });
});
