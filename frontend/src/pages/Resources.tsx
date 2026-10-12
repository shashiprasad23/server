import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, post } from "../lib/api";
import { addDays, hours, isoDay, mins, mondayOf, pct } from "../lib/format";
import { useCan, useMe } from "../lib/session";
import { Avatar, Card, Chip, ErrorBanner, Field, Loading, Modal, useToast } from "../components/ui";

export default function Resources() {
  const can = useCan();
  const [start, setStart] = useState(addDays(mondayOf(isoDay(new Date())), -7));
  const [skill, setSkill] = useState("");
  const [weeks, setWeeks] = useState(4);
  const [selected, setSelected] = useState<string | null>(null);
  const [alloc, setAlloc] = useState<any>(null);
  const [leave, setLeave] = useState(false);
  const q = useQuery({ queryKey: ["capacity", start, weeks, skill], queryFn: () => api(`/resources/capacity?from=${start}&weeks=${weeks}${skill ? `&skill=${encodeURIComponent(skill)}` : ""}`) });
  const profiles = useQuery({ queryKey: ["profiles"], queryFn: () => api("/resources/profiles") });
  if (q.isLoading) return <Loading />;
  if (q.isError) return <ErrorBanner error={q.error} />;
  const g = q.data;
  const skills = [...new Set<string>((profiles.data ?? []).flatMap((p: any) => p.skills))].sort();
  const person = g.rows.find((r: any) => r.user.id === selected) ?? g.rows[0];

  return (
    <>
      <div className="crumbs">Resources · Capacity</div>
      <div className="between">
        <h1>Capacity · {g.weeks[0]?.label.split(" · ")[0]} – {g.weeks[g.weeks.length - 1]?.label.split(" · ")[0]}</h1>
        <div className="row">
          <span className="small" style={{ fontWeight: 600 }}>Skill</span>
          <select className="input" style={{ width: 170 }} value={skill} onChange={(e) => setSkill(e.target.value)}><option value="">All skills</option>{skills.map((s) => <option key={s}>{s}</option>)}</select>
          <button className="btn" aria-label="Earlier" onClick={() => setStart(addDays(start, -7))}>‹</button>
          <button className="btn" aria-label="Later" onClick={() => setStart(addDays(start, 7))}>›</button>
          <div className="seg"><button className={weeks === 4 ? "on" : ""} onClick={() => setWeeks(4)}>4 weeks</button><button className={weeks === 8 ? "on" : ""} onClick={() => setWeeks(8)}>8 weeks</button></div>
          <button className="btn" onClick={() => setLeave(true)}>Record leave</button>
          <button className="btn primary" onClick={() => setAlloc({})}>New allocation</button>
        </div>
      </div>
      <div className="legend">
        <span><i style={{ border: "1px solid var(--border-strong)", background: "#fff" }} />Net capacity</span>
        <span><i style={{ background: "var(--primary)" }} />Planned allocation</span>
        <span><i style={{ background: "var(--over)" }} />Over-allocated</span>
        <span><i style={{ background: "var(--text)", height: 3 }} />Actual effort (logged)</span>
        <span>Three separate measures — logged time never fills an allocation.</span>
      </div>

      <div className="grid-2" style={{ gridTemplateColumns: "minmax(0, 1fr) 340px" }}>
        <section className="card table-wrap">
          <table className="table" style={{ minWidth: 760 }}>
            <thead><tr><th>Person · skills</th>{g.weeks.map((w: any) => <th key={w.weekStart}>{w.label}</th>)}</tr></thead>
            <tbody>
              {g.rows.map((r: any) => (
                <tr key={r.user.id} className="clickable" onClick={() => setSelected(r.user.id)} style={person?.user.id === r.user.id ? { background: "#f7f8fd" } : undefined}>
                  <td style={{ minWidth: 190 }}>
                    <div className="row" style={{ flexWrap: "nowrap" }}><Avatar initials={r.user.initials} />
                      <div><strong>{r.user.name}</strong><div className="subtle">{r.profile.title}{r.profile.skills.length ? ` · ${r.profile.skills.join(", ")}` : ""}</div></div></div>
                  </td>
                  {r.weeks.map((c: any) => <CapacityCell key={c.weekStart} c={c} />)}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><td>Team total</td>{g.teamTotals.map((t: any) => <td key={t.weekStart} className="mono small">{hours(t.planned)} / {hours(t.net)} · {pct(t.ratio === null ? null : t.ratio * 100)}</td>)}</tr>
            </tfoot>
          </table>
        </section>

        <div className="stack">
          {person && (
            <section className="card emph card-pad stack-sm">
              <h2>{person.user.name} · allocation by project</h2>
              <div className="subtle">One person, {new Set(person.weeks.flatMap((w: any) => w.byProject.map((b: any) => b.key))).size} projects, one net capacity</div>
              <div className="legend" style={{ gap: 10 }}>
                {[...new Map(person.weeks.flatMap((w: any) => w.byProject.map((b: any) => [b.key, b]))).values()].map((b: any) => (
                  <span key={b.key}><i style={{ background: b.color, width: 10 }} />{b.name}</span>
                ))}
              </div>
              {person.weeks.map((w: any) => {
                const total = Math.max(w.net, w.planned, 1);
                return (
                  <div key={w.weekStart}>
                    <div className="between small"><strong>W{w.week}</strong>
                      <span className="mono">{w.byProject.map((b: any) => hours(b.planned + b.tentative)).join(" + ") || "0h"} = {hours(w.planned)} / {hours(w.net)}</span></div>
                    <div className="stack-bar" style={{ marginTop: 4 }}>
                      {w.byProject.map((b: any) => <span key={b.key} title={`${b.name} ${hours(b.planned)}`} style={{ width: `${(b.planned / total) * 100}%`, background: b.color }} />)}
                    </div>
                  </div>
                );
              })}
              <div className="subtle">Select anyone in the grid to see their split. Each project manager allocates only within their own project; the total is checked here.</div>
            </section>
          )}
          <Card title={`Conflicts · ${g.conflicts.length}`}>
            <div className="stack">
              {g.conflicts.length === 0 && <div className="muted">No conflicts in this window.</div>}
              {g.conflicts.map((c: any, i: number) => (
                <div key={i} className="stack-sm" style={{ borderTop: i ? "1px solid var(--border)" : undefined, paddingTop: i ? 12 : 0 }}>
                  <div><Chip tone={c.kind === "skills_gap" ? "neutral" : c.kind === "leave_conflict" ? "danger" : "warning"}>
                    {{ leave_conflict: "Leave conflict", over_allocated: "Over-allocated", skills_gap: "Skills gap" }[c.kind as string]}</Chip></div>
                  <strong>{c.title}</strong>
                  <div className="small muted">{c.detail}</div>
                </div>
              ))}
            </div>
          </Card>
          <Card title="How the numbers work">
            <div className="small stack-sm">
              <div><strong>Net capacity</strong> = {g.definitions.netCapacity}</div>
              <div><strong>Allocation ratio</strong> = {g.definitions.allocationRatio}</div>
              <div><strong>Utilization</strong> = {g.definitions.utilization}</div>
            </div>
          </Card>
          {can.resourceManager && <ProfilesCard profiles={profiles.data ?? []} />}
        </div>
      </div>
      {alloc && <AllocationModal onClose={() => setAlloc(null)} rows={g.rows} />}
      {leave && <LeaveModal onClose={() => setLeave(false)} rows={g.rows} />}
    </>
  );
}

function CapacityCell({ c }: { c: any }) {
  const over = c.flags.some((f: any) => f.kind === "over_allocated");
  const under = c.flags.some((f: any) => f.kind === "under_allocated");
  const ratio = c.allocationRatio;
  const fill = c.net ? Math.min(c.planned / c.net, 1) * 100 : c.planned ? 100 : 0;
  const actual = c.net ? Math.min(c.actual / c.net, 1) * 100 : 0;
  const note = c.leaveDays.length ? `Leave ${c.leaveDays.length}d` : c.holidays.length ? c.holidays[0].reason : "";
  return (
    <td style={{ minWidth: 150 }} title={`Net ${mins(c.net)} · planned ${mins(c.planned)}${c.tentative ? ` (+${mins(c.tentative)} tentative)` : ""} · actual ${mins(c.actual)} · utilization ${pct(c.utilization === null ? null : c.utilization * 100)}`}>
      <div className="between mono small" style={{ gap: 6 }}>
        <span>{hours(c.planned)} / {hours(c.net)}</span>
        <strong className={over ? "tone-warning" : ""}>{ratio === null ? (c.planned ? "∞" : "N/A") : `${Math.round(ratio * 100)}%`}</strong>
      </div>
      <div className={`bar ${over ? "over" : ""}`} style={{ marginTop: 4 }}><span style={{ width: `${fill}%` }} /></div>
      {c.actual > 0 && <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}><div className="actual-line grow"><span style={{ width: `${actual}%` }} /></div><span className="subtle mono">act {hours(c.actual)}</span></div>}
      {over && <div className="small tone-warning" style={{ fontWeight: 600 }}>{note ? `${note} · ` : ""}{c.flags[0].label.toLowerCase().replace("over by", "over by")}</div>}
      {!over && note && <div className="small muted">{note}</div>}
      {under && <div className="small tone-warning">Under-allocated</div>}
    </td>
  );
}

function AllocationModal({ onClose, rows }: { onClose: () => void; rows: any[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const me = useMe();
  const can = useCan();
  const projects = useQuery({ queryKey: ["projects"], queryFn: () => api("/projects") });
  const monday = mondayOf(isoDay(new Date()));
  const [f, setF] = useState({ userId: rows[0]?.user.id ?? "", projectId: "", startDate: monday, endDate: addDays(monday, 13), unit: "hours", hoursPerWeek: "8", percent: "20", state: "confirmed", role: "" });
  const [error, setError] = useState<any>(null);
  const allowed = (projects.data ?? []).filter((p: any) => can.resourceManager || can.manages(p.id));
  const save = async () => {
    try {
      await post("/allocations", { ...f, hoursPerWeek: Number(f.hoursPerWeek), percent: Number(f.percent) });
      toast("Allocation saved; capacity recalculated");
      qc.invalidateQueries();
      onClose();
    } catch (e) { setError(e); }
  };
  return (
    <Modal title="New allocation" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Save allocation</button></>}>
      <ErrorBanner error={error} />
      {allowed.length === 0 && <div className="banner warning">Only project managers (for their project) and resource managers can allocate people. Signed in as {me.name}.</div>}
      <div className="grid-cols">
        <Field label="Person"><select className="input" value={f.userId} onChange={(e) => setF({ ...f, userId: e.target.value })}>{rows.map((r) => <option key={r.user.id} value={r.user.id}>{r.user.name}</option>)}</select></Field>
        <Field label="Project" error={error?.errors?.projectId}><select className="input" value={f.projectId} onChange={(e) => setF({ ...f, projectId: e.target.value })}><option value="">Choose…</option>{allowed.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        <Field label="From" error={error?.errors?.startDate}><input className="input" type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></Field>
        <Field label="To" error={error?.errors?.endDate}><input className="input" type="date" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></Field>
        <Field label="Unit"><select className="input" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })}><option value="hours">Hours per week</option><option value="percent">Percent of capacity</option></select></Field>
        {f.unit === "hours"
          ? <Field label="Hours per week" error={error?.errors?.hoursPerWeek}><input className="input" type="number" value={f.hoursPerWeek} onChange={(e) => setF({ ...f, hoursPerWeek: e.target.value })} /></Field>
          : <Field label="Percent" error={error?.errors?.percent}><input className="input" type="number" value={f.percent} onChange={(e) => setF({ ...f, percent: e.target.value })} /></Field>}
        <Field label="State"><select className="input" value={f.state} onChange={(e) => setF({ ...f, state: e.target.value })}><option value="confirmed">Confirmed</option><option value="tentative">Tentative</option></select></Field>
        <Field label="Role"><input className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function LeaveModal({ onClose, rows }: { onClose: () => void; rows: any[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const can = useCan();
  const me = useMe();
  const [f, setF] = useState({ userId: me.id, startDate: isoDay(new Date()), endDate: isoDay(new Date()), reason: "" });
  const [error, setError] = useState<any>(null);
  const save = async () => {
    try {
      const r = await post("/leaves", f);
      toast(r.state === "approved" ? "Leave recorded; net capacity updated" : "Leave requested; a resource manager will approve it");
      qc.invalidateQueries();
      onClose();
    } catch (e) { setError(e); }
  };
  return (
    <Modal title="Record leave" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Save</button></>}>
      <ErrorBanner error={error} />
      {can.resourceManager && <Field label="Person"><select className="input" value={f.userId} onChange={(e) => setF({ ...f, userId: e.target.value })}>{rows.map((r) => <option key={r.user.id} value={r.user.id}>{r.user.name}</option>)}</select></Field>}
      <div className="row"><Field label="From"><input className="input" type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></Field>
        <Field label="To" error={error?.errors?.endDate}><input className="input" type="date" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></Field></div>
      <Field label="Reason" help="Only what planning needs — no sensitive HR detail"><input className="input" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
    </Modal>
  );
}

function ProfilesCard({ profiles }: { profiles: any[] }) {
  return (
    <Card title="Resource pool">
      <div className="stack-sm small">
        {profiles.filter((p) => p.title).map((p) => (
          <div key={p.userId} className="between"><span>{p.name}</span><span className="muted">{p.skills.join(", ") || "—"}</span></div>
        ))}
      </div>
    </Card>
  );
}
