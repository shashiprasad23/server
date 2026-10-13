'use strict';

// Serverless backend for the hosted (claude.ai Artifact) build of the app.
// It answers the same /api routes as src/app.js, computing reports with the
// shared modules, and keeps rows in the page's shared `db` store so every
// viewer sees the same data. Where no store is available (a saved copy of the
// page, a preview) it runs in memory and says that changes are not kept.
//
// Loaded after src/shared/capacity.js and src/shared/reports.js; see
// scripts/build-artifact.js.

window.RPBrowserBackend = (function () {
  const COLLECTIONS = ['people', 'projects', 'sprints', 'allocations', 'unavailability', 'holidays'];
  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
  const LEAVE_TYPES = ['leave', 'sick', 'training', 'travel', 'other'];
  const PROJECT_STATUS = ['active', 'on_hold', 'completed'];

  class ApiError extends Error {
    constructor(status, message) {
      super(message);
      this.status = status;
    }
  }

  // ---- validation (mirrors src/app.js) ---------------------------------------

  const blank = (v) => v === undefined || v === null || v === '';

  const f = {
    text: ({ required = false, max = 200 } = {}) => (v, name) => {
      if (blank(v)) {
        if (required) throw new ApiError(400, `${name} is required`);
        return null;
      }
      const s = String(v).trim();
      if (required && !s) throw new ApiError(400, `${name} is required`);
      if (s.length > max) throw new ApiError(400, `${name} must be at most ${max} characters`);
      return s || null;
    },
    date: () => (v, name) => {
      if (blank(v)) throw new ApiError(400, `${name} is required`);
      if (!ISO_DATE.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) {
        throw new ApiError(400, `${name} must be a date in YYYY-MM-DD format`);
      }
      return v;
    },
    number: ({ required = true, min, max, fallback = null } = {}) => (v, name) => {
      if (blank(v)) {
        if (required) throw new ApiError(400, `${name} is required`);
        return fallback;
      }
      const n = Number(v);
      if (!Number.isFinite(n) || n <= min || n > max) throw new ApiError(400, `${name} must be more than ${min} and at most ${max}`);
      return n;
    },
    oneOf: (values, fallback) => (v, name) => {
      if (blank(v)) return fallback;
      if (!values.includes(v)) throw new ApiError(400, `${name} must be one of: ${values.join(', ')}`);
      return v;
    },
    bool: (fallback) => (v) => (v === undefined || v === null ? fallback : v ? 1 : 0),
    color: () => (v, name) => {
      if (blank(v)) return '#4f46e5';
      if (!/^#[0-9a-fA-F]{6}$/.test(v)) throw new ApiError(400, `${name} must be a hex colour like #4f46e5`);
      return v;
    },
    id: () => (v, name) => {
      const n = Number(v);
      if (!Number.isInteger(n) || n <= 0) throw new ApiError(400, `${name} is required`);
      return n;
    },
    portion: () => (v, name) => {
      if (blank(v)) return 1;
      const n = Number(v);
      if (n !== 0.5 && n !== 1) throw new ApiError(400, `${name} must be 1 (full day) or 0.5 (half day)`);
      return n;
    },
  };

  const SPECS = {
    people: {
      name: f.text({ required: true }),
      email: f.text(),
      role: f.text(),
      team: f.text(),
      hours_per_day: f.number({ required: false, min: 0, max: 24, fallback: 8 }),
      active: f.bool(1),
    },
    projects: {
      name: f.text({ required: true }),
      code: f.text({ max: 20 }),
      color: f.color(),
      status: f.oneOf(PROJECT_STATUS, 'active'),
      owner: f.text(),
    },
    sprints: {
      name: f.text({ required: true }),
      start_date: f.date(),
      end_date: f.date(),
      goal: f.text({ max: 1000 }),
    },
    allocations: {
      person_id: f.id(),
      project_id: f.id(),
      sprint_id: f.id(),
      allocation_pct: f.number({ min: 0, max: 100 }),
      notes: f.text({ max: 1000 }),
    },
    unavailability: {
      person_id: f.id(),
      start_date: f.date(),
      end_date: f.date(),
      type: f.oneOf(LEAVE_TYPES, 'leave'),
      portion: f.portion(),
      notes: f.text({ max: 1000 }),
    },
    holidays: {
      date: f.date(),
      name: f.text({ required: true }),
    },
  };

  const SORTS = {
    people: (a, b) => b.active - a.active || a.name.localeCompare(b.name),
    projects: (a, b) => PROJECT_STATUS.indexOf(a.status) - PROJECT_STATUS.indexOf(b.status) || a.name.localeCompare(b.name),
    sprints: (a, b) => b.start_date.localeCompare(a.start_date),
    allocations: (a, b) => a.sprint_id - b.sprint_id || a.person_id - b.person_id || a.project_id - b.project_id,
    unavailability: (a, b) => b.start_date.localeCompare(a.start_date),
    holidays: (a, b) => a.date.localeCompare(b.date),
  };

  const FILTERS = { allocations: ['sprint_id', 'person_id', 'project_id'], unavailability: ['person_id'] };

  // ---- storage ---------------------------------------------------------------

  /** Stable JSON so a row read back from the store compares equal to the one written. */
  function canonical(value) {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (value && typeof value === 'object') {
      return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
    }
    return JSON.stringify(value);
  }

  function emptyData() {
    return Object.fromEntries(COLLECTIONS.map((c) => [c, []]));
  }

  function create() {
    let data = emptyData();
    let db = null;
    let onChange = () => {};
    let readOnly = false;
    const backend = { notice: null };

    backend.ready = (async () => {
      db = window.claude ? await window.claude.use('db').catch(() => null) : null;
      if (!db) {
        backend.notice = 'This copy of the page cannot reach its shared data, so changes here are not saved.';
        return;
      }
      // One subscription per collection; resolve once each has delivered its first snapshot.
      await Promise.all(
        COLLECTIONS.map(
          (name) =>
            new Promise((resolve) => {
              db.collection(name).onSnapshot(
                (snap) => {
                  const rows = snap.docs.map((d) => ({ ...d.data() }));
                  const changed = canonical(rows.slice().sort((a, b) => a.id - b.id)) !==
                    canonical(data[name].slice().sort((a, b) => a.id - b.id));
                  data[name] = rows;
                  resolve();
                  if (changed) onChange();
                },
                (err) => {
                  backend.notice = err.code === 'revoked'
                    ? 'Your access to this page changed. Reload to see the latest data.'
                    : 'Live updates stopped. Reload the page to see the latest data.';
                  resolve();
                  onChange();
                },
              );
            }),
        ),
      );
    })();

    async function write(name, row) {
      if (db) {
        try {
          await db.collection(name).doc(String(row.id)).set(row);
        } catch (err) {
          throw storeError(err);
        }
      }
      const list = data[name];
      const i = list.findIndex((r) => r.id === row.id);
      if (i === -1) list.push(row);
      else list[i] = row;
    }

    async function remove(name, id) {
      if (db) {
        try {
          await db.collection(name).doc(String(id)).delete();
        } catch (err) {
          throw storeError(err);
        }
      }
      data[name] = data[name].filter((r) => r.id !== id);
    }

    function storeError(err) {
      if (err && err.code === 'invalid_argument') {
        readOnly = true;
        return new ApiError(403, 'You can view this page but not change it. Ask the owner for Contributor access.');
      }
      if (err && err.code === 'quota_exceeded') return new ApiError(507, 'The shared data store is full. Delete old sprints or leave entries, then try again.');
      return new ApiError(503, 'Could not save just now. Check your connection and try again.');
    }

    function newId(name) {
      let id;
      do id = Date.now() * 1000 + Math.floor(Math.random() * 1000);
      while (data[name].some((r) => r.id === id));
      return id;
    }

    const find = (name, id) => data[name].find((r) => r.id === Number(id));

    function mustFind(name, id, label) {
      const row = find(name, id);
      if (!row) throw new ApiError(404, `${label} not found`);
      return row;
    }

    // Integrity checks the SQLite schema enforces on the server.
    function checkRow(name, row) {
      if ((name === 'sprints' || name === 'unavailability') && row.end_date < row.start_date) {
        throw new ApiError(400, 'end_date must be on or after start_date');
      }
      const others = data[name].filter((r) => r.id !== row.id);
      if (name === 'projects' && row.code && others.some((r) => r.code === row.code)) {
        throw new ApiError(409, 'A record with that value already exists');
      }
      if (name === 'holidays' && others.some((r) => r.date === row.date)) {
        throw new ApiError(409, 'A record with that value already exists');
      }
      if (name === 'allocations') {
        if (!find('people', row.person_id) || !find('projects', row.project_id) || !find('sprints', row.sprint_id)) {
          throw new ApiError(400, 'Referenced person, project or sprint does not exist');
        }
        if (others.some((r) => r.person_id === row.person_id && r.project_id === row.project_id && r.sprint_id === row.sprint_id)) {
          throw new ApiError(409, 'This person already has an allocation on that project for that sprint');
        }
      }
      if (name === 'unavailability' && !find('people', row.person_id)) {
        throw new ApiError(400, 'Referenced person, project or sprint does not exist');
      }
    }

    function validate(name, body, existing) {
      if (!body || typeof body !== 'object') throw new ApiError(400, 'JSON body required');
      const row = existing ? { ...existing } : {};
      for (const [field, check] of Object.entries(SPECS[name])) {
        if (existing && !(field in body)) continue;
        row[field] = check(body[field], field);
      }
      return row;
    }

    async function cascade(name, id) {
      const children = {
        people: [['allocations', 'person_id'], ['unavailability', 'person_id']],
        projects: [['allocations', 'project_id']],
        sprints: [['allocations', 'sprint_id']],
      }[name] || [];
      for (const [child, key] of children) {
        for (const r of data[child].filter((c) => c[key] === id)) await remove(child, r.id);
      }
    }

    const clone = (v) => JSON.parse(JSON.stringify(v));

    async function request(method, url, body) {
      await backend.ready;
      const [path, query = ''] = url.split('?');
      const params = new URLSearchParams(query);
      const parts = path.replace(/^\/api\//, '').split('/');
      const [name, rawId, action] = parts;
      const id = rawId === undefined ? undefined : Number(rawId);

      if (action) {
        if (name === 'sprints' && action === 'summary' && method === 'GET') {
          return clone(RPReports.sprintSummary(data, mustFind('sprints', id, 'Sprint')));
        }
        if (name === 'sprints' && action === 'export.csv' && method === 'GET') {
          return RPReports.sprintCsv(RPReports.sprintSummary(data, mustFind('sprints', id, 'Sprint')));
        }
        if (name === 'sprints' && action === 'copy-allocations' && method === 'POST') {
          const target = mustFind('sprints', id, 'Sprint');
          const source = mustFind('sprints', f.id()(body && body.from_sprint_id, 'from_sprint_id'), 'Sprint');
          if (source.id === target.id) throw new ApiError(400, 'Source and target sprint must differ');
          let copied = 0;
          for (const a of data.allocations.filter((r) => r.sprint_id === source.id)) {
            const person = find('people', a.person_id);
            if (!person || !person.active) continue;
            const exists = data.allocations.some((r) => r.sprint_id === target.id && r.person_id === a.person_id && r.project_id === a.project_id);
            if (exists) continue;
            await write('allocations', { ...a, id: newId('allocations'), sprint_id: target.id });
            copied += 1;
          }
          return { copied };
        }
        if (name === 'people' && action === 'timeline' && method === 'GET') {
          return clone(RPReports.personTimeline(data, mustFind('people', id, 'Person')));
        }
        if (name === 'projects' && action === 'timeline' && method === 'GET') {
          return clone(RPReports.projectTimeline(data, mustFind('projects', id, 'Project')));
        }
        throw new ApiError(404, 'Not found');
      }

      if (!SPECS[name]) throw new ApiError(404, 'Not found');

      if (method === 'GET' && id === undefined) {
        let rows = data[name];
        for (const key of FILTERS[name] || []) {
          if (params.has(key)) rows = rows.filter((r) => r[key] === Number(params.get(key)));
        }
        return clone([...rows].sort(SORTS[name]));
      }
      if (method === 'GET') return clone(mustFind(name, id, 'Record'));

      if (readOnly) throw new ApiError(403, 'You can view this page but not change it. Ask the owner for Contributor access.');

      if (method === 'POST') {
        const row = validate(name, body, null);
        row.id = newId(name);
        checkRow(name, row);
        await write(name, row);
        return clone(row);
      }
      if (method === 'PUT') {
        const row = validate(name, body, mustFind(name, id, 'Record'));
        checkRow(name, row);
        await write(name, row);
        return clone(row);
      }
      if (method === 'DELETE') {
        mustFind(name, id, 'Record');
        await cascade(name, id);
        await remove(name, id);
        return null;
      }
      throw new ApiError(405, 'Method not allowed');
    }

    backend.request = request;
    backend.setOnChange = (fn) => {
      onChange = fn;
    };
    return backend;
  }

  return { create };
})();
