'use strict';

const path = require('node:path');
const express = require('express');
const reports = require('./shared/reports');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// ---- field validators -------------------------------------------------------

const v = {
  text: ({ required = false, max = 200 } = {}) => (val, name) => {
    if (val === undefined || val === null || val === '') {
      if (required) throw new HttpError(400, `${name} is required`);
      return null;
    }
    if (typeof val !== 'string') throw new HttpError(400, `${name} must be a string`);
    const s = val.trim();
    if (required && !s) throw new HttpError(400, `${name} is required`);
    if (s.length > max) throw new HttpError(400, `${name} must be at most ${max} characters`);
    return s || null;
  },
  date: ({ required = true } = {}) => (val, name) => {
    if (val === undefined || val === null || val === '') {
      if (required) throw new HttpError(400, `${name} is required`);
      return null;
    }
    if (typeof val !== 'string' || !ISO_DATE.test(val) || Number.isNaN(Date.parse(`${val}T00:00:00Z`))) {
      throw new HttpError(400, `${name} must be a date in YYYY-MM-DD format`);
    }
    return val;
  },
  number: ({ required = true, min = -Infinity, max = Infinity, exclusiveMin = false } = {}) => (val, name) => {
    if (val === undefined || val === null || val === '') {
      if (required) throw new HttpError(400, `${name} is required`);
      return null;
    }
    const n = Number(val);
    if (!Number.isFinite(n) || n > max || (exclusiveMin ? n <= min : n < min)) {
      throw new HttpError(400, `${name} must be a number ${exclusiveMin ? '>' : '>='} ${min} and <= ${max}`);
    }
    return n;
  },
  oneOf: (values, { required = false } = {}) => (val, name) => {
    if (val === undefined || val === null || val === '') {
      if (required) throw new HttpError(400, `${name} is required`);
      return null;
    }
    if (!values.includes(val)) throw new HttpError(400, `${name} must be one of: ${values.join(', ')}`);
    return val;
  },
  bool: () => (val) => (val === undefined || val === null ? null : val ? 1 : 0),
  color: () => (val, name) => {
    if (val === undefined || val === null || val === '') return null;
    if (typeof val !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(val)) {
      throw new HttpError(400, `${name} must be a hex colour like #4f46e5`);
    }
    return val;
  },
  id: () => (val, name) => {
    const n = Number(val);
    if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `${name} is required`);
    return n;
  },
};

// Each resource: table, fields (validators), default ORDER BY, cross-field checks.
const RESOURCES = {
  people: {
    table: 'people',
    order: 'active DESC, name',
    fields: {
      name: v.text({ required: true }),
      email: v.text(),
      role: v.text(),
      team: v.text(),
      hours_per_day: v.number({ required: false, min: 0, max: 24, exclusiveMin: true }),
      active: v.bool(),
    },
  },
  projects: {
    table: 'projects',
    order: "CASE status WHEN 'active' THEN 0 WHEN 'on_hold' THEN 1 ELSE 2 END, name",
    fields: {
      name: v.text({ required: true }),
      code: v.text({ max: 20 }),
      color: v.color(),
      status: v.oneOf(['active', 'on_hold', 'completed']),
      owner: v.text(),
    },
  },
  sprints: {
    table: 'sprints',
    order: 'start_date DESC',
    fields: {
      name: v.text({ required: true }),
      start_date: v.date(),
      end_date: v.date(),
      goal: v.text({ max: 1000 }),
    },
    check: checkDateRange,
  },
  allocations: {
    table: 'allocations',
    order: 'sprint_id, person_id, project_id',
    filters: ['sprint_id', 'person_id', 'project_id'],
    fields: {
      person_id: v.id(),
      project_id: v.id(),
      sprint_id: v.id(),
      allocation_pct: v.number({ min: 0, max: 100, exclusiveMin: true }),
      notes: v.text({ max: 1000 }),
    },
  },
  unavailability: {
    table: 'unavailability',
    order: 'start_date DESC',
    filters: ['person_id'],
    fields: {
      person_id: v.id(),
      start_date: v.date(),
      end_date: v.date(),
      type: v.oneOf(['leave', 'sick', 'training', 'travel', 'other']),
      portion: (val, name) => {
        if (val === undefined || val === null || val === '') return null;
        const n = Number(val);
        if (n !== 0.5 && n !== 1) throw new HttpError(400, `${name} must be 1 (full day) or 0.5 (half day)`);
        return n;
      },
      notes: v.text({ max: 1000 }),
    },
    check: checkDateRange,
  },
  holidays: {
    table: 'holidays',
    order: 'date',
    fields: {
      date: v.date(),
      name: v.text({ required: true }),
    },
  },
};

