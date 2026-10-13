// Used by `playwright merge-reports` in CI to combine the per-stage blob reports into one set of reports.
export default {
  testDir: './tests',
  reporter: [
    ['html', { outputFolder: 'reports/html', open: 'never' }],
    ['junit', { outputFile: 'reports/junit.xml' }],
    ['./src/reporting/traceability-reporter.ts', { outputDir: 'reports' }],
  ],
};
