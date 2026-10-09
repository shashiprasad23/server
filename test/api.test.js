'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('../src/db');
const { createApp } = require('../src/app');

let server;
let base;

test.before(async () => {
  const app = createApp(openDatabase(':memory:'));
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => server.close());

async function call(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = text;
  try {
    data = JSON.parse(text);
  } catch {
    /* CSV or empty */
  }
  return { status: res.status, data };
}

test('end-to-end sprint planning flow', async () => {
  const alice = (await call('POST', '/api/people', { name: 'Alice', role: 'Engineer', hours_per_day: 8 })).data;
  const bob = (await call('POST', '/api/people', { name: 'Bob', hours_per_day: 6 })).data;
  const portal = (await call('POST', '/api/projects', { name: 'Portal', code: 'P', color: '#112233' })).data;
  const billing = (await call('POST', '/api/projects', { name: 'Billing' })).data;
  assert.equal(billing.color, '#4f46e5');
  assert.equal(billing.status, 'active');

  const s1 = (await call('POST', '/api/sprints', { name: 'S1', start_date: '2026-10-05', end_date: '2026-10-16' })).data;
  const s2 = (await call('POST', '/api/sprints', { name: 'S2', start_date: '2026-10-19', end_date: '2026-10-30' })).data;

  await call('POST', '/api/holidays', { date: '2026-10-07', name: 'Holiday' });
  await call('POST', '/api/unavailability', { person_id: alice.id, start_date: '2026-10-12', end_date: '2026-10-13', type: 'leave' });
  await call('POST', '/api/unavailability', { person_id: bob.id, start_date: '2026-10-14', end_date: '2026-10-14', type: 'training', portion: 0.5 });

  for (const [person, project, pct] of [[alice, portal, 70], [alice, billing, 50], [bob, portal, 100]]) {
    const r = await call('POST', '/api/allocations', { person_id: person.id, project_id: project.id, sprint_id: s1.id, allocation_pct: pct });
    assert.equal(r.status, 201);
  }

  const { data: summary } = await call('GET', `/api/sprints/${s1.id}/summary`);
  const a = summary.people.find((p) => p.person.id === alice.id);
  const b = summary.people.find((p) => p.person.id === bob.id);

  assert.equal(a.workingDays, 9);
  assert.equal(a.unavailableDays, 2);
  assert.equal(a.capacityHours, 56);
  assert.equal(a.allocatedPct, 120);
  assert.equal(a.status, 'over');
  assert.equal(a.allocations.find((x) => x.project_id === portal.id).hours, 39.2);

  assert.equal(b.unavailableDays, 0.5);
  assert.equal(b.capacityHours, 51);
  assert.equal(b.status, 'full');

  const portalSummary = summary.projects.find((p) => p.project_id === portal.id);
  assert.equal(portalSummary.fte, 1.7);
  assert.equal(portalSummary.hours, 90.2);
  assert.equal(summary.totals.overAllocated, 1);
  assert.equal(summary.holidays.length, 1);

  // Copy into the next sprint.
  const copy = await call('POST', `/api/sprints/${s2.id}/copy-allocations`, { from_sprint_id: s1.id });
  assert.equal(copy.data.copied, 3);
  const again = await call('POST', `/api/sprints/${s2.id}/copy-allocations`, { from_sprint_id: s1.id });
  assert.equal(again.data.copied, 0, 'copying twice does not duplicate');

  // Person timeline covers both sprints.
  const { data: tl } = await call('GET', `/api/people/${alice.id}/timeline`);
  assert.equal(tl.timeline.length, 2);
  assert.equal(tl.timeline[1].unavailableDays, 0);

  // Project timeline.
  const { data: ptl } = await call('GET', `/api/projects/${portal.id}/timeline`);
  assert.equal(ptl.timeline.length, 2);
  assert.equal(ptl.timeline[0].people.length, 2);

  // CSV export.
  const csv = await call('GET', `/api/sprints/${s1.id}/export.csv`);
  assert.equal(csv.status, 200);
  assert.match(csv.data, /^Person,Role,Team,Project/);
  assert.match(csv.data, /Alice,Engineer,,Portal,70,39.2/);

  // Deleting a person cascades to their allocations.
  await call('DELETE', `/api/people/${bob.id}`);
  const { data: remaining } = await call('GET', `/api/allocations?sprint_id=${s1.id}`);
  assert.equal(remaining.length, 2);
});

test('validation errors', async () => {
  const p = (await call('POST', '/api/people', { name: 'Val' })).data;
  const proj = (await call('POST', '/api/projects', { name: 'Proj' })).data;
  const s = (await call('POST', '/api/sprints', { name: 'S', start_date: '2026-11-02', end_date: '2026-11-13' })).data;

  assert.equal((await call('POST', '/api/people', {})).status, 400);
  assert.equal((await call('POST', '/api/sprints', { name: 'Bad', start_date: '2026-11-10', end_date: '2026-11-01' })).status, 400);
  assert.equal((await call('POST', '/api/sprints', { name: 'Bad', start_date: '10/11/2026', end_date: '2026-11-01' })).status, 400);
  assert.equal((await call('POST', '/api/projects', { name: 'X', status: 'nope' })).status, 400);
  assert.equal((await call('POST', '/api/unavailability', { person_id: p.id, start_date: '2026-11-02', end_date: '2026-11-02', portion: 0.25 })).status, 400);

  const alloc = { person_id: p.id, project_id: proj.id, sprint_id: s.id, allocation_pct: 50 };
  assert.equal((await call('POST', '/api/allocations', { ...alloc, allocation_pct: 150 })).status, 400);
  assert.equal((await call('POST', '/api/allocations', { ...alloc, allocation_pct: 0 })).status, 400);
  assert.equal((await call('POST', '/api/allocations', { ...alloc, person_id: 9999 })).status, 400);
  assert.equal((await call('POST', '/api/allocations', alloc)).status, 201);
  assert.equal((await call('POST', '/api/allocations', alloc)).status, 409);

  // Updates may not clear required fields or invert date ranges.
  assert.equal((await call('PUT', `/api/people/${p.id}`, { name: '' })).status, 400);
  assert.equal((await call('PUT', `/api/sprints/${s.id}`, { end_date: '2026-10-01' })).status, 400);
  assert.equal((await call('PUT', `/api/people/${p.id}`, { role: 'Lead' })).data.role, 'Lead');

  assert.equal((await call('GET', '/api/sprints/9999/summary')).status, 404);
  assert.equal((await call('GET', '/api/nope')).status, 404);
});