function checkDateRange(row) {
  if (row.start_date && row.end_date && row.end_date < row.start_date) {
    throw new HttpError(400, 'end_date must be on or after start_date');
  }
}

/**
 * Validate a request body. On create every field is checked (so required ones
 * must be present); on update only the fields actually sent are checked.
 */
function validate(resource, body, { partial }) {
  if (!body || typeof body !== 'object') throw new HttpError(400, 'JSON body required');
  const out = {};
  for (const [name, check] of Object.entries(resource.fields)) {
    if (partial && !(name in body)) continue;
    const val = check(body[name], name);
    if (val !== null || partial) out[name] = val;
  }
  return out;
}

function translateDbError(err) {
  const msg = String(err.message || err);
  if (msg.includes('UNIQUE constraint failed: allocations')) {
    return new HttpError(409, 'This person already has an allocation on that project for that sprint');
  }
  if (msg.includes('UNIQUE constraint failed')) return new HttpError(409, 'A record with that value already exists');
  if (msg.includes('FOREIGN KEY constraint failed')) return new HttpError(400, 'Referenced person, project or sprint does not exist');
  if (msg.includes('CHECK constraint failed')) return new HttpError(400, 'Value out of allowed range');
  if (msg.includes('NOT NULL constraint failed')) return new HttpError(400, 'A required field cannot be empty');
  return err;
}

