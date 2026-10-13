// Sprint, person and project reports built from plain rows. Shared by the Node
// server and the browser build (window.RPReports), so both compute identical numbers.
//
// `data` is { people, projects, sprints, allocations, unavailability, holidays },
// each an array of rows shaped like the database tables.
(function (factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./capacity'));
  else window.RPReports = factory(window.RPCapacity);
})(function (capacity) {
  'use strict';

  const { personSprintCapacity, round } = capacity;

  const byName = (a, b) => a.name.localeCompare(b.name);
  const byStart = (a, b) => a.start_date.localeCompare(b.start_date);
  const overlaps = (row, sprint) => row.start_date <= sprint.end_date && row.end_date >= sprint.start_date;

  function holidaysIn(data, sprint) {
    return data.holidays
      .filter((h) => h.date >= sprint.start_date && h.date <= sprint.end_date)
      .map((h) => ({ date: h.date, name: h.name }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  /** Full picture of one sprint: per-person capacity, allocations, leave; per-project totals. */
  function sprintSummary(data, sprint) {
    const projectsById = new Map(data.projects.map((p) => [p.id, p]));
    const holidays = holidaysIn(data, sprint);
    const holidayDates = holidays.map((h) => h.date);
    const allocations = data.allocations
      .filter((a) => a.sprint_id === sprint.id && projectsById.has(a.project_id))
      .map((a) => {
        const p = projectsById.get(a.project_id);
        return { ...a, project_name: p.name, project_code: p.code, project_color: p.color };
      });
    const leave = data.unavailability.filter((u) => overlaps(u, sprint)).sort(byStart);
    // Include inactive people only if they still hold allocations in this sprint.
    const allocatedIds = new Set(allocations.map((a) => a.person_id));
    const people = [...data.people].sort(byName).filter((p) => p.active || allocatedIds.has(p.id));

    const peopleOut = people.map((person) => {
      const mine = allocations.filter((a) => a.person_id === person.id);
      const myLeave = leave.filter((u) => u.person_id === person.id);
      const cap = personSprintCapacity({ sprint, person, holidays: holidayDates, unavailability: myLeave, allocations: mine });
      return {
        person: { id: person.id, name: person.name, role: person.role, team: person.team, hours_per_day: person.hours_per_day },
        ...cap,
        unavailability: myLeave,
        allocations: mine.map((a) => ({
          id: a.id,
          project_id: a.project_id,
          project_name: a.project_name,
          project_code: a.project_code,
          project_color: a.project_color,
          allocation_pct: a.allocation_pct,
          hours: round((a.allocation_pct / 100) * cap.capacityHours),
          notes: a.notes,
        })),
      };
    });

    const projectMap = new Map();
    for (const p of peopleOut) {
      for (const a of p.allocations) {
        if (!projectMap.has(a.project_id)) {
          projectMap.set(a.project_id, {
            project_id: a.project_id,
            name: a.project_name,
            code: a.project_code,
            color: a.project_color,
            hours: 0,
            fte: 0,
            people: [],
          });
        }
        const entry = projectMap.get(a.project_id);
        entry.hours += a.hours;
        entry.fte += a.allocation_pct / 100;
        entry.people.push({ id: p.person.id, name: p.person.name, allocation_pct: a.allocation_pct, hours: a.hours });
      }
    }
    const projects = [...projectMap.values()]
      .map((p) => ({ ...p, hours: round(p.hours), fte: round(p.fte) }))
      .sort((a, b) => b.hours - a.hours);

    const totals = peopleOut.reduce(
      (t, p) => {
        t.capacityHours += p.capacityHours;
        t.allocatedHours += Math.min(p.allocatedHours, p.capacityHours);
        t.unavailableDays += p.unavailableDays;
        if (p.status === 'over') t.overAllocated += 1;
        if (p.status === 'unassigned' || p.status === 'under') t.withFreeCapacity += 1;
        return t;
      },
      { capacityHours: 0, allocatedHours: 0, unavailableDays: 0, overAllocated: 0, withFreeCapacity: 0 },
    );
    totals.capacityHours = round(totals.capacityHours);
    totals.allocatedHours = round(totals.allocatedHours);
    totals.utilisationPct = totals.capacityHours ? round((totals.allocatedHours / totals.capacityHours) * 100) : 0;
    totals.people = peopleOut.length;

    return { sprint, holidays, totals, people: peopleOut, projects };
  }

  /** A sprint summary as CSV, one row per person × project. */
  function sprintCsv(summary) {
    const rows = [['Person', 'Role', 'Team', 'Project', 'Allocation %', 'Hours', 'Available days', 'Unavailable days', 'Capacity hours', 'Total allocation %', 'Status']];
    for (const p of summary.people) {
      const base = [p.person.name, p.person.role || '', p.person.team || ''];
      const tail = [p.availableDays, p.unavailableDays, p.capacityHours, p.allocatedPct, p.status];
      if (!p.allocations.length) rows.push([...base, '', '', '', ...tail]);
      for (const a of p.allocations) rows.push([...base, a.project_name, a.allocation_pct, a.hours, ...tail]);
    }
    return {
      filename: `${summary.sprint.name.replace(/[^\w.-]+/g, '_')}.csv`,
      csv: rows.map((r) => r.map(csvCell).join(',')).join('\r\n'),
    };
  }

  function csvCell(val) {
    const s = String(val ?? '');
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  /** One person's allocations and leave across every sprint. */
  function personTimeline(data, person) {
    const projectsById = new Map(data.projects.map((p) => [p.id, p]));
    const leave = data.unavailability.filter((u) => u.person_id === person.id).sort(byStart);
    const allocations = data.allocations.filter((a) => a.person_id === person.id && projectsById.has(a.project_id));
    const timeline = [...data.sprints].sort(byStart).map((sprint) => {
      const mine = allocations.filter((a) => a.sprint_id === sprint.id);
      const myLeave = leave.filter((u) => overlaps(u, sprint));
      const holidayDates = holidaysIn(data, sprint).map((h) => h.date);
      const cap = personSprintCapacity({ sprint, person, holidays: holidayDates, unavailability: myLeave, allocations: mine });
      return {
        sprint,
        ...cap,
        unavailability: myLeave,
        allocations: mine.map((a) => {
          const p = projectsById.get(a.project_id);
          return {
            project_id: a.project_id,
            project_name: p.name,
            project_color: p.color,
            allocation_pct: a.allocation_pct,
            hours: round((a.allocation_pct / 100) * cap.capacityHours),
          };
        }),
      };
    });
    return { person, timeline };
  }

  /** Who worked on a project, sprint by sprint. */
  function projectTimeline(data, project) {
    const sprintIds = new Set(data.allocations.filter((a) => a.project_id === project.id).map((a) => a.sprint_id));
    const timeline = [...data.sprints]
      .sort(byStart)
      .filter((s) => sprintIds.has(s.id))
      .map((sprint) => {
        const entry = sprintSummary(data, sprint).projects.find((p) => p.project_id === project.id);
        return entry
          ? { sprint, hours: entry.hours, fte: entry.fte, people: entry.people }
          : { sprint, hours: 0, fte: 0, people: [] };
      });
    return { project, timeline };
  }

  return { sprintSummary, sprintCsv, personTimeline, projectTimeline };
});
