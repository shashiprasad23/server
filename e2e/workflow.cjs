// End-to-end workflow across roles, driven through the real UI.
// Usage: node e2e/workflow.cjs [screenshot-dir]   (API on :8000 with fresh seed, web on :5173)
const fs = require('fs');
let playwright;
try { playwright = require('playwright'); } catch { playwright = require(process.env.PLAYWRIGHT_MODULE || 'playwright'); }
const { chromium } = playwright;
const OUT = process.argv[2] || 'e2e/screenshots';
const BASE = process.env.BASE_URL || 'http://localhost:5173';
fs.mkdirSync(OUT, { recursive: true });
const errors = [];
const log = (...a) => console.log('•', ...a);

(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  // 4xx responses the UI handles (validation) are expected; record anything else.
  page.on('console', (m) => { if (m.type() === 'error' && !/status of 4(22|09)/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  async function login(name) {
    await ctx.clearCookies();
    await page.goto(BASE + '/login');
    await page.evaluate(() => localStorage.clear());
    await page.goto(BASE + '/login');
    await page.getByRole('button', { name: new RegExp(name) }).click();
    await page.waitForURL(BASE + '/');
    await page.waitForSelector('h1:has-text("My work")');
    await page.waitForLoadState('networkidle');
    log('signed in as', name);
  }
  const shot = async (name) => { await page.waitForTimeout(400); await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }); };

  // 1. Contributor: My work, Log Work on WP-1042
  await login('S. Prasad');
  await page.waitForSelector('text=This week\'s load');
  await shot('01-my-work');
  await page.goto(BASE + '/work-items/WP-1042');
  await page.waitForSelector('text=Time summary');
  const remBefore = await page.locator('text=Remaining estimate').first().locator('xpath=following-sibling::div[1]').textContent();
  await page.getByLabel('Duration').fill('1h 30m');
  await page.getByLabel('Work description').fill('Implemented and tested input validation.');
  await page.getByRole('button', { name: /^Log 1h 30m$/ }).click();
  await page.waitForSelector('text=Logged 1h 30m on WP-1042');
  await page.getByRole('tab', { name: 'Work history' }).click();
  await page.waitForSelector('text=/in draft entries not yet counted/');
  await page.waitForFunction(() => [...document.querySelectorAll('.card .mono')].some((e) => e.textContent === '2h 00m'));
  const remAfter = await page.locator('text=Remaining estimate').first().locator('xpath=following-sibling::div[1]').textContent();
  log('remaining estimate', remBefore, '→', remAfter);
  await shot('02-work-item-after-log');
  // validation error path (description too short)
  await page.getByLabel('Duration').fill('30m');
  await page.getByLabel('Work description').fill('short');
  await page.getByRole('button', { name: /^Log 0h 30m$/ }).click();
  await page.waitForSelector('text=min 10 characters');
  log('inline validation shown for short description');

  // 2. Timesheet: submit this week (missing time → confirm)
  await page.goto(BASE + '/timesheets');
  await page.waitForSelector('text=My timesheet');
  await page.getByRole('button', { name: 'Submit week' }).click();
  await page.waitForSelector('text=missing against your work calendar');
  await page.getByRole('button', { name: 'Submit anyway' }).click();
  await page.waitForSelector('text=approver has been notified');
  log('timesheet submitted');
  await page.getByRole('button', { name: 'Previous week' }).click();
  await page.waitForSelector('text=1 rejected');
  await shot('03-timesheet-last-week');

  // 3. Approver: approve S. Prasad's Web Portal time
  await login('R. Iyer');
  await page.goto(BASE + '/timesheets/approvals');
  await page.waitForSelector('text=Approvals queue');
  await shot('04-approvals');
  const card = page.locator('section.card', { hasText: 'S. Prasad' }).first();
  await card.getByRole('button', { name: 'Approve all' }).click();
  await page.waitForSelector('text=/Approved \\d+ entr/');
  log('approved S. Prasad time');

  // 4. Board
  const projects = await page.evaluate(async () => (await (await fetch('/api/v1/projects', { headers: { Authorization: 'Bearer ' + localStorage.getItem('upm.token') } })).json()));
  const wp = projects.find((p) => p.key === 'WP');
  await page.goto(`${BASE}/projects/${wp.id}/board`);
  await page.waitForSelector('text=Committed');
  await shot('05-board');

  // 5. AI meeting review: edit + approve the Finance action
  await page.goto(BASE + '/meetings');
  await page.getByText('Sprint 14 mid-point review').click();
  await page.waitForSelector('text=Proposed actions');
  await shot('06-meeting-review');
  const finance = page.locator('section.card.emph', { hasText: 'Finance' }).first();
  await finance.getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('Due date').fill('2026-10-16');
  await page.getByLabel('Owner').selectOption({ label: 'M. Shah' });
  await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForTimeout(500);
  await finance.getByRole('button', { name: 'Approve & create ticket' }).click();
  await page.waitForSelector('text=/Created WP-\\d+ · linked to this meeting/');
  log('AI action approved → ticket created');
  await page.getByRole('button', { name: 'Publish summary' }).click();
  await page.waitForSelector('text=Summary published');

  // 6. Resources as resource manager
  await login('N. Kapoor');
  await page.goto(BASE + '/resources');
  await page.waitForSelector('text=Conflicts');
  await shot('07-capacity');

  // 7. Service desk as queue lead; raise a request from the catalog
  await login('L. Fernandes');
  await page.goto(BASE + '/service');
  await page.waitForSelector('text=Open in queue');
  await shot('08-service-desk');
  await page.getByRole('button', { name: 'New request' }).click();
  await page.locator('section.card', { hasText: 'Access provisioning' }).getByRole('button', { name: 'Request' }).click();
  await page.getByLabel('System *').selectOption('Staging');
  await page.getByLabel('Business justification *').fill('Release verification');
  await page.getByRole('button', { name: 'Submit request' }).click();
  await page.waitForSelector('text=SLA timeline');
  log('service request raised →', page.url());

  // 8. Reports + admin audit
  await login('R. Iyer');
  await page.goto(BASE + '/reports');
  await page.waitForSelector('text=Tickets with estimate');
  await shot('09-reports');
  await login('Platform Admin');
  await page.goto(BASE + '/admin');
  await page.getByRole('button', { name: 'Audit log' }).click();
  await page.waitForSelector('text=time_entry.approved');
  await shot('10-audit');
  await page.goto(BASE + '/login');

  await browser.close();
  console.log('console errors:', errors.length ? errors : 'none');
})().catch((e) => { console.error('E2E FAILED:', e.message); console.log('console errors:', errors); process.exit(1); });
