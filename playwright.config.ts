import { defineConfig, devices } from '@playwright/test';
import { env } from './config/env';

/**
 * Projects (run order in CI):
 *   api, ui   - functional SQ-001..SQ-074, parallel
 *   faults    - tests that inject global faults (email outage, pricing latency, catalog changes); serial, isolated
 *   nfr       - NFR-001..NFR-010 load / resilience checks
 * Locally `npx playwright test` runs everything in that order via project dependencies.
 */
export default defineConfig({
  testDir: './tests',
  outputDir: 'test-results',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 4 : undefined,
  reporter: process.env.CI
    ? [['list'], ['blob', { outputDir: 'reports/blob' }]]
    : [
        ['list'],
        ['html', { outputFolder: 'reports/html', open: 'never' }],
        ['junit', { outputFile: 'reports/junit.xml' }],
        ['./src/reporting/traceability-reporter.ts', { outputDir: 'reports' }],
      ],
  use: {
    baseURL: env.baseUrl,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'ui-setup', testMatch: /ui\/auth\.setup\.ts/ },
    { name: 'api', testDir: './tests/api' },
    {
      name: 'ui',
      testDir: './tests/ui',
      testMatch: /.*\.ui\.spec\.ts/,
      dependencies: ['ui-setup'],
      use: { ...devices['Desktop Chrome'], storageState: '.auth/admin.json' },
    },
    { name: 'faults', testDir: './tests/faults', fullyParallel: false, dependencies: ['api', 'ui'] },
    { name: 'nfr', testDir: './tests/nfr', fullyParallel: false, timeout: 300_000, dependencies: ['faults'] },
  ],
  webServer: env.isMock
    ? {
        command: 'npx tsx mock-server/server.ts',
        url: `${env.apiBaseUrl}/health`,
        reuseExistingServer: !process.env.CI,
        timeout: 30_000,
      }
    : undefined,
});
