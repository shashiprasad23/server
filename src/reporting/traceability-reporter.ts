import fs from 'node:fs';
import path from 'node:path';
import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';

interface CatalogEntry {
  id: string;
  suite: string;
  scenario: string;
  expected: string;
  priority: string;
  manualStatus: string | null;
  manualDate: string | null;
}

type Status = 'Pass' | 'Fail' | 'Skipped' | 'NA' | 'Not Run';

/**
 * Produces the execution sheet in the same shape as the manual test plan (TC ID, scenario, priority, status, date),
 * so the automated run can be pasted straight back into the QA tracker.
 * Test titles must start with the TC ID, e.g. "SQ-021 Calculate standard product price".
 */
export default class TraceabilityReporter implements Reporter {
  private results = new Map<string, { status: Status; tests: string[]; notes: string[] }>();
  private outDir: string;

  constructor(options: { outputDir?: string } = {}) {
    this.outDir = options.outputDir ?? 'reports';
  }

  onTestEnd(test: TestCase, result: TestResult) {
    const ids = test.title.match(/\b(SQ|NFR)-\d{3}\b/g);
    if (!ids) return;
    // Only the final attempt counts: a retried pass is reported as Pass (flaky), not Fail.
    if (result.retry < test.retries && result.status !== 'passed' && result.status !== 'skipped') return;
    const na = test.annotations.find((a) => a.type === 'NA');
    const status: Status = na
      ? 'NA'
      : result.status === 'passed'
        ? 'Pass'
        : result.status === 'skipped'
          ? 'Skipped'
          : 'Fail';
    const project = test.parent.project()?.name ?? '';
    for (const id of ids) {
      const entry = this.results.get(id) ?? { status: 'Not Run' as Status, tests: [], notes: [] };
      entry.tests.push(`[${project}] ${test.title}`);
      entry.status = merge(entry.status, status);
      if (status === 'Fail' && result.error?.message) entry.notes.push(firstLine(result.error.message));
      const skip = test.annotations.find((a) => a.type === 'skip' || a.type === 'NA');
      if ((status === 'Skipped' || status === 'NA') && skip?.description) entry.notes.push(skip.description);
      this.results.set(id, entry);
    }
  }

  async onEnd(result: FullResult) {
    const catalog: CatalogEntry[] = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../../test-cases/catalog.json'), 'utf8'),
    );
    const today = new Date();
    const date = `${pad(today.getDate())}.${pad(today.getMonth() + 1)}.${today.getFullYear()}`;
    const rows = catalog.map((c) => {
      const r = this.results.get(c.id);
      const status: Status = r?.status ?? (c.manualStatus === 'NA' ? 'NA' : 'Not Run');
      return {
        'TC ID': c.id,
        Suite: c.suite,
        'Test scenario': c.scenario,
        'Expected result': c.expected,
        Priority: c.priority,
        'Test Status': status,
        Date: status === 'Not Run' ? '' : date,
        'Previous manual status': c.manualStatus ? `${c.manualStatus} ${c.manualDate ?? ''}`.trim() : '',
        'Automated tests': r?.tests.join(' | ') ?? '',
        Notes: [...new Set(r?.notes ?? [])].join(' | '),
      };
    });

    fs.mkdirSync(this.outDir, { recursive: true });
    const headers = Object.keys(rows[0]);
    const csv = [headers, ...rows.map((r) => headers.map((h) => (r as any)[h]))]
      .map((line) => line.map(csvCell).join(','))
      .join('\n');
    fs.writeFileSync(path.join(this.outDir, 'traceability.csv'), csv + '\n');
    fs.writeFileSync(path.join(this.outDir, 'traceability.json'), JSON.stringify(rows, null, 2));

    const count = (s: Status, p?: string) =>
      rows.filter((r) => r['Test Status'] === s && (!p || r.Priority === p)).length;
    const summary = [
      `## Uvation Marketplace quote automation — ${result.status.toUpperCase()}`,
      '',
      '| Priority | Pass | Fail | Skipped | NA | Not Run |',
      '|---|---|---|---|---|---|',
      ...['P0', 'P1', 'P2'].map(
        (p) =>
          `| ${p} | ${count('Pass', p)} | ${count('Fail', p)} | ${count('Skipped', p)} | ${count('NA', p)} | ${count('Not Run', p)} |`,
      ),
      `| **All** | ${count('Pass')} | ${count('Fail')} | ${count('Skipped')} | ${count('NA')} | ${count('Not Run')} |`,
      '',
      ...(count('Fail')
        ? [
            '### Failed test cases',
            '',
            ...rows
              .filter((r) => r['Test Status'] === 'Fail')
              .map((r) => `- **${r['TC ID']}** (${r.Priority}) ${r['Test scenario']} — ${r.Notes}`),
          ]
        : []),
    ].join('\n');
    fs.writeFileSync(path.join(this.outDir, 'summary.md'), summary + '\n');
  }

  printsToStdio() {
    return false;
  }
}

const rank: Record<Status, number> = { Fail: 4, Pass: 3, Skipped: 2, NA: 1, 'Not Run': 0 };
const merge = (a: Status, b: Status): Status => (rank[a] >= rank[b] ? a : b);
const pad = (n: number) => String(n).padStart(2, '0');
const firstLine = (s: string) =>
  s
    .replace(/\x1b\[[0-9;]*m/g, '')
    .split('\n')[0]
    .slice(0, 200);
const csvCell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
