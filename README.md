# Resource Pool

A small web app for tracking **who is working on which project, how much of their time is allocated each sprint, and when they are unavailable**.

## Features

- **Sprint board**: for the selected sprint, each person's projects, allocation %, hours, available days and status (over-allocated, fully allocated, has free capacity, unassigned). It also shows per-project FTE and hours, and who is off during the sprint. Can be exported to CSV.
- **Allocation planner**: a people × projects grid for a sprint. Type a % in a cell and it saves straight away. You can copy all allocations from a previous sprint.
- **Unavailability**: leave, sick days, training, travel and other time off, either full days or half days.
- **Public holidays**: apply to everyone and are removed from working days, the same as weekends.
- **Person timeline**: one person's allocations and time off across every sprint.
- **Project timeline**: who worked on a project, sprint by sprint, with FTE and hours.
- People, projects (with colour, code, owner and status) and sprints can all be created, edited and deleted.

## How capacity is calculated

For each person in a sprint:

```
working days     = weekdays in the sprint − public holidays
unavailable days = days of leave/sick/training/travel that fall on working days
                   (half days count 0.5; overlapping entries count once)
available hours  = (working days − unavailable days) × person's hours per day
allocated hours  = allocation % × available hours
```

Allocation % is a share of the person's **available** time. If someone is on leave for half the sprint, "50% on Project X" means half of the time they are actually in. A person whose allocations add up to more than 100% is flagged as over-allocated.

## Running it

Needs Node.js 22.13 or newer. It uses Node's built-in SQLite, so there is no native module to compile.

```bash
npm install
npm run seed      # optional: loads demo people, projects, sprints and leave
npm start         # http://localhost:3000
npm test
```

Environment variables:

| Variable  | Default                   | Purpose            |
|-----------|---------------------------|--------------------|
| `PORT`    | `3000`                    | HTTP port          |
| `DB_FILE` | `data/resource-pool.db`   | SQLite file path   |

## REST API

All endpoints are JSON and live under `/api`. The resources are `people`, `projects`, `sprints`, `allocations`, `unavailability` and `holidays`. Each one supports:

| Method | Path                    | Notes |
|--------|-------------------------|-------|
| GET    | `/api/{resource}`       | `allocations` can be filtered with `?sprint_id=&person_id=&project_id=`; `unavailability` with `?person_id=` |
| GET    | `/api/{resource}/:id`   | |
| POST   | `/api/{resource}`       | Creates a record (201) |
| PUT    | `/api/{resource}/:id`   | Partial update: send only the fields you are changing |
| DELETE | `/api/{resource}/:id`   | Deleting a person, project or sprint also deletes its allocations and leave |

Reporting endpoints:

| Method | Path | Description |
|--------|------|-------------|
| GET  | `/api/sprints/:id/summary`          | Capacity, allocations and time off per person, plus totals per project |
| GET  | `/api/sprints/:id/export.csv`       | The same data as a CSV file |
| POST | `/api/sprints/:id/copy-allocations` | Body `{ "from_sprint_id": n }`. Copies the source sprint's allocations for active people and skips any that already exist |
| GET  | `/api/people/:id/timeline`          | A person's allocations and time off in every sprint |
| GET  | `/api/projects/:id/timeline`        | Who was on the project in each sprint |

Main fields:

- **people**: `name`*, `email`, `role`, `team`, `hours_per_day` (default 8), `active`
- **projects**: `name`*, `code`, `color` (`#rrggbb`), `status` (`active` / `on_hold` / `completed`), `owner`
- **sprints**: `name`*, `start_date`*, `end_date`*, `goal`. Dates use `YYYY-MM-DD`.
- **allocations**: `person_id`*, `project_id`*, `sprint_id`*, `allocation_pct`* (greater than 0, up to 100), `notes`. There can be only one allocation per person, project and sprint.
- **unavailability**: `person_id`*, `start_date`*, `end_date`*, `type` (`leave` / `sick` / `training` / `travel` / `other`), `portion` (`1` or `0.5`), `notes`
- **holidays**: `date`*, `name`*

## Project layout

```
src/
  server.js     entry point
  app.js        Express routes, validation, sprint/person/project reports
  capacity.js   working-day and capacity calculations (pure functions)
  db.js         SQLite schema
public/         single-page UI (plain HTML/CSS/JS, no build step)
scripts/seed.js demo data
test/           node:test unit and API tests
```
