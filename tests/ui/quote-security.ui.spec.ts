import { test, expect } from '../../src/fixtures';
import { selectors } from '../../src/ui/selectors';
import { quoteInput, newCustomer } from '../../src/data/factories';

const v = selectors.quoteView;

test('SQ-059 Script/HTML in quote fields is rendered inert in the admin UI @P0', async ({ page, sales }) => {
  const payload = `<img src=x onerror="window.__xss=1"><script>window.__xss=1</script>`;
  const q = await sales.createQuoteOk(
    quoteInput({
      customer: newCustomer({ companyName: payload }),
      notes: `'; DROP TABLE quotes; -- ${payload}`,
    }),
  );
  let dialog = false;
  page.on('dialog', async (d) => {
    dialog = true;
    await d.dismiss();
  });
  await page.goto(v.path(q.id));
  await expect(page.locator(v.number)).toHaveText(q.number);
  await expect(page.locator(v.company)).toHaveText(payload); // shown literally, not parsed
  expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined();
  expect(dialog).toBe(false);
});

test('SQ-036 Send Quote from the quote page emails the customer @P0 @smoke', async ({
  page,
  quoteIn,
  mailbox,
}) => {
  const q = await quoteIn('Approved');
  await page.goto(v.path(q.id));
  await page.fill(v.recipients, q.customer.email);
  await page.click(v.sendButton);
  await expect(page.locator(v.sendResult)).toHaveText(/quote sent/i);
  await expect(page.locator(v.status)).toHaveText('Sent');
  const mails = await mailbox.waitFor(`to:${q.customer.email}`);
  expect(mails[0].Subject).toContain(q.number);
});

test('SQ-037 Malformed recipient is rejected in the UI before sending @P1', async ({ page, quoteIn }) => {
  const q = await quoteIn('Approved');
  await page.goto(v.path(q.id));
  await page.fill(v.recipients, 'procurement@@acme');
  await page.click(v.sendButton);
  await expect(page.locator(v.sendResult)).toHaveText(/invalid email/i);
  await expect(page.locator(v.status)).toHaveText('Approved');
});
