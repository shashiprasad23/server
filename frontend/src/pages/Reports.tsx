import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, download } from "../lib/api";
import { fmtDateTime, fmtDay, isoDay, mins, mondayOf, pct, signedMins } from "../lib/format";
import { Card, Chip, ErrorBanner, Field, Loading, Stat, useToast, errorText } from "../components/ui";

type Tab = "eva" | "compliance" | "health" | "service" | "ai";

export default function Reports() {
  const [tab, setTab] = useState<Tab>("eva");
  return (
    <>
      <div className="crumbs">Reports</div>
      <h1>Reports</h1>
      <div className="tabs card" style={{ padding: "0 8px" }}>
        {([["eva", "Estimate vs actual"], ["compliance", "Timesheet compliance"], ["health", "Project health"], ["service", "Service performance"], ["ai", "AI meeting actions"]] as const).map(([k, l]) => (
          <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === "eva" && <EstimateVsActual />}
      {tab === "compliance" && <Compliance />}
      {tab === "health" && <Health />}
      {tab === "service" && <Service />}
      {tab === "ai" && <AiActions />}
    </>
  );
}

function Meta({ r }: { r: any }) {
  return <div className="subtle">Last refreshed {fmtDateTime(r.refreshedAt)} · {r.mode === "real-time" ? "near-real-time read model" : "asynchronous"} · {r.timezone} · policy: {r.policyLabel}</div>;
}

function EstimateVsActual() {
  const toast = useToast();
  const projects = useQuery({ queryKey: ["projects"], queryFn: () => api("/projects") });
  const delivery = (projects.data ?? []).filter((p: any) => p.kind === "delivery");
  const [projectId, setProjectId] = useState<string>("");
  const pid = projectId || delivery[0]?.id;
  const project = useQuery({ queryKey: ["project", pid], queryFn: () => api(`/projects/${pid}`), enabled: !!pid, retry: false });
  const [sprintId, setSprintId] = useState("");
  const [type, setType] = useState("");
  const [policy, setPolicy] = useState("approved_submitted");
  const sid = sprintId || project.data?.sprints.find((s: any) => s.state === "active")?.id || "";
  const qs = `projectId=${pid}${sid ? `&sprintId=${sid}` : ""}${type ? `&type=${type}` : ""}&policy=${policy}`;
  const q = useQuery({ queryKey: ["eva", qs], queryFn: () => api(`/reports/estimate-vs-actual?${qs}`), enabled: !!pid });
  if (!pid) return <Card><div className="empty">No delivery projects you can report on.</div></Card>;
  const r = q.data;
  const maxType = Math.max(1, ...(r?.byType ?? []).flatMap((t: any) => [t.original, t.actual]));
  return (
    <>
      <div className="between">
        <div><h2>Estimate vs actual{r ? ` · ${r.project.name}${r.sprint ? `, ${r.sprint.name}` : ""}` : ""}</h2>{r && <Meta r={r} />}</div>
        <button className="btn" disabled={!r || r.detailRestricted} onClick={() => download(`/reports/estimate-vs-actual?${qs}&format=csv`, "estimate-vs-actual.csv").catch((e) => toast(errorText(e), true))}>Export CSV</button>
      </div>
      <div className="row" style={{ alignItems: "flex-end" }}>
        <Field label="Project"><select className="input" value={pid} onChange={(e) => { setProjectId(e.target.value); setSprintId(""); }}>{delivery.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        <Field label="Sprint"><select className="input" value={sid} onChange={(e) => setSprintId(e.target.value)}><option value="">All work</option>{project.data?.sprints.filter((s: any) => s.state !== "planned").map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field label="Ticket type"><select className="input" value={type} onChange={(e) => setType(e.target.value)}><option value="">All types</option>{["story", "task", "subtask", "bug", "test_task"].map((t) => <option key={t} value={t}>{t.replace("_", " ")}</option>)}</select></Field>
        <Field label="Approval policy"><select className="input" value={policy} onChange={(e) => setPolicy(e.target.value)}><option value="approved_submitted">Approved + submitted</option><option value="approved">Approved only</option><option value="all_valid">All valid (incl. draft)</option></select></Field>
      </div>
      {q.isLoading && <Loading />}
      {q.isError && <ErrorBanner error={q.error} />}
      {r && (
        <>
          <div className="grid-cols">
            <Stat label="Original estimate" value={mins(r.totals.original)} hint="Baseline at sprint start" />
            <Stat label="Actual effort" value={mins(r.totals.actual)} hint="From valid time entries" />
            <Stat label="Variance" value={signedMins(r.totals.variance)} hint={r.totals.variancePct === null ? "" : `${Math.abs(r.totals.variancePct).toFixed(1)}% ${r.totals.variance < 0 ? "under" : "over"} original`} tone={r.totals.variance > 0 ? "warning" : "success"} />
            <Stat label="Tickets with estimate" value={pct(r.totals.estimateCoverage.pct)} hint={`${r.totals.estimateCoverage.withEstimate} of ${r.totals.estimateCoverage.eligible} · target ≥ 95%`} tone={(r.totals.estimateCoverage.pct ?? 0) >= 95 ? "success" : "warning"} />
          </div>
          <div className="grid-3" style={{ gridTemplateColumns: "minmax(300px, 1fr) minmax(300px, 2fr)" }}>
            <Card title="By ticket type">
              <div className="legend" style={{ marginBottom: 10 }}><span><i style={{ background: "#b9c4ee" }} />Original estimate</span><span><i style={{ background: "var(--primary)" }} />Actual</span></div>
              <div className="stack-sm">
                {r.byType.map((t: any) => (
                  <div key={t.type}>
                    <div className="between small"><strong>{t.label}</strong><span className="mono">{mins(t.original)} → {mins(t.actual)} <span className={t.variance > 0 ? "tone-warning" : "tone-success"}>{signedMins(t.variance)}</span></span></div>
                    <div style={{ height: 6, background: "#b9c4ee", width: `${(t.original / maxType) * 100}%`, borderRadius: 2, marginTop: 4 }} />
                    <div style={{ height: 6, background: "var(--primary)", width: `${(t.actual / maxType) * 100}%`, borderRadius: 2, marginTop: 2 }} />
                  </div>
                ))}
              </div>
            </Card>
            <Card title="Time by ticket · hierarchy" extra="Each entry counted once · rejected and draft entries excluded per policy" pad={false}>
              {r.detailRestricted ? <div className="empty">Ticket-level detail needs project access. Aggregates above are shown for your portfolio role.</div> : (
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>Work item</th><th className="right">Original</th><th className="right">Remaining</th><th className="right">Direct</th><th className="right">Descendants</th><th className="right">Total actual</th></tr></thead>
                    <tbody>
                      {r.rows.map((x: any) => (
                        <tr key={x.key}>
                          <td style={{ paddingLeft: 16 + x.depth * 20 }}><Link className="key" to={`/work-items/${x.key}`}>{x.key}</Link> <span className="muted small">{x.typeLabel} · {x.title}</span></td>
                          <td className="num">{mins(x.original)}</td><td className="num">{mins(x.remaining)}</td><td className="num">{mins(x.direct)}</td>
                          <td className="num muted">{x.descendants ? mins(x.descendants) : "—"}</td><td className="num" style={{ fontWeight: 600 }}>{mins(x.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>
        </>
      )}
    </>
  );
}

function Compliance() {
  const toast = useToast();
  const [week, setWeek] = useState(mondayOf(isoDay(new Date(Date.now() - 7 * 86400000))));
  const q = useQuery({ queryKey: ["compliance", week], queryFn: () => api(`/reports/timesheet-compliance?week=${week}`) });
  if (!q.data) return <Loading />;
  const r = q.data;
  return (
    <>
      <div className="between">
        <div><h2>Timesheet compliance · week of {fmtDay(r.weekStart)}</h2><Meta r={r} /></div>
        <div className="row"><input className="input" type="date" value={week} onChange={(e) => setWeek(mondayOf(e.target.value))} aria-label="Week" />
          <button className="btn" onClick={() => download(`/reports/timesheet-compliance?week=${week}&format=csv`, "timesheet-compliance.csv").catch((e) => toast(errorText(e), true))}>Export CSV</button></div>
      </div>
      <Card pad={false} title={`Target ≥ ${r.target}% submitted`} extra={`Team submitted ${pct(r.team.submittedPct)} of expected`}>
        <table className="table">
          <thead><tr><th>Person</th><th className="right">Logged / expected</th><th className="right">Missing days</th><th className="right">Rejected</th><th>Period</th></tr></thead>
          <tbody>
            {r.rows.map((x: any) => (
              <tr key={x.user.id}><td>{x.user.name}</td><td className="num">{mins(x.logged)} / {mins(x.expected)}</td>
                <td className={`num ${x.missingDays ? "tone-warning" : ""}`}>{x.missingDays}</td><td className={`num ${x.rejected ? "tone-danger" : ""}`}>{x.rejected}</td>
                <td><Chip tone={({ approved: "success", submitted: "info", locked: "dark" } as any)[x.periodState]}>{x.periodState[0].toUpperCase() + x.periodState.slice(1)}</Chip></td></tr>
            ))}
            {r.rows.length === 0 && <tr><td colSpan={5} className="empty">You don't approve or manage anyone's time.</td></tr>}
          </tbody>
          <tfoot><tr><td>Team</td><td className="num">{mins(r.team.logged)}</td><td className="num">{r.team.missingDays}</td><td className="num">{r.team.rejected}</td><td>{pct(r.team.loggedPct)} of expected</td></tr></tfoot>
        </table>
      </Card>
    </>
  );
}

function Health() {
  const q = useQuery({ queryKey: ["health"], queryFn: () => api("/reports/project-health") });
  if (!q.data) return <Loading />;
  return (
    <>
      <Meta r={q.data} />
      <div className="grid-3">
        {q.data.projects.map((p: any) => (
          <Card key={p.project.id} title={p.project.name} extra={p.activeSprint ? `${p.activeSprint.name} ends ${fmtDay(p.activeSprint.endDate)}` : p.project.kind}>
            <div className="grid-cols" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <Stat label="Progress" value={pct(p.progressPct)} hint={`${p.done} done · ${p.open} open`} />
              <Stat label="Overdue" value={p.overdue} tone={p.overdue ? "danger" : undefined} />
              <Stat label="Blocked" value={p.blocked} />
              <Stat label="Scope change" value={p.scopeChangeItems} hint="items this sprint" />
            </div>
            {p.risks.length > 0 && <div className="stack-sm" style={{ marginTop: 12 }}><strong className="small">Risks from published meetings</strong>{p.risks.map((r: string, i: number) => <div key={i} className="small muted">• {r}</div>)}</div>}
          </Card>
        ))}
      </div>
    </>
  );
}

function Service() {
  const q = useQuery({ queryKey: ["service-perf"], queryFn: () => api("/reports/service-performance") });
  if (!q.data) return <Loading />;
  return (
    <>
      <Meta r={q.data} />
      {q.data.services.length === 0 && <Card><div className="empty">No service queues in your scope.</div></Card>}
      {q.data.services.map((s: any) => (
        <Card key={s.project.id} title={s.project.name}>
          <div className="grid-cols">
            <Stat label="Open backlog" value={s.openBacklog} hint={Object.entries(s.byPriority).map(([k, v]) => `${k}: ${v}`).join(" · ")} />
            <Stat label="Response SLA met" value={pct(s.responseMetPct)} />
            <Stat label="Resolution SLA met" value={pct(s.resolutionMetPct)} />
            <Stat label="Breaches" value={s.breaches} tone={s.breaches ? "danger" : undefined} />
            <Stat label="Pauses (audited)" value={s.pauses} />
          </div>
          <div className="row" style={{ marginTop: 12 }}>{Object.entries(s.aging).map(([k, v]) => <Chip key={k}>Age {k}: {v as number}</Chip>)}</div>
        </Card>
      ))}
    </>
  );
}

function AiActions() {
  const q = useQuery({ queryKey: ["ai-report"], queryFn: () => api("/reports/ai-actions") });
  if (!q.data) return <Loading />;
  const r = q.data;
  return (
    <>
      <Meta r={r} />
      <div className="grid-cols">
        <Stat label="Proposals" value={r.proposals} hint={`${r.pending} awaiting review`} />
        <Stat label="Approval rate" value={pct(r.approvalRatePct)} hint={`${r.approved} approved · ${r.rejected} rejected`} />
        <Stat label="Approved with owner + date" value={pct(r.ownerAndDueDatePct)} hint="target ≥ 90%" />
        <Stat label="Overdue actions" value={r.overdueActions.length} tone={r.overdueActions.length ? "warning" : undefined} />
        <Stat label="Unresolved questions" value={r.unresolvedDecisions} hint="from published summaries" />
      </div>
      <Card title="AI quality and operations">
        <div className="grid-cols">
          <Stat label="Meetings processed" value={r.quality.meetings} />
          <Stat label="Failed" value={r.quality.failed} />
          <Stat label="Retries" value={r.quality.retries} />
          <Stat label="Avg processing" value={r.quality.avgProcessingMs === null ? "—" : `${Math.round(r.quality.avgProcessingMs)} ms`} />
          <Stat label="Reviewer edits" value={r.quality.edited} />
        </div>
        <div className="subtle" style={{ marginTop: 10 }}>Models and prompt versions: {r.quality.models.join(" · ") || "—"}</div>
      </Card>
      {r.overdueActions.length > 0 && (
        <Card title="Overdue actions from meetings" pad={false}>
          <table className="table"><tbody>{r.overdueActions.map((a: any) => <tr key={a.key}><td className="key"><Link to={`/work-items/${a.key}`}>{a.key}</Link></td><td>{a.title}</td><td className="num">{fmtDay(a.dueDate)}</td></tr>)}</tbody></table>
        </Card>
      )}
    </>
  );
}
