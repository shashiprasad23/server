# Uvation Marketplace – Send Quote automation pipeline

Playwright + TypeScript automation for the Uvation Marketplace **quote workflow**, covering all test cases from the
QA test plan: **SQ-001 … SQ-074** (functional, security, AI-infrastructure edge cases) and **NFR-001 … NFR-010**
(non-functional). Every run produces an execution sheet in the same shape as the test plan
(`TC ID, Scenario, Priority, Test Status, Date`) so results can be pasted straight back into the tracker.

## Layout

```
config/            env.ts (environment, credentials, test data), endpoints.ts (API route map)
src/api/           QuoteApi typed client + domain types
src/ui/            selectors.ts (all UI locators), page objects
src/fixtures/      role-based API fixtures (admin, sales, approver, finance, customer, otherCustomer, anonymous)
src/utils/         Mailpit client, PDF text extraction, fault-injection hooks, money & load helpers
src/reporting/     traceability reporter -> reports/traceability.csv|json, reports/summary.md
test-cases/        catalog.json – the 84 test cases from the test plan (source of truth for the report)
test-data/         per-environment SKUs, price lists, discount codes, tax/shipping expectations
tests/api/         01-07: SQ scenarios by section (parallel)
tests/ui/          browser flows: admin quote page, guest request, send quote, XSS rendering
tests/faults/      scenarios that change global state (serial, isolated stage)
tests/nfr/         NFR-001..010 (CI-scale load/consistency/security)
perf/k6/           peak-load & scalability script (NFR-002 / NFR-010) for QA/staging
mock-server/       contract stub of the quote service used to self-verify the pipeline (TEST_ENV=mock)
.github/workflows/ qa-pipeline.yml
```

## Pipeline (`.github/workflows/qa-pipeline.yml`)

| Stage            | What runs                                                                                   | When                        |
| ---------------- | ------------------------------------------------------------------------------------------- | --------------------------- |
| Lint & typecheck | `tsc`, prettier                                                                             | every run                   |
| Functional       | `api` + `ui` projects (`@smoke` only for suite=smoke or env=prod)                           | every run except perf       |
| Resilience       | `tests/faults` serially: SQ-032/040/053/061/071/072, NFR-005/006/009                        | not on smoke, never on prod |
| Non-functional   | `tests/nfr`                                                                                 | suite=full, never on prod   |
| Report           | merges all stages → HTML, JUnit, traceability CSV/JSON, job summary; fails if any TC failed | always                      |
| k6 perf          | `perf/k6/quote-load.js`                                                                     | manual, suite=perf          |

Triggers: push / PR → full run against the mock (pipeline self-check); nightly → `vars.NIGHTLY_ENV` (default `mock`);
**Run workflow** → choose `environment` (mock / qa / staging / prod) and `suite` (smoke / regression / full / perf).

### Connecting a real environment

1. Create GitHub Environments `qa`, `staging`, `prod` with secrets: `BASE_URL`, `API_BASE_URL`, `MAIL_API_URL`
   and one account per role (`ADMIN_*`, `SALES_*`, `APPROVER_*`, `FINANCE_*`, `CUSTOMER_*`, `OTHER_CUSTOMER_*` — see `.env.example`).
2. Set environment variable `FAULT_INJECTION=false` where the `/__test/*` hooks don't exist; those tests are then reported
   as **Skipped** rather than failing.
3. Fill `test-data/<env>.json` with real SKUs, price lists, discount codes, tax rate and shipping cost
   (`qa/staging/prod.json` are currently copies of the mock data).
4. Align `config/endpoints.ts` (API routes) and `src/ui/selectors.ts` (DOM locators) with the marketplace. Specs never
   hard-code either, so these two files are the only adaptation points.
5. Point `MAIL_API_URL` at a Mailpit/MailHog instance that captures the environment's outgoing mail.

## Running locally

```bash
npm ci && npx playwright install chromium
npx playwright test                 # everything against the mock (starts it automatically)
npm run test:smoke                  # @smoke only
npx playwright test --grep "SQ-02"  # one area
cp .env.example .env                # then edit to target qa/staging
npm run report                      # open HTML report
```

Tags: `@P0 @P1 @P2` (plan priority), `@smoke` (P0 cases already passed manually on 09.10.2026).

## Notes and assumptions

- The marketplace was not reachable from the build environment, so the API contract (routes, payloads, status codes)
  and UI `data-testid`s are **assumed** and implemented by `mock-server/`. Expect to adjust `endpoints.ts`,
  `selectors.ts` and possibly response field names in `src/api/types.ts` on first run against QA.
- SQ-029 is interpreted as "only configured currencies are accepted" (`supportedCurrencies` in test data).
- SQ-069 is NA in the plan and is reported as NA.
- NFR priorities were not in the plan; P0/P1 were assigned in `test-cases/catalog.json`.
