'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS people (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  email         TEXT,
  role          TEXT,
  team          TEXT,
  hours_per_day REAL    NOT NULL DEFAULT 8 CHECK (hours_per_day > 0 AND hours_per_day <= 24),
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS projects (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  code       TEXT UNIQUE,
  color      TEXT NOT NULL DEFAULT '#4f46e5',
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'on_hold', 'completed')),
  owner      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sprints (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date   TEXT NOT NULL,
  goal       TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (end_date >= start_date)
);

-- allocation_pct is the share of the person's *available* time in the sprint
-- (i.e. after leave and holidays are removed).
CREATE TABLE IF NOT EXISTS allocations (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id      INTEGER NOT NULL REFERENCES people(id)   ON DELETE CASCADE,
  project_id     INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sprint_id      INTEGER NOT NULL REFERENCES sprints(id)  ON DELETE CASCADE,
  allocation_pct REAL    NOT NULL CHECK (allocation_pct > 0 AND allocation_pct <= 100),
  notes          TEXT,
  UNIQUE (person_id, project_id, sprint_id)
);

-- portion: 1 = full day off, 0.5 = half day off.
CREATE TABLE IF NOT EXISTS unavailability (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id  INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  start_date TEXT    NOT NULL,
  end_date   TEXT    NOT NULL,
  type       TEXT    NOT NULL DEFAULT 'leave'
             CHECK (type IN ('leave', 'sick', 'training', 'travel', 'other')),
  portion    REAL    NOT NULL DEFAULT 1 CHECK (portion IN (0.5, 1)),
  notes      TEXT,
  CHECK (end_date >= start_date)
);

CREATE TABLE IF NOT EXISTS holidays (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_alloc_sprint  ON allocations(sprint_id);
CREATE INDEX IF NOT EXISTS idx_alloc_person  ON allocations(person_id);
CREATE INDEX IF NOT EXISTS idx_unavail_person ON unavailability(person_id);
`;

function openDatabase(file) {
  if (file !== ':memory:') {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  return db;
}

module.exports = { openDatabase };
