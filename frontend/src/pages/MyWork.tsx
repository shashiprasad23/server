import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { addDays, fmtDay, isoWeek, mins, roleLabel } from "../lib/format";
import { LogWorkModal } from "../components/LogWork";
import { Card, Chip, ErrorBanner, Loading, SlaChip, StatusChip } from "../components/ui";

export default function MyWork() {
  const [project, setProject] = useState<string>("");
  const [sort, setSort] = useState<"due" | "project" | "priority">("due");
  const [logKey, setLogKey] = useState<string | null>(null);
  const nav = useNavigate();
  const q = useQuery({ queryKey: ["my-work", project], queryFn: () => api(`/my-work${project ? `?projectId=${project}` : ""}`) });
  const all = useQuery({ queryKey: ["my-work", ""], queryFn: () => api("/my-work"), enabled: !!project });
  if (q.isLoading) return <Loading />;
  if (q.isError) return <ErrorBanner error={q.error} />;
  const d = q.data;
  const cards = (project ? all.data?.projects : d.projects) ?? d.projects;
  const net = d.netCapacityMinutes || 1;
  const prio: Record<string, number> = { P1: 0, highest: 0, P2: 1, high: 1, P3: 2, medium: 2, P4: 3, low: 3, lowest: 4 };
  const assigned = [...d.assigned].sort((a: any, b: any) =>
    sort === "project" ? a.projectName.localeCompare(b.projectName)
      : sort === "priority" ? (prio[a.priority] ?? 9) - (prio[b.priority] ?? 9)
        : (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"));

  return (
    <>
      <div className="between">
        <div>
          <h1>My work</h1>
          <div className="muted">Across {cards.length} projects · week {isoWeek(d.weekStart)}, {fmtDay(d.weekStart)} – {fmtDay(addDays(d.weekStart, 6))}</div>
        </div>
        <div className="seg" role="group" aria-label="Project scope">
          <button className={!project ? "on" : ""} onClick={() => setProject("")}>All my projects</button>
          {cards.map((c: any) => (
            <button key={c.project.id} className={project === c.project.id ? "on" : ""} onClick={() => setProject(c.project.id)}>{c.project.name}</button>
          ))}
        </div>
      </div>

      {d.pendingApprovals.count > 0 && (
        <div className="banner info row" style={{ justifyContent: "space-between" }}>
          <span>{d.pendingApprovals.count} timesheet submission(s) · {mins(d.pendingApprovals.minutes)} waiting for your approval</span>
          <Link to="/timesheets/approvals" className="btn sm">Review approvals</Link>
        </div>
      )}

      <Card title="This week's load, split by project" extra={`Net capacity ${mins(d.netCapacityMinutes)} · allocated ${mins(d.allocatedMinutes)} · logged ${mins(d.loggedMinutes)}`}>
        <div className="legend" style={{ marginBottom: 10 }}>
          <span><i style={{ background: "var(--primary)" }} />Allocated</span>
          <span><i style={{ background: "var(--text)", height: 3 }} />Logged</span>
        </div>
        <div className="stack-sm">
          {cards.map((c: any) => (
            <div key={c.project.id} className="row" style={{ alignItems: "center" }}>
              <span style={{ width: 170 }} className="small">{c.project.name}</span>
              <div className="grow">
                <div className="bar" style={{ width: `${Math.min((c.allocatedMinutes / net) * 100, 100)}%`, minWidth: 4 }}><span style={{ width: "100%", background: c.project.color }} /></div>
                <div className="actual-line" style={{ width: `${Math.min((c.loggedMinutes / net) * 100, 100)}%`, minWidth: 2 }}><span style={{ width: "100%" }} /></div>
              </div>
              <span className="mono small nowrap" style={{ width: 150, textAlign: "right" }}>{mins(c.allocatedMinutes)} · {mins(c.loggedMinutes)}</span>
            </div>
          ))}
        </div>
        <div className="subtle" style={{ marginTop: 10 }}>Bar width = share of {mins(d.netCapacityMinutes)} net capacity. Logged time is shown next to the allocation, never inside it.</div>
      </Card>

      <div className="grid-3">
        {cards.map((c: any) => {
          const delta = c.deltaMinutes;
          return (
            <section key={c.project.id} className="card card-pad stack-sm">
              <div className="between">
                <div>
                  <h3>{c.project.name}</h3>
                  <div className="subtle">{c.context}</div>
                </div>
                <Chip>{c.project.key}</Chip>
              </div>
              <dl className="kv" style={{ gridTemplateColumns: "1fr 1fr" }}>
                <div><dt>My role</dt><dd>{roleLabel(c.role)}{c.isTimeApprover ? " · approver" : ""}</dd></div>
                <div><dt>Time approver</dt><dd>{c.approvers.join(", ") || "—"}</dd></div>
                <div><dt>Allocated · W{isoWeek(d.weekStart)}</dt><dd className="mono">{mins(c.allocatedMinutes)}</dd></div>
                <div><dt>Logged · W{isoWeek(d.weekStart)}</dt><dd className="mono">{mins(c.loggedMinutes)}</dd></div>
              </dl>
              <div className={`small ${delta > 0 ? "tone-warning" : "muted"}`}>
                {c.allocatedMinutes === 0 ? "No allocation this week"
                  : delta > 0 ? `Over allocation by ${mins(delta)}`
                    : delta < 0 ? `${mins(-delta)} of allocation unused` : "On allocation"}
              </div>
              <div className="row">
                <Link className="btn sm" to={c.project.kind === "service" ? "/service" : `/projects/${c.project.id}/board`}>
                  {c.project.kind === "service" ? "Open queue" : "Open board"}
                </Link>
                <span className="subtle">· {c.openAssigned} open assigned to me</span>
              </div>
            </section>
          );
        })}
      </div>

      <Card title={`Assigned to me · ${assigned.length}`} pad={false}
            extra={<span className="row">Sort <select className="input" style={{ height: 32, width: 120 }} value={sort} onChange={(e) => setSort(e.target.value as any)}>
              <option value="due">Due date</option><option value="project">Project</option><option value="priority">Priority</option></select></span>}>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Project</th><th>Key</th><th>Title</th><th>Status</th><th>Due</th><th className="right">Remaining</th><th /></tr></thead>
            <tbody>
              {assigned.map((i: any) => (
                <tr key={i.id} className="clickable" onClick={() => nav(`/work-items/${i.key}`)}>
                  <td className="small">{i.projectName}</td>
                  <td className="key">{i.key}</td>
                  <td>{i.title}<div className="subtle">{i.typeLabel}{i.sla ? ` · ${i.priority}` : ""}</div></td>
                  <td><StatusChip name={i.statusName} category={i.statusCategory} />{i.sla?.state === "paused" && <> <SlaChip sla={i.sla} /></>}</td>
                  <td className="nowrap small">{i.sla && i.sla.state !== "paused" && i.sla.state !== "none" ? i.sla.label : fmtDay(i.dueDate)}</td>
                  <td className="num">{mins(i.remainingEstimateMinutes)}</td>
                  <td className="right"><button className="btn sm" onClick={(e) => { e.stopPropagation(); setLogKey(i.key); }}>Log work</button></td>
                </tr>
              ))}
              {assigned.length === 0 && <tr><td colSpan={7} className="empty">Nothing assigned to you.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="How multi-project work behaves">
        <div className="grid-3 small">
          <div><strong>Roles are per project</strong><div className="muted">Membership sets what you can see and do. You can be a contributor in one project and a service agent in another.</div></div>
          <div><strong>Time follows the ticket</strong><div className="muted">Each entry belongs to exactly one ticket, and so to one project. It counts once, toward that project only.</div></div>
          <div><strong>One timesheet, many approvers</strong><div className="muted">Submit one timesheet per period, grouped by project. Each project's entries go to that project's approver.</div></div>
        </div>
      </Card>
      {logKey && <LogWorkModal itemKey={logKey} onClose={() => setLogKey(null)} />}
    </>
  );
}
