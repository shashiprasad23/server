'use strict';

// Pure capacity maths. Dates are ISO 'YYYY-MM-DD' strings and are handled in UTC
// so results never shift with the server's timezone.

const DAY_MS = 24 * 60 * 60 * 1000;

function parseDate(iso) {
  return new Date(`${iso}T00:00:00Z`);
}

function formatDate(d) {
  return d.toISOString().slice(0, 10);
}

function isWeekend(d) {
  const day = d.getUTCDay();
  return day === 0 || day === 6;
}

/** All dates in [start, end] inclusive. */
function eachDay(start, end) {
  const out = [];
  for (let t = parseDate(start).getTime(), last = parseDate(end).getTime(); t <= last; t += DAY_MS) {
    out.push(formatDate(new Date(t)));
  }
  return out;
}

/** Weekdays in [start, end] that are not public holidays. */
function workingDays(start, end, holidayDates = []) {
  const holidays = new Set(holidayDates);
  return eachDay(start, end).filter((d) => !isWeekend(parseDate(d)) && !holidays.has(d));
}

/**
 * Days a person is off within the given working days.
 * Overlapping entries on the same day count once, using the largest portion.
 * Returns { days, byType: { leave: n, ... } }.
 */
function unavailableDays(working, entries) {
  const workingSet = new Set(working);
  const perDay = new Map(); // date -> { portion, type }
  for (const e of entries) {
    for (const d of eachDay(e.start_date, e.end_date)) {
      if (!workingSet.has(d)) continue;
      const prev = perDay.get(d);
      if (!prev || e.portion > prev.portion) perDay.set(d, { portion: e.portion, type: e.type });
    }
  }
  let days = 0;
  const byType = {};
  for (const { portion, type } of perDay.values()) {
    days += portion;
    byType[type] = (byType[type] || 0) + portion;
  }
  return { days, byType };
}

/**
 * Capacity of one person in one sprint.
 * allocations: [{ allocation_pct, ... }]
 */
function personSprintCapacity({ sprint, person, holidays, unavailability, allocations }) {
  const working = workingDays(sprint.start_date, sprint.end_date, holidays);
  const off = unavailableDays(working, unavailability);
  const availableDays = Math.max(0, working.length - off.days);
  const grossHours = working.length * person.hours_per_day;
  const capacityHours = availableDays * person.hours_per_day;
  const allocatedPct = allocations.reduce((sum, a) => sum + a.allocation_pct, 0);
  const allocatedHours = (allocatedPct / 100) * capacityHours;

  let status;
  if (allocatedPct > 100) status = 'over';
  else if (allocatedPct === 100) status = 'full';
  else if (allocatedPct === 0) status = 'unassigned';
  else status = 'under';

  return {
    workingDays: working.length,
    unavailableDays: off.days,
    unavailableByType: off.byType,
    availableDays,
    grossHours: round(grossHours),
    capacityHours: round(capacityHours),
    allocatedPct: round(allocatedPct),
    allocatedHours: round(allocatedHours),
    freeHours: round(Math.max(0, capacityHours - allocatedHours)),
    status,
  };
}

function round(n) {
  return Math.round(n * 100) / 100;
}

module.exports = { eachDay, workingDays, unavailableDays, personSprintCapacity, round };
