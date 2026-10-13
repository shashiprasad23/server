'use strict';

// Bundles the UI, the shared report code and the browser backend into one
// self-contained HTML file that can be published as a claude.ai Artifact
// (a hosted page with no server; data lives in the page's shared store).
//
// Usage: npm run build:artifact   ->  dist/resource-pool.html

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const html = read('public/index.html');
const body = html.match(/<body>([\s\S]*?)<script src="app\.js"><\/script>/);
if (!body) throw new Error('Could not find the page body in public/index.html');

const scripts = [
  'src/shared/capacity.js',
  'src/shared/reports.js',
  'public/browser-backend.js',
].map(read);
scripts.push('window.RP_BACKEND = window.RPBrowserBackend.create();');
scripts.push(read('public/app.js'));

for (const s of scripts) {
  if (/<\/script/i.test(s)) throw new Error('Inlined script contains "</script", which would end the tag early');
}

// The Artifact publisher supplies <!doctype>, <head> and <body>, so the page starts at <title>.
const out = [
  '<title>Resource Pool</title>',
  `<style>\n${read('public/styles.css')}</style>`,
  body[1].trim(),
  ...scripts.map((s) => `<script>\n${s}\n</script>`),
  '',
].join('\n');

const dest = path.join(root, 'dist', 'resource-pool.html');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, out);
console.log(`Wrote ${path.relative(root, dest)} (${Math.round(out.length / 1024)} KB)`);
