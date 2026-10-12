import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, patch, post, put } from "../lib/api";
import { addDays, fmtDay, isoDay, mins, roleLabel, signedMins } from "../lib/format";
import CreateItem from "../components/CreateItem";
import {
  Avatar, Card, Chip, ErrorBanner, Field, Loading, Modal, SlaChip, Stat, StatusChip, TypeChip, errorText, useToast,
} from "../components/ui";

export default function ProjectPage() {
  const { projectId = "", tab } = useParams();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ["project", projectId], queryFn: () => api(`/projects/${projectId}`) });
  const [creating, setCreating] = useState(false);
  if (q.isLoading) return <Loading />;
  if (q.isError) return <ErrorBanner error={q.error} />;
  const p = q.data;
  const tabs: [string, string][] = p.kind === "service"
    ? [["items", "Work items"], ["members", "Members"], ["settings", "Settings"]]
    : [["board", "Board"], ["backlog", "Backlog & sprints"], ["items", "Work items"], ["report", "Sprint report"], ["members", "Members"], ["settings", "Settings"]];
  const current = tab ?? tabs[0][0];
  return (
    <>
      <div className="between">
        <div>
          <div className="crumbs"><Link to="/projects">Projects</Link><span>/</span><strong>{p.name}</strong></div>
          <h1 style={{ marginTop: 6 }}>{p.name}</h1>
          <div className="muted">{p.description || p.methodology}</div>
        </div>
        <div className="row">
          {p.kind === "service" && <Link to="/service" className="btn">Open service desk</Link>}
          {p.permissions.edit && <button className="btn primary" onClick={() => setCreating(true)}>New work item</button>}
        </div>
      </div>
      <div className="tabs card" style={{ padding: "0 8px" }} role="tablist">
        {tabs.map(([k, l]) => <button key={k} className={current === k ? "on" : ""} role="tab" aria-selected={current === k} onClick={() => nav(`/projects/${projectId}/${k}`)}>{l}</button>)}
      </div>
      {current === "board" && <Board project={p} />}
      {current === "backlog" && <Backlog project={p} />}
      {current === "items" && <Items project={p} />}
      {current === "report" && <SprintReport project={p} />}
      {current === "members" && <Members project={p} />}
      {current === "settings" && <Settings project={p} />}
      {creating && <CreateItem project={p} onClose={() => setCreating(false)} />}
    </>
  );
}

// ---------------------------------------------------------------- board (screen 03)

