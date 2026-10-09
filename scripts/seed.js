'use strict';

// Loads demo data: 8 people, 5 projects, 4 two-week sprints, leave and holidays.
// Usage: npm run seed            (refuses if the database already has people)
//        npm run seed -- --force (wipes existing data first)

const path = require('node:path');
const { openDatabase } = require('../src/db');

const DB_FILE = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'resource-pool.db');
const force = process.argv.includes('--force');

const db = openDatabase(DB_FILE);
const count = db.prepare('SELECT COUNT(*) AS n FROM people').get().n;
if (count > 0 && !force) {
  console.error(`Database ${DB_FILE} already has data. Re-run with --force to wipe and reseed.`);
  process.exit(1);
}

db.exec('DELETE FROM allocations; DELETE FROM unavailability; DELETE FROM holidays; DELETE FROM sprints; DELETE FROM projects; DELETE FROM people;');

const insert = (table, row) => {
  const cols = Object.keys(row);
  return db
    .prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
    .run(...Object.values(row)).lastInsertRowid;
};

// Sprints: two weeks each, starting on the Monday of the current week minus 2 weeks.
const today = new Date();
const monday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7) - 14);
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);

const people = [
  { name: 'Asha Rao', role: 'Tech Lead', team: 'Platform', email: 'asha@example.com' },
  { name: 'Ben Carter', role: 'Backend Engineer', team: 'Platform', email: 'ben@example.com' },
  { name: 'Chen Wei', role: 'Frontend Engineer', team: 'Web', email: 'chen@example.com' },
  { name: 'Divya Menon', role: 'QA Engineer', team: 'Quality', email: 'divya@example.com' },
  { name: 'Elena Garcia', role: 'Designer', team: 'Web', email: 'elena@example.com', hours_per_day: 6 },
  { name: 'Farhan Ali', role: 'DevOps Engineer', team: 'Platform', email: 'farhan@example.com' },
  { name: 'Grace Kim', role: 'Data Engineer', team: 'Data', email: 'grace@example.com' },
  { name: 'Hiro Tanaka', role: 'Backend Engineer', team: 'Data', email: 'hiro@example.com' },
].map((p) => insert('people', p));

const projects = [
  { name: 'Customer Portal', code: 'CP', color: '#4f46e5', owner: 'Asha Rao' },
  { name: 'Billing Revamp', code: 'BILL', color: '#0891b2', owner: 'Ben Carter' },
  { name: 'Mobile App', code: 'MOB', color: '#db2777', owner: 'Chen Wei' },
  { name: 'Data Warehouse', code: 'DW', color: '#16a34a', owner: 'Grace Kim' },
  { name: 'Internal Tools', code: 'INT', color: '#ea580c', owner: 'Farhan Ali', status: 'on_hold' },
].map((p) => insert('projects', p));

const sprints = [];
for (let i = 0; i < 4; i++) {
  const start = addDays(monday, i * 14);
  sprints.push(
    insert('sprints', {
      name: `Sprint ${i + 1}`,
      start_date: iso(start),
      end_date: iso(addDays(start, 11)), // Mon -> Fri of the following week
      goal: ['Portal MVP', 'Billing beta', 'Mobile sign-up', 'Warehouse ingestion'][i],
    }),
  );
}

// [personIdx, projectIdx, pct] per sprint
const plan = [
  [0, 0, 60], [0, 1, 40],
  [1, 1, 100],
  [2, 0, 50], [2, 2, 50],
  [3, 0, 30], [3, 1, 30], [3, 2, 30],
  [4, 0, 50], [4, 2, 50],
  [5, 0, 20], [5, 3, 50], [5, 4, 30],
  [6, 3, 100],
  [7, 3, 60], [7, 1, 50], // Hiro is over-allocated
];
for (const sprintId of sprints) {
  for (const [pi, pj, pct] of plan) {
    insert('allocations', { person_id: people[pi], project_id: projects[pj], sprint_id: sprintId, allocation_pct: pct });
  }
}

insert('unavailability', { person_id: people[0], start_date: iso(addDays(monday, 15)), end_date: iso(addDays(monday, 18)), type: 'leave', notes: 'Family trip' });
insert('unavailability', { person_id: people[2], start_date: iso(addDays(monday, 16)), end_date: iso(addDays(monday, 16)), type: 'training', portion: 0.5, notes: 'React workshop' });
insert('unavailability', { person_id: people[3], start_date: iso(addDays(monday, 2)), end_date: iso(addDays(monday, 3)), type: 'sick' });
insert('unavailability', { person_id: people[6], start_date: iso(addDays(monday, 28)), end_date: iso(addDays(monday, 39)), type: 'leave', notes: 'Annual leave' });
insert('unavailability', { person_id: people[5], start_date: iso(addDays(monday, 21)), end_date: iso(addDays(monday, 22)), type: 'travel', notes: 'Client site visit' });

insert('holidays', { date: iso(addDays(monday, 18)), name: 'Company holiday' });

console.log(`Seeded ${people.length} people, ${projects.length} projects, ${sprints.length} sprints into ${DB_FILE}`);