function createApp(db) {
  const app = express();
  app.use(express.json());

  const all = (sql, ...p) => db.prepare(sql).all(...p);
  const get = (sql, ...p) => db.prepare(sql).get(...p);
  const run = (sql, ...p) => {
    try {
      return db.prepare(sql).run(...p);
    } catch (err) {
      throw translateDbError(err);
    }
  };

  // ---- generic CRUD -------------------------------------------------------

  for (const [route, res] of Object.entries(RESOURCES)) {
    const base = `/api/${route}`;

    app.get(base, (req, resp) => {
      const where = [];
      const params = [];
      for (const f of res.filters || []) {
        if (req.query[f] !== undefined) {
          where.push(`${f} = ?`);
          params.push(Number(req.query[f]));
        }
      }
      const sql = `SELECT * FROM ${res.table} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ${res.order}`;
      resp.json(all(sql, ...params));
    });

    app.get(`${base}/:id`, (req, resp) => {
      const row = get(`SELECT * FROM ${res.table} WHERE id = ?`, Number(req.params.id));
      if (!row) throw new HttpError(404, 'Not found');
      resp.json(row);
    });

    app.post(base, (req, resp) => {
      const row = validate(res, req.body, { partial: false });
      if (res.check) res.check(row);
      const cols = Object.keys(row);
      const result = run(
        `INSERT INTO ${res.table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
        ...Object.values(row),
      );
      resp.status(201).json(get(`SELECT * FROM ${res.table} WHERE id = ?`, result.lastInsertRowid));
    });

    app.put(`${base}/:id`, (req, resp) => {
      const id = Number(req.params.id);
      const existing = get(`SELECT * FROM ${res.table} WHERE id = ?`, id);
      if (!existing) throw new HttpError(404, 'Not found');
      const changes = validate(res, req.body, { partial: true });
      // Required fields may not be cleared on update (the validator throws for them).
      for (const [k, val] of Object.entries(changes)) {
        if (val === null) res.fields[k](undefined, k);
      }
      if (res.check) res.check({ ...existing, ...changes });
      const cols = Object.keys(changes);
      if (cols.length) {
        run(`UPDATE ${res.table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, ...Object.values(changes), id);
      }
      resp.json(get(`SELECT * FROM ${res.table} WHERE id = ?`, id));
    });

    app.delete(`${base}/:id`, (req, resp) => {
      const result = run(`DELETE FROM ${res.table} WHERE id = ?`, Number(req.params.id));
      if (result.changes === 0) throw new HttpError(404, 'Not found');
      resp.status(204).end();
    });
  }

  // ---- reporting ----------------------------------------------------------

  function loadSprint(id) {
    const sprint = get('SELECT * FROM sprints WHERE id = ?', Number(id));
    if (!sprint) throw new HttpError(404, 'Sprint not found');
    return sprint;
  }

  /** Every row the reports need. The data set is small, so reading it whole keeps one code path with the browser build. */
  function loadAll() {
    return {
      people: all('SELECT * FROM people'),
      projects: all('SELECT * FROM projects'),
      sprints: all('SELECT * FROM sprints'),
      allocations: all('SELECT * FROM allocations'),
      unavailability: all('SELECT * FROM unavailability'),
      holidays: all('SELECT * FROM holidays'),
    };
  }

  app.get('/api/sprints/:id/summary', (req, resp) => {
    const sprint = loadSprint(req.params.id);
    resp.json(reports.sprintSummary(loadAll(), sprint));
  });

  app.get('/api/sprints/:id/export.csv', (req, resp) => {
    const sprint = loadSprint(req.params.id);
    const { filename, csv } = reports.sprintCsv(reports.sprintSummary(loadAll(), sprint));
    resp.type('text/csv').attachment(filename).send(csv);
  });

  /** Copy every allocation from another sprint into this one, skipping ones that already exist. */
  app.post('/api/sprints/:id/copy-allocations', (req, resp) => {
    const target = loadSprint(req.params.id);
    const fromId = v.id()(req.body?.from_sprint_id, 'from_sprint_id');
    const source = loadSprint(fromId);
    if (source.id === target.id) throw new HttpError(400, 'Source and target sprint must differ');
    const result = run(
      `INSERT OR IGNORE INTO allocations (person_id, project_id, sprint_id, allocation_pct, notes)
       SELECT a.person_id, a.project_id, ?, a.allocation_pct, a.notes
         FROM allocations a JOIN people pe ON pe.id = a.person_id
        WHERE a.sprint_id = ? AND pe.active = 1`,
      target.id,
      source.id,
    );
    resp.json({ copied: Number(result.changes) });
  });

  /** One person's allocations and leave across sprints. */
  app.get('/api/people/:id/timeline', (req, resp) => {
    const person = get('SELECT * FROM people WHERE id = ?', Number(req.params.id));
    if (!person) throw new HttpError(404, 'Person not found');
    resp.json(reports.personTimeline(loadAll(), person));
  });

  /** Who worked / is working on a project, sprint by sprint. */
  app.get('/api/projects/:id/timeline', (req, resp) => {
    const project = get('SELECT * FROM projects WHERE id = ?', Number(req.params.id));
    if (!project) throw new HttpError(404, 'Project not found');
    resp.json(reports.projectTimeline(loadAll(), project));
  });

  // ---- static UI + errors ---------------------------------------------------

  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.use('/api', (req, resp) => resp.status(404).json({ error: 'Not found' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, resp, next) => {
    const e = err instanceof HttpError ? err : translateDbError(err);
    if (e instanceof HttpError) return resp.status(e.status).json({ error: e.message });
    if (err.type === 'entity.parse.failed') return resp.status(400).json({ error: 'Invalid JSON body' });
    console.error(err);
    resp.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

module.exports = { createApp };