function Board({ project }: { project: any }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [group, setGroup] = useState<"none" | "assignee" | "epic">("none");
  const [type, setType] = useState("");
  const [blocked, setBlocked] = useState(false);
  const [fromMeeting, setFromMeeting] = useState(false);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);
  const q = useQuery({ queryKey: ["board", project.id], queryFn: () => api(`/projects/${project.id}/board`) });
  if (q.isLoading) return <Loading />;
  const b = q.data;
  if (!b.sprint) return <Card><div className="empty">No active sprint. Plan and start one under <Link to={`/projects/${project.id}/backlog`}>Backlog &amp; sprints</Link>.</div></Card>;
  const r = b.report;
  const filter = (i: any) => (!type || i.type === type) && (!blocked || i.blockedBy.length || i.status === "blocked") && (!fromMeeting || i.fromMeeting);

  const drop = async (status: string, key: string) => {
    setDragOver(null);
    try {
      await post(`/work-items/${key}/transitions`, { to: status });
      qc.invalidateQueries({ queryKey: ["board", project.id] });
    } catch (e) { toast(errorText(e), true); }
  };

  const groups: [string, (i: any) => boolean][] = group === "none" ? [["", () => true]]
    : group === "assignee"
      ? [...new Set(b.columns.flatMap((c: any) => c.items.map((i: any) => i.assignee?.name ?? "Unassigned")))].map((n) => [n as string, (i: any) => (i.assignee?.name ?? "Unassigned") === n])
      : [["Grouped by parent", () => true]];

  return (
    <>
      <div className="between">
        <div>
          <h2>{b.sprint.name} · {fmtDay(b.sprint.startDate)} – {fmtDay(b.sprint.endDate)}</h2>
          <div className="muted">Goal: {b.sprint.goal || "—"}</div>
        </div>
        <div className="row">
          <Link className="btn" to={`/projects/${project.id}/backlog`}>Backlog</Link>
          <Link className="btn" to={`/projects/${project.id}/report`}>Sprint report</Link>
          {project.permissions.manage && <button className="btn dark" onClick={() => setCompleting(true)}>Complete sprint…</button>}
        </div>
      </div>
      <div className="grid-cols">
        <Stat label="Committed" value={`${r.committedPoints} pts`} hint="at sprint start" />
        <Stat label="Completed" value={`${r.completedPoints} pts`} hint={`${r.committedPoints ? Math.round((r.completedPoints / r.committedPoints) * 100) : 0}% of committed`} />
        <Stat label="Scope change" value={`${r.scopeChange.addedPoints - r.scopeChange.removedPoints >= 0 ? "+" : ""}${r.scopeChange.addedPoints - r.scopeChange.removedPoints} pts`} hint={`${r.scopeChange.addedItems} added · ${r.scopeChange.removedItems} removed · audited`} />
        <Stat label="Estimate vs actual" value={signedMins(r.varianceMinutes)} hint="hours, per reporting policy" tone={r.varianceMinutes > 0 ? "warning" : undefined} />
        <Stat label="Days left" value={r.daysLeft} hint={`ends ${fmtDay(b.sprint.endDate)}`} />
      </div>
      <div className="row">
        <span className="small">Group by</span>
        <div className="seg">{(["none", "assignee", "epic"] as const).map((g) => <button key={g} className={group === g ? "on" : ""} onClick={() => setGroup(g)} style={{ height: 32, textTransform: "capitalize" }}>{g === "epic" ? "Parent" : g}</button>)}</div>
        <select className="input" style={{ width: 150, height: 34 }} value={type} onChange={(e) => setType(e.target.value)} aria-label="Filter by type">
          <option value="">All types</option>{["story", "task", "subtask", "bug", "test_task"].map((t) => <option key={t} value={t}>{project.typeLabels[t]}</option>)}
        </select>
        <label className="radio small"><input type="checkbox" checked={blocked} onChange={(e) => setBlocked(e.target.checked)} />Only blocked</label>
        <label className="radio small"><input type="checkbox" checked={fromMeeting} onChange={(e) => setFromMeeting(e.target.checked)} />From meetings</label>
      </div>
      {groups.map(([label, gf]) => (
        <div key={label} className="stack-sm">
          {label && <h3 className="muted">{label}</h3>}
          <div className="board">
            {b.columns.map((c: any) => {
              const items = c.items.filter(filter).filter(gf);
              const over = c.wip_limit && c.count > c.wip_limit;
              return (
                <div key={c.key} className={`column ${dragOver === c.key ? "drop" : ""}`}
                     onDragOver={(e) => { e.preventDefault(); setDragOver(c.key); }} onDragLeave={() => setDragOver(null)}
                     onDrop={(e) => drop(c.key, e.dataTransfer.getData("text/plain"))}>
                  <div className="column-head">
                    <span>{c.name} <span className="muted">{c.count}</span></span>
                    {c.wip_limit && <Chip tone={over ? "danger" : "neutral"}>WIP {c.count} / {c.wip_limit}</Chip>}
                  </div>
                  {items.map((i: any) => (
                    <Link key={i.id} to={`/work-items/${i.key}`} className={`ticket ${i.blockedBy.length ? "blocked" : ""}`} draggable
                          onDragStart={(e) => e.dataTransfer.setData("text/plain", i.key)}>
                      <div className="row"><span className="key">{i.key}</span><TypeChip label={i.typeLabel} /></div>
                      <div>{i.title}</div>
                      {i.blockedBy.length > 0 && <div className="small tone-danger">Blocked by {i.blockedBy.join(", ")}</div>}
                      {i.fromMeeting && <div className="small" style={{ color: "var(--purple-fg)" }}>AI action · approved from a meeting</div>}
                      <div className="between" style={{ alignItems: "center" }}>
                        <span className="subtle mono">{i.storyPoints ?? "–"} pts · rem {mins(i.remainingEstimateMinutes)}</span>
                        <Avatar small initials={i.assignee?.initials} title={i.assignee?.name ?? "Unassigned"} />
                      </div>
                    </Link>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      ))}
      <div className="subtle">Drag a card to another column to run the workflow transition (validators apply). Story points and hours are tracked separately; points are never converted to time.</div>
      {completing && <CompleteSprint project={project} sprint={b.sprint} onClose={() => setCompleting(false)} />}
    </>
  );
}

function CompleteSprint({ project, sprint, onClose }: { project: any; sprint: any; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const planned = project.sprints.filter((s: any) => s.state === "planned");
  const [dest, setDest] = useState(planned[0]?.id ?? "backlog");
  const [error, setError] = useState<any>(null);
  const complete = async () => {
    try {
      const r = await post(`/sprints/${sprint.id}/complete`, { destination: dest });
      toast(`${sprint.name} completed · ${r.moved} unfinished item(s) moved`);
      qc.invalidateQueries();
      onClose();
    } catch (e) { setError(e); }
  };
  return (
    <Modal title={`Complete ${sprint.name}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn dark" onClick={complete}>Complete sprint</button></>}>
      <ErrorBanner error={error} />
      <div className="muted">Unfinished work needs an explicit destination.</div>
      <Field label="Move unfinished items to">
        <select className="input" value={dest} onChange={(e) => setDest(e.target.value)}>
          {planned.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
          <option value="backlog">Backlog</option>
        </select>
      </Field>
    </Modal>
  );
}

// ---------------------------------------------------------------- backlog & sprint planning

function Backlog({ project }: { project: any }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [newSprint, setNewSprint] = useState(false);
  const sprints = project.sprints.filter((s: any) => s.state !== "closed");
  const backlog = useQuery({ queryKey: ["backlog", project.id], queryFn: () => api(`/projects/${project.id}/work-items?sprint=backlog&pageSize=200`) });
  const start = async (s: any) => {
    try { await post(`/sprints/${s.id}/start`); toast(`${s.name} started — estimates are now the baseline`); qc.invalidateQueries(); }
    catch (e) { toast(errorText(e), true); }
  };
  const move = async (item: any, sprintId: string | null) => {
    try { await patch(`/work-items/${item.key}`, { sprintId, version: item.version }); qc.invalidateQueries(); }
    catch (e) { toast(errorText(e), true); }
  };
  return (
    <>
      {sprints.map((s: any) => <SprintBlock key={s.id} project={project} sprint={s} onStart={() => start(s)} onMove={move} />)}
      <Card title={`Backlog · ${backlog.data?.total ?? 0}`} pad={false}
            extra={project.permissions.manage && <button className="btn sm" onClick={() => setNewSprint(true)}>Plan new sprint</button>}>
        <ItemTable items={backlog.data?.items ?? []} actions={(i) => project.permissions.edit && sprints.length > 0 && (
          <select className="input" style={{ height: 30, width: 150 }} value="" onChange={(e) => e.target.value && move(i, e.target.value)} aria-label={`Move ${i.key} to sprint`}>
            <option value="">Add to sprint…</option>
            {sprints.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>)} />
      </Card>
      {newSprint && <NewSprint project={project} onClose={() => setNewSprint(false)} />}
    </>
  );
}

function SprintBlock({ project, sprint, onStart, onMove }: { project: any; sprint: any; onStart: () => void; onMove: (i: any, s: string | null) => void }) {
  const q = useQuery({ queryKey: ["sprint-items", sprint.id], queryFn: () => api(`/projects/${project.id}/work-items?sprint=${sprint.id}&pageSize=200`) });
  const items = q.data?.items ?? [];
  const points = items.reduce((a: number, i: any) => a + (i.storyPoints ?? 0), 0);
  const est = items.reduce((a: number, i: any) => a + (i.originalEstimateMinutes ?? 0), 0);
  return (
    <Card pad={false} title={<div className="row"><h2>{sprint.name}</h2><Chip tone={sprint.state === "active" ? "info" : "neutral"}>{sprint.state === "active" ? "Active" : "Planned"}</Chip><span className="subtle">{fmtDay(sprint.startDate)} – {fmtDay(sprint.endDate)} · {points} pts · {mins(est)} estimated</span></div>}
          extra={sprint.state === "planned" && project.permissions.manage && <button className="btn sm primary" onClick={onStart}>Start sprint</button>}>
      {sprint.goal && <div className="muted small" style={{ padding: "0 24px 10px" }}>Goal: {sprint.goal}</div>}
      <ItemTable items={items} actions={(i) => project.permissions.edit && (
        <button className="btn sm" onClick={() => onMove(i, null)}>To backlog</button>)} />
    </Card>
  );
}

function NewSprint({ project, onClose }: { project: any; onClose: () => void }) {
  const qc = useQueryClient();
  const last = project.sprints[project.sprints.length - 1];
  const startDefault = last ? addDays(last.endDate, 1) : isoDay(new Date());
  const [f, setF] = useState({ name: "", goal: "", startDate: startDefault, endDate: addDays(startDefault, (project.settings.sprint_length_days ?? 14) - 1) });
  const [error, setError] = useState<any>(null);
  const save = async () => {
    try { await post(`/projects/${project.id}/sprints`, f); qc.invalidateQueries(); onClose(); } catch (e) { setError(e); }
  };
  return (
    <Modal title="Plan a sprint" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Create sprint</button></>}>
      <ErrorBanner error={error} />
      <Field label="Name" help="Leave blank to auto-number"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <Field label="Goal"><textarea className="input" value={f.goal} onChange={(e) => setF({ ...f, goal: e.target.value })} /></Field>
      <div className="row"><Field label="Start"><input className="input" type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></Field>
        <Field label="End"><input className="input" type="date" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></Field></div>
    </Modal>
  );
}

function ItemTable({ items, actions }: { items: any[]; actions?: (i: any) => React.ReactNode }) {
  const nav = useNavigate();
  if (!items.length) return <div className="empty">No items.</div>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead><tr><th>Key</th><th>Title</th><th>Type</th><th>Status</th><th>Assignee</th><th className="right">Points</th><th className="right">Original</th><th className="right">Remaining</th><th className="right">Actual</th>{actions && <th />}</tr></thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.id} className="clickable" onClick={() => nav(`/work-items/${i.key}`)}>
              <td className="key">{i.key}</td>
              <td>{i.title}{i.blockedBy?.length > 0 && <div className="small tone-danger">Blocked by {i.blockedBy.join(", ")}</div>}</td>
              <td><TypeChip label={i.typeLabel} /></td>
              <td><StatusChip name={i.statusName} category={i.statusCategory} />{i.sla && <> <SlaChip sla={i.sla} /></>}</td>
              <td className="small">{i.assignee?.name ?? <span className="muted">Unassigned</span>}</td>
              <td className="num">{i.storyPoints ?? "—"}</td>
              <td className="num">{mins(i.originalEstimateMinutes)}</td>
              <td className="num">{mins(i.remainingEstimateMinutes)}</td>
              <td className="num">{mins(i.actualMinutes)}</td>
              {actions && <td className="right" onClick={(e) => e.stopPropagation()}>{actions(i)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Items({ project }: { project: any }) {
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [assignee, setAssignee] = useState("");
  const [page, setPage] = useState(1);
  const r = useQuery({ queryKey: ["items", project.id, q, type, assignee, page],
    queryFn: () => api(`/projects/${project.id}/work-items?pageSize=50&page=${page}&sort=key${q ? `&q=${encodeURIComponent(q)}` : ""}${type ? `&type=${type}` : ""}${assignee ? `&assignee=${assignee}` : ""}`) });
  const pages = Math.max(1, Math.ceil((r.data?.total ?? 0) / 50));
  return (
    <Card pad={false} title={<div className="row">
      <input className="input" style={{ width: 240, height: 36 }} placeholder="Filter by key or title" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
      <select className="input" style={{ width: 160, height: 36 }} value={type} onChange={(e) => { setType(e.target.value); setPage(1); }}><option value="">All types</option>{Object.entries(project.typeLabels).map(([k, v]) => <option key={k} value={k}>{v as string}</option>)}</select>
      <select className="input" style={{ width: 160, height: 36 }} value={assignee} onChange={(e) => { setAssignee(e.target.value); setPage(1); }}><option value="">Anyone</option><option value="me">Assigned to me</option><option value="none">Unassigned</option></select>
    </div>} extra={`${r.data?.total ?? 0} items`}>
      <ItemTable items={r.data?.items ?? []} />
      {pages > 1 && <div className="row" style={{ padding: 12, justifyContent: "flex-end" }}><button className="btn sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><span className="small">Page {page} of {pages}</span><button className="btn sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button></div>}
    </Card>
  );
}

function SprintReport({ project }: { project: any }) {
  const options = project.sprints.filter((s: any) => s.state !== "planned");
  const [sprintId, setSprintId] = useState(options.find((s: any) => s.state === "active")?.id ?? options[0]?.id);
  const q = useQuery({ queryKey: ["sprint-report", sprintId], queryFn: () => api(`/sprints/${sprintId}/report`), enabled: !!sprintId });
  if (!sprintId) return <Card><div className="empty">No started sprints yet.</div></Card>;
  if (!q.data) return <Loading />;
  const r = q.data;
  const max = Math.max(...r.burndown.map((b: any) => b.remaining ?? 0), r.committedPoints, 1);
  const n = r.burndown.length;
  const W = 640, H = 200;
  const pts = r.burndown.map((b: any, i: number) => b.remaining === null ? null : `${(i / Math.max(n - 1, 1)) * W},${H - (b.remaining / max) * H}`).filter(Boolean).join(" ");
  return (
    <>
      <div className="row"><span className="small">Sprint</span><select className="input" style={{ width: 200 }} value={sprintId} onChange={(e) => setSprintId(e.target.value)}>{options.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
      <div className="grid-cols">
        <Stat label="Committed" value={`${r.committedPoints} pts`} />
        <Stat label="Completed" value={`${r.completedPoints} pts`} />
        <Stat label="Added after start" value={`${r.scopeChange.addedPoints} pts`} hint={`${r.scopeChange.addedItems} items`} />
        <Stat label="Original estimate" value={mins(r.originalEstimateMinutes)} />
        <Stat label="Actual" value={mins(r.actualMinutes)} hint={signedMins(r.varianceMinutes)} />
        <Stat label="Blocked" value={r.blocked.length} />
      </div>
      <Card title="Burndown" extra="Remaining story points per day; ideal line dashed">
        <svg viewBox={`-30 -10 ${W + 40} ${H + 40}`} style={{ width: "100%", maxWidth: 760 }} role="img" aria-label="Sprint burndown chart">
          <line x1={0} y1={H} x2={W} y2={H} stroke="var(--border-strong)" />
          <line x1={0} y1={0} x2={0} y2={H} stroke="var(--border-strong)" />
          <line x1={0} y1={H - (r.committedPoints / max) * H} x2={W} y2={H} stroke="var(--text-3)" strokeDasharray="5 5" />
          <polyline points={pts} fill="none" stroke="var(--primary)" strokeWidth={2.5} />
          <text x={-6} y={4} fontSize={11} textAnchor="end" fill="var(--text-3)">{max}</text>
          <text x={-6} y={H} fontSize={11} textAnchor="end" fill="var(--text-3)">0</text>
          <text x={0} y={H + 18} fontSize={11} fill="var(--text-3)">{fmtDay(r.burndown[0]?.date)}</text>
          <text x={W} y={H + 18} fontSize={11} textAnchor="end" fill="var(--text-3)">{fmtDay(r.burndown[n - 1]?.date)}</text>
        </svg>
      </Card>
    </>
  );
}

function Members({ project }: { project: any }) {
  const qc = useQueryClient();
  const users = useQuery({ queryKey: ["users"], queryFn: () => api("/users"), enabled: project.permissions.manage });
  const [add, setAdd] = useState({ userId: "", role: "contributor" });
  const toast = useToast();
  const save = async (body: any) => {
    try { await put(`/projects/${project.id}/members`, body); qc.invalidateQueries({ queryKey: ["project", project.id] }); }
    catch (e) { toast(errorText(e), true); }
  };
  const roles = ["project_manager", "contributor", "qa", "service_agent", "service_owner", "approver", "ai_reviewer", "viewer", "project_admin"];
  return (
    <Card pad={false} title="Members" extra="Roles are per project. Approvers receive this project's time for approval.">
      <table className="table">
        <thead><tr><th>Person</th><th>Role</th><th>Time approver</th><th>AI reviewer</th></tr></thead>
        <tbody>
          {project.members.map((m: any) => (
            <tr key={m.userId}>
              <td className="row"><Avatar small initials={m.initials} />{m.name}<span className="subtle">{m.email}</span></td>
              <td>{project.permissions.manage
                ? <select className="input" style={{ height: 32 }} value={m.role} onChange={(e) => save({ userId: m.userId, role: e.target.value, isTimeApprover: m.isTimeApprover, isAiReviewer: m.isAiReviewer })}>{roles.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}</select>
                : roleLabel(m.role)}</td>
              <td><input type="checkbox" checked={m.isTimeApprover} disabled={!project.permissions.manage} aria-label={`${m.name} approves time`} onChange={(e) => save({ userId: m.userId, role: m.role, isTimeApprover: e.target.checked, isAiReviewer: m.isAiReviewer })} /></td>
              <td><input type="checkbox" checked={m.isAiReviewer} disabled={!project.permissions.manage} aria-label={`${m.name} reviews AI actions`} onChange={(e) => save({ userId: m.userId, role: m.role, isTimeApprover: m.isTimeApprover, isAiReviewer: e.target.checked })} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      {project.permissions.manage && (
        <div className="row" style={{ padding: 16, borderTop: "1px solid var(--border)" }}>
          <select className="input" style={{ width: 240 }} value={add.userId} onChange={(e) => setAdd({ ...add, userId: e.target.value })}>
            <option value="">Add a person…</option>
            {users.data?.filter((u: any) => !project.members.some((m: any) => m.userId === u.id)).map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <select className="input" style={{ width: 200 }} value={add.role} onChange={(e) => setAdd({ ...add, role: e.target.value })}>{roles.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}</select>
          <button className="btn primary" disabled={!add.userId} onClick={() => { save(add); setAdd({ userId: "", role: "contributor" }); }}>Add member</button>
        </div>
      )}
    </Card>
  );
}

function Settings({ project }: { project: any }) {
  const qc = useQueryClient();
  const toast = useToast();
  const t = project.settings.time;
  const [f, setF] = useState({
    backdate_days: t.backdate_days, max_entry_minutes: t.max_entry_minutes, max_daily_minutes: t.max_daily_minutes,
    min_description_length: t.min_description_length, approval_required: t.approval_required,
    allow_negative_remaining: t.allow_negative_remaining, pm_can_edit_others_time: t.pm_can_edit_others_time,
    activity_categories: t.activity_categories.join(", "),
    required_types: project.settings.estimates.required_types.join(", "),
    required_skills: (project.settings.required_skills ?? []).join(", "),
  });
  const [wf, setWf] = useState(JSON.stringify(project.workflow, null, 2));
  const [error, setError] = useState<any>(null);
  const can = project.permissions.manage;
  const save = async () => {
    setError(null);
    try {
      const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
      await patch(`/projects/${project.id}`, {
        settings: {
          time: { ...f, activity_categories: list(f.activity_categories), required_types: undefined, required_skills: undefined,
                  backdate_days: Number(f.backdate_days), max_entry_minutes: Number(f.max_entry_minutes),
                  max_daily_minutes: Number(f.max_daily_minutes), min_description_length: Number(f.min_description_length) },
          estimates: { required_types: list(f.required_types) }, required_skills: list(f.required_skills),
        },
        workflow: JSON.parse(wf),
      });
      toast("Project settings saved");
      qc.invalidateQueries();
    } catch (e) { setError(e); }
  };
  return (
    <div className="grid-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))" }}>
      <Card title="Time-entry policy" extra="BR-TIME-12 · configurable per project">
        <div className="stack">
          <ErrorBanner error={error} />
          <div className="grid-cols">
            <Field label="Backdating (days)"><input className="input" type="number" disabled={!can} value={f.backdate_days} onChange={(e) => setF({ ...f, backdate_days: e.target.value })} /></Field>
            <Field label="Min description"><input className="input" type="number" disabled={!can} value={f.min_description_length} onChange={(e) => setF({ ...f, min_description_length: e.target.value })} /></Field>
            <Field label="Max per entry (min)"><input className="input" type="number" disabled={!can} value={f.max_entry_minutes} onChange={(e) => setF({ ...f, max_entry_minutes: e.target.value })} /></Field>
            <Field label="Max per day (min)"><input className="input" type="number" disabled={!can} value={f.max_daily_minutes} onChange={(e) => setF({ ...f, max_daily_minutes: e.target.value })} /></Field>
          </div>
          <Field label="Activity categories"><input className="input" disabled={!can} value={f.activity_categories} onChange={(e) => setF({ ...f, activity_categories: e.target.value })} /></Field>
          <Field label="Types that require an original estimate"><input className="input" disabled={!can} value={f.required_types} onChange={(e) => setF({ ...f, required_types: e.target.value })} /></Field>
          <Field label="Required skills (for skills-gap detection)"><input className="input" disabled={!can} value={f.required_skills} onChange={(e) => setF({ ...f, required_skills: e.target.value })} /></Field>
          <label className="radio"><input type="checkbox" disabled={!can} checked={f.approval_required} onChange={(e) => setF({ ...f, approval_required: e.target.checked })} />Time entries require approval</label>
          <label className="radio"><input type="checkbox" disabled={!can} checked={f.allow_negative_remaining} onChange={(e) => setF({ ...f, allow_negative_remaining: e.target.checked })} />Allow negative remaining estimate</label>
          <label className="radio"><input type="checkbox" disabled={!can} checked={f.pm_can_edit_others_time} onChange={(e) => setF({ ...f, pm_can_edit_others_time: e.target.checked })} />Project managers may edit others' time (audited)</label>
          {can && <div><button className="btn primary" onClick={save}>Save settings</button></div>}
        </div>
      </Card>
      <Card title="Workflow" extra="Statuses, categories, WIP limits and transition roles">
        <textarea className="input mono" rows={22} style={{ fontSize: 12 }} disabled={!can} value={wf} onChange={(e) => setWf(e.target.value)} aria-label="Workflow definition (JSON)" />
        <div className="subtle" style={{ marginTop: 8 }}>Statuses in use cannot be removed. Transitions may list roles that are allowed to run them (e.g. change approval).</div>
      </Card>
    </div>
  );
}
