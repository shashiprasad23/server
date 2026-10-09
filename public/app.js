'use strict';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const $ = (sel, root = document) => root.querySelector(sel);
const view = $('#view');

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

let toastTimer;
function toast(msg, isError = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = isError ? 'error' : '';
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3000);
}

const fmt = (n) => (Math.round(n * 10) / 10).toLocaleString();
const fmtDate = (iso) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const fmtRange = (a, b) => (a === b ? fmtDate(a) : `${fmtDate(a)} – ${fmtDate(b)}`);
const todayIso = () => new Date().toISOString().slice(0, 10);

const STATUS_LABEL = { over: 'Over-allocated', full: 'Fully allocated', under: 'Has free capacity', unassigned: 'Unassigned' };
const LEAVE_TYPES = ['leave', 'sick', 'training', 'travel', 'other'];
const PROJECT_STATUS = { active: 'Active', on_hold: 'On hold', completed: 'Completed' };

function store(key, val) {
  try {
    if (val === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, val);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Shared data
// ---------------------------------------------------------------------------

const cache = { people: [], projects: [], sprints: [] };

async function refreshCache() {
  [cache.people, cache.projects, cache.sprints] = await Promise.all([
    api('GET', '/api/people'),
    api('GET', '/api/projects'),
    api('GET', '/api/sprints'),
  ]);
}

function defaultSprintId() {
  const saved = Number(store('sprintId'));
  if (cache.sprints.some((s) => s.id === saved)) return saved;
  const today = todayIso();
  const current = cache.sprints.find((s) => s.start_date <= today && s.end_date >= today);
  return (current || cache.sprints[0])?.id;
}

function sprintSelect(selectedId) {
  return `<select id="sprint-select" aria-label="Sprint">${cache.sprints
    .map((s) => `<option value="${s.id}" ${s.id === selectedId ? 'selected' : ''}>${esc(s.name)} (${fmtRange(s.start_date, s.end_date)})</option>`)
    .join('')}</select>`;
}

function bindSprintSelect(rerender) {
  $('#sprint-select')?.addEventListener('change', (e) => {
    store('sprintId', e.target.value);
    rerender();
  });
}

function noSprints() {
  view.innerHTML = `<div class="card empty">No sprints yet. <a href="#sprints">Create your first sprint</a> to start planning.</div>`;
}

// ---------------------------------------------------------------------------
// Modal form
// ---------------------------------------------------------------------------

/**
 * fields: [{ name, label, type, options, required, step, min, max, half }]
 * Resolves with the submitted values, or null on cancel.
 * onSubmit(values) may throw to keep the dialog open and show an error.
 */
function openForm(title, fields, initial = {}, onSubmit) {
  const modal = $('#modal');
  $('#modal-title').textContent = title;
  $('#modal-error').hidden = true;

  const renderField = (f) => {
    const val = initial[f.name] ?? f.default ?? '';
    const req = f.required ? 'required' : '';
    let input;
    if (f.type === 'select') {
      input = `<select name="${f.name}" ${req}>${f.required ? '' : '<option value=""></option>'}${f.options
        .map((o) => `<option value="${esc(o.value)}" ${String(o.value) === String(val) ? 'selected' : ''}>${esc(o.label)}</option>`)
        .join('')}</select>`;
    } else if (f.type === 'textarea') {
      input = `<textarea name="${f.name}" ${req}>${esc(val)}</textarea>`;
    } else if (f.type === 'checkbox') {
      return `<div class="field inline"><input type="checkbox" id="f-${f.name}" name="${f.name}" ${val ? 'checked' : ''}><label for="f-${f.name}">${esc(f.label)}</label></div>`;
    } else {
      const extra = [f.step && `step="${f.step}"`, f.min !== undefined && `min="${f.min}"`, f.max !== undefined && `max="${f.max}"`].filter(Boolean).join(' ');
      input = `<input type="${f.type || 'text'}" name="${f.name}" value="${esc(val)}" ${req} ${extra}>`;
    }
    return `<div class="field"><label>${esc(f.label)}${f.required ? ' *' : ''}</label>${input}</div>`;
  };

  // Group consecutive `half` fields into two-column rows.
  let html = '';
  for (let i = 0; i < fields.length; i++) {
    if (fields[i].half && fields[i + 1]?.half) {
      html += `<div class="row-2">${renderField(fields[i])}${renderField(fields[i + 1])}</div>`;
      i++;
    } else html += renderField(fields[i]);
  }
  $('#modal-body').innerHTML = html;

  return new Promise((resolve) => {
    const form = $('#modal-form');
    const cleanup = () => {
      form.onsubmit = null;
      $('#modal-cancel').onclick = null;
      modal.onclose = null;
    };
    form.onsubmit = async (e) => {
      e.preventDefault();
      const values = {};
      for (const f of fields) {
        const el = form.elements[f.name];
        if (f.type === 'checkbox') values[f.name] = el.checked;
        else if (f.type === 'number') values[f.name] = el.value === '' ? null : Number(el.value);
        else values[f.name] = el.value === '' ? null : el.value;
      }
      try {
        if (onSubmit) await onSubmit(values);
        cleanup();
        modal.close();
        resolve(values);
      } catch (err) {
        $('#modal-error').textContent = err.message;
        $('#modal-error').hidden = false;
      }
    };
    $('#modal-cancel').onclick = () => modal.close();
    modal.onclose = () => {
      cleanup();
      resolve(null);
    };
    modal.showModal();
  });
}

async function confirmDelete(what, url, after) {
  if (!confirm(`Delete ${what}? This cannot be undone.`)) return;
  try {
    await api('DELETE', url);
    toast('Deleted');
    await after();
  } catch (err) {
    toast(err.message, true);
  }
}

// ---------------------------------------------------------------------------
// Rendering bits
// ---------------------------------------------------------------------------

function allocationBar(p) {
  const scale = Math.max(100, p.allocatedPct);
  const segs = p.allocations
    .map((a) => `<span style="width:${(a.allocation_pct / scale) * 100}%;background:${esc(a.project_color)}" title="${esc(a.project_name)}: ${a.allocation_pct}% (${fmt(a.hours)} h)"></span>`)
    .join('');
  return `<div class="bar ${p.status === 'over' ? 'over' : ''}">${segs}</div>`;
}

function leaveChips(list) {
  return list
    .map((u) => `<span class="chip" title="${esc(u.notes || '')}">${esc(u.type)}${u.portion === 0.5 ? ' (½ day)' : ''}: ${fmtRange(u.start_date, u.end_date)}</span>`)
    .join('');
}

const statusBadge = (s) => `<span class="badge ${s}">${STATUS_LABEL[s]}</span>`;

// ---------------------------------------------------------------------------
// View: sprint board
// ---------------------------------------------------------------------------

async function renderBoard() {
  if (!cache.sprints.length) return noSprints();
  const sprintId = defaultSprintId();
  const s = await api('GET', `/api/sprints/${sprintId}/summary`);
  const onLeave = s.people.filter((p) => p.unavailableDays > 0);

  view.innerHTML = `
    <div class="toolbar">
      <h1>Sprint board</h1>
      ${sprintSelect(sprintId)}
      <span class="spacer"></span>
      <a class="btn" href="/api/sprints/${sprintId}/export.csv">Export CSV</a>
      <a class="btn primary" href="#plan">Edit allocations</a>
    </div>
    ${s.sprint.goal ? `<p class="muted">Goal: ${esc(s.sprint.goal)}</p>` : ''}
    ${s.holidays.length ? `<p class="muted small">Holidays in this sprint: ${s.holidays.map((h) => `${esc(h.name)} (${fmtDate(h.date)})`).join(', ')}</p>` : ''}

    <div class="kpis">
      <div class="kpi"><div class="label">People</div><div class="value">${s.totals.people}</div></div>
      <div class="kpi"><div class="label">Available capacity</div><div class="value">${fmt(s.totals.capacityHours)} h</div></div>
      <div class="kpi"><div class="label">Allocated</div><div class="value">${fmt(s.totals.allocatedHours)} h</div></div>
      <div class="kpi"><div class="label">Utilisation</div><div class="value">${fmt(s.totals.utilisationPct)}%</div></div>
      <div class="kpi"><div class="label">Days unavailable</div><div class="value">${fmt(s.totals.unavailableDays)}</div></div>
      <div class="kpi ${s.totals.overAllocated ? 'bad' : ''}"><div class="label">Over-allocated</div><div class="value">${s.totals.overAllocated}</div></div>
    </div>

    <div class="grid-2">
      <div class="card">
        <h2>Who is working on what</h2>
        <div class="table-wrap"><table>
          <thead><tr>
            <th>Person</th><th>Projects</th><th>Allocation</th>
            <th class="num">Total</th><th class="num">Avail. days</th><th class="num">Hours</th><th>Status</th>
          </tr></thead>
          <tbody>
          ${s.people.map((p) => `
            <tr>
              <td class="name"><a href="#person/${p.person.id}">${esc(p.person.name)}</a><div class="muted small">${esc(p.person.role || '')}</div></td>
              <td>${p.allocations.map((a) => `<span class="chip"><span class="dot" style="background:${esc(a.project_color)}"></span>${esc(a.project_name)} ${a.allocation_pct}%</span>`).join('') || '<span class="muted">—</span>'}
                ${p.unavailability.length ? `<div>${leaveChips(p.unavailability)}</div>` : ''}</td>
              <td>${allocationBar(p)}</td>
              <td class="num">${fmt(p.allocatedPct)}%</td>
              <td class="num" title="${p.workingDays} working days, ${fmt(p.unavailableDays)} unavailable">${fmt(p.availableDays)} / ${p.workingDays}</td>
              <td class="num" title="Allocated / available hours">${fmt(p.allocatedHours)} / ${fmt(p.capacityHours)}</td>
              <td>${statusBadge(p.status)}</td>
            </tr>`).join('') || `<tr><td colspan="7" class="empty">No active people. <a href="#people">Add people</a>.</td></tr>`}
          </tbody>
        </table></div>
      </div>

      <div>
        <div class="card">
          <h2>Projects this sprint</h2>
          ${s.projects.length ? `<table>
            <thead><tr><th>Project</th><th class="num">FTE</th><th class="num">Hours</th></tr></thead>
            <tbody>${s.projects.map((p) => `
              <tr>
                <td><span class="dot" style="background:${esc(p.color)}"></span> <a href="#project/${p.project_id}">${esc(p.name)}</a>
                  <div class="muted small">${p.people.map((x) => `${esc(x.name)} ${x.allocation_pct}%`).join(', ')}</div></td>
                <td class="num">${fmt(p.fte)}</td>
                <td class="num">${fmt(p.hours)}</td>
              </tr>`).join('')}</tbody>
          </table>` : '<p class="muted">No allocations yet.</p>'}
        </div>
        <div class="card">
          <h2>Unavailable during sprint</h2>
          ${onLeave.length ? `<table><tbody>${onLeave.map((p) => `
            <tr><td>${esc(p.person.name)}<div>${leaveChips(p.unavailability)}</div></td>
            <td class="num">${fmt(p.unavailableDays)} d</td></tr>`).join('')}</tbody></table>`
            : '<p class="muted">Everyone is available for the whole sprint.</p>'}
        </div>
      </div>
    </div>`;
  bindSprintSelect(renderBoard);
}

// ---------------------------------------------------------------------------
// View: allocation planner (people × projects matrix)
// ---------------------------------------------------------------------------

async function renderPlan() {
  if (!cache.sprints.length) return noSprints();
  const sprintId = defaultSprintId();
  const s = await api('GET', `/api/sprints/${sprintId}/summary`);
  const allocatedProjectIds = new Set(s.projects.map((p) => p.project_id));
  const projects = cache.projects.filter((p) => p.status === 'active' || allocatedProjectIds.has(p.id));
  const others = cache.sprints.filter((x) => x.id !== sprintId);

  view.innerHTML = `
    <div class="toolbar">
      <h1>Allocation planner</h1>
      ${sprintSelect(sprintId)}
      <span class="spacer"></span>
      ${others.length ? `<select id="copy-from" aria-label="Copy from sprint"><option value="">Copy allocations from…</option>
        ${others.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select>` : ''}
    </div>
    <p class="muted small">Enter the % of each person's <em>available</em> time (after leave and holidays) they spend on each project. Changes save automatically; clear a cell to remove the allocation.</p>
    <div class="card table-wrap">
      ${!projects.length || !s.people.length ? `<div class="empty">You need at least one active person and one active project. <a href="#people">People</a> · <a href="#projects">Projects</a></div>` : `
      <table class="matrix">
        <thead><tr>
          <th>Person</th><th class="num">Avail. h</th>
          ${projects.map((p) => `<th><span class="dot" style="background:${esc(p.color)}"></span> ${esc(p.code || p.name)}</th>`).join('')}
          <th>Total</th>
        </tr></thead>
        <tbody>
          ${s.people.map((p) => `
            <tr data-person="${p.person.id}">
              <td>${esc(p.person.name)}${p.unavailableDays ? `<div class="muted small">${fmt(p.unavailableDays)} d off</div>` : ''}</td>
              <td class="num">${fmt(p.capacityHours)}</td>
              ${projects.map((proj) => {
                const a = p.allocations.find((x) => x.project_id === proj.id);
                return `<td><input type="number" min="0" max="100" step="5" inputmode="decimal"
                  data-project="${proj.id}" data-alloc="${a ? a.id : ''}" value="${a ? a.allocation_pct : ''}"
                  class="${a ? 'has-value' : ''}" aria-label="${esc(p.person.name)} on ${esc(proj.name)}"></td>`;
              }).join('')}
              <td class="total ${p.status}">${fmt(p.allocatedPct)}%</td>
            </tr>`).join('')}
        </tbody>
      </table>`}
    </div>`;

  bindSprintSelect(renderPlan);

  $('#copy-from')?.addEventListener('change', async (e) => {
    if (!e.target.value) return;
    try {
      const r = await api('POST', `/api/sprints/${sprintId}/copy-allocations`, { from_sprint_id: Number(e.target.value) });
      toast(`Copied ${r.copied} allocation${r.copied === 1 ? '' : 's'}`);
      renderPlan();
    } catch (err) {
      toast(err.message, true);
    }
  });

  view.querySelectorAll('.matrix input').forEach((input) => {
    input.addEventListener('change', async () => {
      const personId = Number(input.closest('tr').dataset.person);
      const projectId = Number(input.dataset.project);
      const allocId = input.dataset.alloc;
      const pct = input.value === '' ? 0 : Number(input.value);
      try {
        if (pct <= 0 && allocId) await api('DELETE', `/api/allocations/${allocId}`);
        else if (pct > 0 && allocId) await api('PUT', `/api/allocations/${allocId}`, { allocation_pct: pct });
        else if (pct > 0) await api('POST', '/api/allocations', { person_id: personId, project_id: projectId, sprint_id: sprintId, allocation_pct: pct });
        await renderPlan();
        // Keep keyboard focus on the cell the user was editing.
        view.querySelector(`tr[data-person="${personId}"] input[data-project="${projectId}"]`)?.focus();
      } catch (err) {
        toast(err.message, true);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// View: unavailability
// ---------------------------------------------------------------------------

function leaveFields() {
  return [
    { name: 'person_id', label: 'Person', type: 'select', required: true, options: cache.people.filter((p) => p.active).map((p) => ({ value: p.id, label: p.name })) },
    { name: 'start_date', label: 'From', type: 'date', required: true, half: true, default: todayIso() },
    { name: 'end_date', label: 'To', type: 'date', required: true, half: true, default: todayIso() },
    { name: 'type', label: 'Type', type: 'select', required: true, options: LEAVE_TYPES.map((t) => ({ value: t, label: t[0].toUpperCase() + t.slice(1) })) },
    { name: 'half_day', label: 'Half days only (counts 0.5 per day)', type: 'checkbox' },
    { name: 'notes', label: 'Notes', type: 'textarea' },
  ];
}

const leavePayload = (v) => ({ ...v, person_id: Number(v.person_id), portion: v.half_day ? 0.5 : 1, half_day: undefined });

async function renderLeave() {
  const filter = store('leavePerson') || '';
  const rows = await api('GET', `/api/unavailability${filter ? `?person_id=${filter}` : ''}`);
  const personName = Object.fromEntries(cache.people.map((p) => [p.id, p.name]));
  const today = todayIso();

  view.innerHTML = `
    <div class="toolbar">
      <h1>Unavailability</h1>
      <select id="leave-filter" aria-label="Filter by person"><option value="">Everyone</option>
        ${cache.people.map((p) => `<option value="${p.id}" ${String(p.id) === filter ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
      <span class="spacer"></span>
      <button class="btn primary" id="add-leave">Add unavailability</button>
    </div>
    <p class="muted small">Leave, sickness, training or travel reduces a person's available hours in any sprint it overlaps. Weekends and public holidays are already excluded.</p>
    <div class="card table-wrap">
      ${rows.length ? `<table>
        <thead><tr><th>Person</th><th>Dates</th><th>Type</th><th>Notes</th><th></th></tr></thead>
        <tbody>${rows.map((u) => `
          <tr class="${u.end_date < today ? 'muted' : ''}">
            <td>${esc(personName[u.person_id])}</td>
            <td>${fmtRange(u.start_date, u.end_date)}${u.portion === 0.5 ? ' <span class="chip">½ days</span>' : ''}</td>
            <td><span class="chip">${esc(u.type)}</span></td>
            <td>${esc(u.notes || '')}</td>
            <td class="num"><button class="btn sm" data-edit="${u.id}">Edit</button> <button class="btn sm danger" data-del="${u.id}">Delete</button></td>
          </tr>`).join('')}</tbody>
      </table>` : '<div class="empty">No unavailability recorded.</div>'}
    </div>`;

  $('#leave-filter').addEventListener('change', (e) => {
    store('leavePerson', e.target.value);
    renderLeave();
  });
  $('#add-leave').addEventListener('click', async () => {
    const init = filter ? { person_id: filter } : {};
    const ok = await openForm('Add unavailability', leaveFields(), init, (v) => api('POST', '/api/unavailability', leavePayload(v)));
    if (ok) renderLeave();
  });
  view.querySelectorAll('[data-edit]').forEach((b) =>
    b.addEventListener('click', async () => {
      const u = rows.find((r) => r.id === Number(b.dataset.edit));
      const ok = await openForm('Edit unavailability', leaveFields(), { ...u, half_day: u.portion === 0.5 }, (v) => api('PUT', `/api/unavailability/${u.id}`, leavePayload(v)));
      if (ok) renderLeave();
    }),
  );
  view.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', () => confirmDelete('this entry', `/api/unavailability/${b.dataset.del}`, renderLeave)),
  );
}

// ---------------------------------------------------------------------------
// Generic CRUD list (people, projects, sprints, holidays)
// ---------------------------------------------------------------------------

async function crudSection({ title, endpoint, columns, fields, toPayload = (v) => v, rows, addLabel }) {
  const id = endpoint.replace(/\W/g, '');
  const html = `
    <div class="card">
      <div class="toolbar"><h2 style="margin:0">${esc(title)}</h2><span class="spacer"></span>
        <button class="btn primary" data-add="${id}">${esc(addLabel)}</button></div>
      <div class="table-wrap">${rows.length ? `<table>
        <thead><tr>${columns.map((c) => `<th class="${c.num ? 'num' : ''}">${esc(c.label)}</th>`).join('')}<th></th></tr></thead>
        <tbody>${rows.map((r) => `<tr>${columns.map((c) => `<td class="${c.num ? 'num' : ''}">${c.render ? c.render(r) : esc(r[c.key] ?? '')}</td>`).join('')}
          <td class="num" style="white-space:nowrap"><button class="btn sm" data-edit-${id}="${r.id}">Edit</button> <button class="btn sm danger" data-del-${id}="${r.id}">Delete</button></td></tr>`).join('')}</tbody>
      </table>` : '<div class="empty">Nothing here yet.</div>'}</div>
    </div>`;

  const bind = (rerender) => {
    view.querySelector(`[data-add="${id}"]`).addEventListener('click', async () => {
      const ok = await openForm(addLabel, fields(), {}, (v) => api('POST', endpoint, toPayload(v)));
      if (ok) {
        await refreshCache();
        rerender();
      }
    });
    view.querySelectorAll(`[data-edit-${id}]`).forEach((b) =>
      b.addEventListener('click', async () => {
        const row = rows.find((r) => r.id === Number(b.getAttribute(`data-edit-${id}`)));
        const ok = await openForm(`Edit ${title.toLowerCase().replace(/s$/, '')}`, fields(), row, (v) => api('PUT', `${endpoint}/${row.id}`, toPayload(v)));
        if (ok) {
          await refreshCache();
          rerender();
        }
      }),
    );
    view.querySelectorAll(`[data-del-${id}]`).forEach((b) =>
      b.addEventListener('click', () =>
        confirmDelete('this record (related allocations and leave are removed too)', `${endpoint}/${b.getAttribute(`data-del-${id}`)}`, async () => {
          await refreshCache();
          rerender();
        }),
      ),
    );
  };
  return { html, bind };
}

async function renderPeople() {
  const section = await crudSection({
    title: 'People',
    endpoint: '/api/people',
    addLabel: 'Add person',
    rows: cache.people,
    columns: [
      { label: 'Name', render: (r) => `<a href="#person/${r.id}">${esc(r.name)}</a>${r.active ? '' : ' <span class="badge completed">Inactive</span>'}` },
      { label: 'Role', key: 'role' },
      { label: 'Team', key: 'team' },
      { label: 'Email', key: 'email' },
      { label: 'Hours/day', key: 'hours_per_day', num: true },
    ],
    fields: () => [
      { name: 'name', label: 'Name', required: true },
      { name: 'role', label: 'Role', half: true },
      { name: 'team', label: 'Team', half: true },
      { name: 'email', label: 'Email', type: 'email' },
      { name: 'hours_per_day', label: 'Working hours per day', type: 'number', step: '0.5', min: 0.5, max: 24, default: 8 },
      { name: 'active', label: 'Active (shown in sprint planning)', type: 'checkbox', default: true },
    ],
  });
  view.innerHTML = `<div class="toolbar"><h1>People</h1></div>${section.html}`;
  section.bind(renderPeople);
}

async function renderProjects() {
  const section = await crudSection({
    title: 'Projects',
    endpoint: '/api/projects',
    addLabel: 'Add project',
    rows: cache.projects,
    columns: [
      { label: 'Project', render: (r) => `<span class="dot" style="background:${esc(r.color)}"></span> <a href="#project/${r.id}">${esc(r.name)}</a>` },
      { label: 'Code', key: 'code' },
      { label: 'Owner', key: 'owner' },
      { label: 'Status', render: (r) => `<span class="badge ${r.status}">${PROJECT_STATUS[r.status]}</span>` },
    ],
    fields: () => [
      { name: 'name', label: 'Name', required: true },
      { name: 'code', label: 'Short code', half: true },
      { name: 'color', label: 'Colour', type: 'color', half: true, default: '#4f46e5' },
      { name: 'owner', label: 'Owner' },
      { name: 'status', label: 'Status', type: 'select', required: true, options: Object.entries(PROJECT_STATUS).map(([value, label]) => ({ value, label })) },
    ],
  });
  view.innerHTML = `<div class="toolbar"><h1>Projects</h1></div>${section.html}`;
  section.bind(renderProjects);
}

async function renderSprints() {
  const holidays = await api('GET', '/api/holidays');
  const sprintSection = await crudSection({
    title: 'Sprints',
    endpoint: '/api/sprints',
    addLabel: 'Add sprint',
    rows: cache.sprints,
    columns: [
      { label: 'Sprint', key: 'name' },
      { label: 'Dates', render: (r) => fmtRange(r.start_date, r.end_date) },
      { label: 'Goal', key: 'goal' },
    ],
    fields: () => {
      // Suggest the next sprint: same length as the latest one, starting the next Monday.
      const last = cache.sprints[0];
      let start = todayIso();
      let end = todayIso();
      if (last) {
        const lastEnd = new Date(`${last.end_date}T00:00:00Z`);
        const len = (lastEnd - new Date(`${last.start_date}T00:00:00Z`)) / 86400000;
        const next = new Date(lastEnd);
        do next.setUTCDate(next.getUTCDate() + 1); while (next.getUTCDay() !== 1);
        start = next.toISOString().slice(0, 10);
        end = new Date(next.getTime() + len * 86400000).toISOString().slice(0, 10);
      }
      return [
        { name: 'name', label: 'Name', required: true, default: `Sprint ${cache.sprints.length + 1}` },
        { name: 'start_date', label: 'Start', type: 'date', required: true, half: true, default: start },
        { name: 'end_date', label: 'End', type: 'date', required: true, half: true, default: end },
        { name: 'goal', label: 'Sprint goal', type: 'textarea' },
      ];
    },
  });
  const holidaySection = await crudSection({
    title: 'Public holidays',
    endpoint: '/api/holidays',
    addLabel: 'Add holiday',
    rows: holidays,
    columns: [
      { label: 'Date', render: (r) => fmtDate(r.date) },
      { label: 'Name', key: 'name' },
    ],
    fields: () => [
      { name: 'date', label: 'Date', type: 'date', required: true, default: todayIso() },
      { name: 'name', label: 'Name', required: true },
    ],
  });
  view.innerHTML = `
    <div class="toolbar"><h1>Sprints &amp; holidays</h1></div>
    <p class="muted small">Public holidays apply to everyone and are excluded from working days, just like weekends.</p>
    ${sprintSection.html}${holidaySection.html}`;
  sprintSection.bind(renderSprints);
  holidaySection.bind(renderSprints);
}

// ---------------------------------------------------------------------------
// Detail views
// ---------------------------------------------------------------------------

async function renderPerson(id) {
  const { person, timeline } = await api('GET', `/api/people/${id}/timeline`);
  view.innerHTML = `
    <div class="toolbar"><a class="btn ghost" href="#board">← Back</a><h1>${esc(person.name)}</h1>
      <span class="muted">${esc([person.role, person.team].filter(Boolean).join(' · '))} · ${person.hours_per_day} h/day</span></div>
    <div class="card table-wrap">
      ${timeline.length ? `<table>
        <thead><tr><th>Sprint</th><th>Projects</th><th>Allocation</th><th class="num">Total</th><th class="num">Avail. days</th><th class="num">Hours</th><th>Unavailability</th><th>Status</th></tr></thead>
        <tbody>${[...timeline].reverse().map((t) => `
          <tr class="timeline-row">
            <td>${esc(t.sprint.name)}<div class="muted small">${fmtRange(t.sprint.start_date, t.sprint.end_date)}</div></td>
            <td>${t.allocations.map((a) => `<span class="chip"><span class="dot" style="background:${esc(a.project_color)}"></span>${esc(a.project_name)} ${a.allocation_pct}%</span>`).join('') || '<span class="muted">—</span>'}</td>
            <td>${allocationBar(t)}</td>
            <td class="num">${fmt(t.allocatedPct)}%</td>
            <td class="num">${fmt(t.availableDays)} / ${t.workingDays}</td>
            <td class="num">${fmt(t.allocatedHours)} / ${fmt(t.capacityHours)}</td>
            <td>${leaveChips(t.unavailability) || '<span class="muted">—</span>'}</td>
            <td>${statusBadge(t.status)}</td>
          </tr>`).join('')}</tbody>
      </table>` : '<div class="empty">No sprints yet.</div>'}
    </div>`;
}

async function renderProject(id) {
  const { project, timeline } = await api('GET', `/api/projects/${id}/timeline`);
  view.innerHTML = `
    <div class="toolbar"><a class="btn ghost" href="#projects">← Back</a>
      <h1><span class="dot" style="background:${esc(project.color)}"></span> ${esc(project.name)}</h1>
      <span class="badge ${project.status}">${PROJECT_STATUS[project.status]}</span>
      ${project.owner ? `<span class="muted">Owner: ${esc(project.owner)}</span>` : ''}</div>
    <div class="card table-wrap">
      ${timeline.length ? `<table>
        <thead><tr><th>Sprint</th><th>People</th><th class="num">FTE</th><th class="num">Hours</th></tr></thead>
        <tbody>${[...timeline].reverse().map((t) => `
          <tr class="timeline-row">
            <td>${esc(t.sprint.name)}<div class="muted small">${fmtRange(t.sprint.start_date, t.sprint.end_date)}</div></td>
            <td>${t.people.map((p) => `<span class="chip"><a href="#person/${p.id}">${esc(p.name)}</a> ${p.allocation_pct}% · ${fmt(p.hours)} h</span>`).join('')}</td>
            <td class="num">${fmt(t.fte)}</td>
            <td class="num">${fmt(t.hours)}</td>
          </tr>`).join('')}</tbody>
      </table>` : '<div class="empty">Nobody has been allocated to this project yet.</div>'}
    </div>`;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const routes = {
  board: renderBoard,
  plan: renderPlan,
  leave: renderLeave,
  people: renderPeople,
  projects: renderProjects,
  sprints: renderSprints,
  person: renderPerson,
  project: renderProject,
};

async function route() {
  const [name, arg] = (location.hash.slice(1) || 'board').split('/');
  const render = routes[name] || renderBoard;
  const navKey = { person: 'board', project: 'projects' }[name] || name;
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.view === navKey));
  try {
    await refreshCache();
    await render(arg);
  } catch (err) {
    view.innerHTML = `<div class="card empty">${esc(err.message)}</div>`;
  }
}

window.addEventListener('hashchange', route);
route();
