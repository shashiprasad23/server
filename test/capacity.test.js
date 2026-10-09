'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { workingDays, unavailableDays, personSprintCapacity } = require('../src/capacity');

// 2026-10-05 is a Monday; a two-week sprint runs Mon 5th -> Fri 16th.
const sprint = { start_date: '2026-10-05', end_date: '2026-10-16' };

test('workingDays skips weekends and holidays', () => {
  assert.equal(workingDays(sprint.start_date, sprint.end_date).length, 10);
  assert.equal(workingDays(sprint.start_date, sprint.end_date, ['2026-10-07', '2026-10-10']).length, 9); // 10th is a Saturday
  assert.deepEqual(workingDays('2026-10-10', '2026-10-11'), []);
});

test('unavailableDays clips to the sprint and ignores weekends', () => {
  const working = workingDays(sprint.start_date, sprint.end_date);
  const { days, byType } = unavailableDays(working, [
    { start_date: '2026-10-01', end_date: '2026-10-06', type: 'leave', portion: 1 }, // only 5th & 6th fall in sprint
    { start_date: '2026-10-09', end_date: '2026-10-12', type: 'training', portion: 1 }, // Fri + Mon (weekend skipped)
  ]);
  assert.equal(days, 4);
  assert.deepEqual(byType, { leave: 2, training: 2 });
});

test('overlapping entries count once, with the larger portion', () => {
  const working = workingDays(sprint.start_date, sprint.end_date);
  const { days } = unavailableDays(working, [
    { start_date: '2026-10-05', end_date: '2026-10-06', type: 'training', portion: 0.5 },
    { start_date: '2026-10-06', end_date: '2026-10-06', type: 'sick', portion: 1 },
  ]);
  assert.equal(days, 1.5);
});

test('personSprintCapacity computes hours and status', () => {
  const person = { hours_per_day: 8 };
  const cap = personSprintCapacity({
    sprint,
    person,
    holidays: ['2026-10-07'],
    unavailability: [{ start_date: '2026-10-12', end_date: '2026-10-12', type: 'leave', portion: 1 }],
    allocations: [{ allocation_pct: 60 }, { allocation_pct: 50 }],
  });
  assert.equal(cap.workingDays, 9);
  assert.equal(cap.unavailableDays, 1);
  assert.equal(cap.availableDays, 8);
  assert.equal(cap.grossHours, 72);
  assert.equal(cap.capacityHours, 64);
  assert.equal(cap.allocatedPct, 110);
  assert.equal(cap.allocatedHours, 70.4);
  assert.equal(cap.freeHours, 0);
  assert.equal(cap.status, 'over');
});

test('status values', () => {
  const base = { sprint, person: { hours_per_day: 8 }, holidays: [], unavailability: [] };
  assert.equal(personSprintCapacity({ ...base, allocations: [] }).status, 'unassigned');
  assert.equal(personSprintCapacity({ ...base, allocations: [{ allocation_pct: 40 }] }).status, 'under');
  assert.equal(personSprintCapacity({ ...base, allocations: [{ allocation_pct: 40 }, { allocation_pct: 60 }] }).status, 'full');
});
