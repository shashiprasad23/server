import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, post } from "../lib/api";
import { addDays, fmtDay, isoDay, isoWeek, mins, mondayOf, parseDay } from "../lib/format";
import { useCan } from "../lib/session";
import { Chip, EntryChip, ErrorBanner, Loading, Modal, Stat, useToast } from "../components/ui";
import { LogWorkModal } from "../components/LogWork";

const DAY = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric" });

export default function Timesheet() {
  const [params, setParams] = useSearchParams();
  const can = useCan();
  const qc = useQueryClient();
  const toast = useToast();
  const start = mondayOf(params.get("week") ?? isoDay(new Date()));
  const [view, setView] = useState<"weekly" | "daily">("weekly");
  const [day, setDay] = useState(isoDay(new Date()));
  const [cell, setCell] = useState<any>(null);
  const [logKey, setLogKey] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<ApiError | null>(null);
  const q = useQuery({ queryKey: ["timesheet", start], queryFn: () => api(`/timesheets/week?start=${start}`) });
  if (q.isLoading) return <Loading />;
  if (q.isError) return <ErrorBanner error={q.error} />;
  const t = q.data;
  const s = t.summary;
  const locked = t.period.state === "locked";

  const submit = async (confirmMissing = false) => {
    try {
      const r = await post("/timesheets/submit", { weekStart: start, confirmMissing });
      toast(`Submitted ${r.submitted} entr${r.submitted === 1 ? "y" : "ies"} — each project's approver has been notified`);
      setSubmitError(null);
      qc.invalidateQueries();
    } catch (e) {
      setSubmitError(e as ApiError);
    }
  };

  const days = t.days as any[];
  const stateChip = { open: ["Open", "info"], submitted: ["Submitted", "info"], approved: ["Approved", "success"], locked: ["Locked", "dark"] } as any;

  return (
    <>
      <div className="between">
        <div className="stack-sm">
          <h1>My timesheet</h1>
          <div className="row">
            <strong>Week {isoWeek(start)} · {fmtDay(start)} – {fmtDay(addDays(start, 6))}</strong>
            <Chip tone={stateChip[t.period.state]?.[1]}>{stateChip[t.period.state]?.[0]}{t.period.state === "open" ? ` · due ${fmtDay(t.dueDate)}, 18:00` : ""}</Chip>
          </div>
        </div>
        <div className="row">
          {can.approver && <Link to="/timesheets/approvals" className="btn">Approvals queue</Link>}
          <div className="seg"><button className={view === "daily" ? "on" : ""} onClick={() => setView("daily")}>Daily</button><button className={view === "weekly" ? "on" : ""} onClick={() => setView("weekly")}>Weekly</button></div>
          <button className="btn" aria-label="Previous week" onClick={() => setParams({ week: addDays(start, -7) })}>‹</button>
          <button className="btn" aria-label="Next week" onClick={() => setParams({ week: addDays(start, 7) })}>›</button>
          <button className="btn primary" disabled={locked} onClick={() => submit(false)}>Submit week</button>
        </div>
      </div>

      {submitError && (
        <div className="banner warning stack-sm" role="alert">
          <div>{submitError.message}</div>
          {submitError.code === "missing_time" && (
            <>
              <div className="small">{Object.entries(submitError.errors).map(([d, v]) => `${fmtDay(d)}: ${v.join(" ")}`).join(" · ")}</div>
              <div className="row"><button className="btn sm dark" onClick={() => submit(true)}>Submit anyway</button><button className="btn sm" onClick={() => setSubmitError(null)}>Log the missing time first</button></div>
            </>
          )}
        </div>
      )}
      {locked && <div className="banner info">This period is locked. Normal edits are rejected; request an amendment or ask an administrator for an audited reopen.</div>}

      <div className="grid-cols" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
        <Stat label="Logged" value={mins(s.logged)} />
        <Stat label="Expected" value={mins(s.expected)} />
        <Stat label="Missing" value={mins(s.missing)} tone={s.missing ? "warning" : undefined} />
        <Stat label="Approved" value={mins(s.approved)} tone="success" />
        <Stat label="Submitted" value={mins(s.submitted)} tone="info" />
        <Stat label="Draft" value={mins(s.draft)} />
        <Stat label="Rejected" value={mins(s.rejected)} tone={s.rejected ? "danger" : undefined} />
      </div>

      {view === "weekly" ? (
        <section className="card table-wrap">
          <table className="table" style={{ minWidth: 980 }}>
            <thead>
              <tr>
                <th>Project · ticket</th>
                {days.map((d) => (
                  <th key={d.date} className="right">
                    <div>{DAY.format(parseDay(d.date))}</div>
                    <div className={`tone-${d.status.tone}`} style={{ fontSize: 11 }}>{d.status.label}</div>
                  </th>
                ))}
                <th className="right">Total</th>
              </tr>
            </thead>
            <tbody>
              {t.groups.map((g: any) => (
                <GroupRows key={g.project.id} g={g} days={days} onCell={setCell} onLog={setLogKey} locked={locked} />
              ))}
              {t.groups.length === 0 && <tr><td colSpan={9} className="empty">No time logged this week. Open a ticket from My work and use Log work.</td></tr>}
            </tbody>
            <tfoot>
              <tr><td>Logged</td>{days.map((d) => <td key={d.date} className="num">{d.loggedMinutes ? mins(d.loggedMinutes) : "—"}</td>)}<td className="num">{mins(s.logged)}</td></tr>
              <tr><td className="muted" style={{ fontWeight: 400 }}>Expected (work calendar)</td>{days.map((d) => <td key={d.date} className="num muted" style={{ fontWeight: 400 }}>{d.expectedMinutes ? mins(d.expectedMinutes) : "—"}</td>)}<td className="num muted">{mins(s.expected)}</td></tr>
            </tfoot>
          </table>
        </section>
      ) : (
        <DailyView t={t} day={days.some((d) => d.date === day) ? day : days[0].date} setDay={setDay} onCell={setCell} />
      )}

      <div className="grid-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))" }}>
        {t.rejectedEntries.map((e: any) => (
          <section key={e.id} className="card card-pad stack-sm">
            <div className="row"><Chip tone="danger">Rejected</Chip><strong>{e.workItem.key} · {fmtDay(e.workDate)} · {mins(e.durationMinutes)}</strong></div>
            <div className="muted">Reason from approver: “{e.rejectionReason}”</div>
            <div className="row">
              <Link className="btn dark" to={`/work-items/${e.workItem.key}`}>Correct &amp; resubmit</Link>
              <button className="btn" onClick={async () => { await post(`/time-entries/${e.id}/void`, { reason: "Voided after rejection" }); qc.invalidateQueries(); toast("Entry voided"); }}>Void entry</button>
            </div>
          </section>
        ))}
        <section className="card card-pad stack-sm">
          <h3>Approval workflow</h3>
          <div className="row"><Chip>Draft</Chip>→<Chip tone="info">Submitted</Chip>→<Chip tone="success">Approved</Chip>→<Chip tone="dark">Locked</Chip></div>
          <div className="small muted"><strong>Rejected</strong> → corrected → resubmitted. The reason is mandatory. <strong>Approved</strong> entries change only through an amendment; the original stays auditable. <strong>Several projects</strong>: one submission, split by project — each approver sees only their project's entries.</div>
        </section>
      </div>
      {cell && <CellModal cell={cell} onClose={() => setCell(null)} onLog={() => { setLogKey(cell.row.workItem.key); setCell(null); }} locked={locked} />}
      {logKey && <LogWorkModal itemKey={logKey} onClose={() => setLogKey(null)} />}
    </>
  );
}

function cellClass(entries: any[]): string {
  const st = new Set(entries.map((e) => e.approvalStatus));
  if (st.has("rejected")) return "rejected";
  if (st.size === 1) return [...st][0] as string;
  return "mixed";
}

function GroupRows({ g, days, onCell, onLog, locked }: { g: any; days: any[]; onCell: (c: any) => void; onLog: (k: string) => void; locked: boolean }) {
  const over = g.loggedMinutes > g.allocatedMinutes && g.allocatedMinutes > 0;
  return (
    <>
      <tr className="group-row">
        <td colSpan={9}>
          <div className="between" style={{ alignItems: "center" }}>
            <span className="row"><i className="dot" style={{ background: g.project.color }} />{g.project.name} · {g.project.key}</span>
            <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>
              Logged <strong className={over ? "tone-warning" : ""}>{mins(g.loggedMinutes)}</strong> of {mins(g.allocatedMinutes)} allocated · Approver: <strong>{g.approvers.join(", ") || "—"}</strong>
            </span>
          </div>
        </td>
      </tr>
      {g.rows.map((r: any) => (
        <tr key={r.workItem.id}>
          <td style={{ minWidth: 240 }}>
            <Link to={`/work-items/${r.workItem.key}`} className="key">{r.workItem.key}</Link>{" "}
            <span className="subtle">{r.workItem.type.replace("_", " ")}</span>
            <div className="small">{r.workItem.title}</div>
          </td>
          {days.map((d) => {
            const c = r.cells[d.date];
            const entries = c.entries.filter((e: any) => e.approvalStatus !== "voided");
            return (
              <td key={d.date} style={{ padding: 4 }}>
                {entries.length ? (
                  <button className={`cell-entry ${cellClass(entries)}`} style={{ width: "100%", border: undefined, cursor: "pointer" }}
                          onClick={() => onCell({ row: r, date: d.date, entries })}
                          aria-label={`${r.workItem.key} ${d.date}: ${mins(c.minutes)}, ${entries.map((e: any) => e.approvalStatus).join(", ")}`}>
                    {mins(c.minutes || entries.reduce((a: number, e: any) => a + e.durationMinutes, 0))}
                  </button>
                ) : <span className="cell-entry muted" style={{ textAlign: "center" }}>—</span>}
              </td>
            );
          })}
          <td className="num" style={{ fontWeight: 600 }}>
            {mins(r.totalMinutes)}
            {!locked && <div><button className="btn link small" onClick={() => onLog(r.workItem.key)}>+ Log</button></div>}
          </td>
        </tr>
      ))}
      {g.rows.length === 0 && <tr><td colSpan={9} className="subtle">Allocated but no time logged on {g.project.name} this week.</td></tr>}
    </>
  );
}

function DailyView({ t, day, setDay, onCell }: { t: any; day: string; setDay: (d: string) => void; onCell: (c: any) => void }) {
  const rows = t.groups.flatMap((g: any) => g.rows.map((r: any) => ({ g, r, c: r.cells[day] }))).filter((x: any) => x.c.entries.length);
  const d = t.days.find((x: any) => x.date === day);
  return (
    <section className="card">
      <div className="tabs">{t.days.map((x: any) => <button key={x.date} className={x.date === day ? "on" : ""} onClick={() => setDay(x.date)}>{DAY.format(parseDay(x.date))}</button>)}</div>
      <div className="card-pad stack-sm">
        <div className="row"><strong>{fmtDay(day)}</strong><span className={`small tone-${d.status.tone}`}>{d.status.label}</span><span className="subtle">Logged {mins(d.loggedMinutes)} of {mins(d.expectedMinutes)} expected</span></div>
        {rows.length === 0 && <div className="muted">No entries on this day.</div>}
        {rows.flatMap(({ g, r, c }: any) => c.entries.map((e: any) => (
          <div key={e.id} className="row" style={{ borderTop: "1px solid var(--border)", paddingTop: 8 }}>
            <span className="small" style={{ width: 120 }}>{g.project.name}</span>
            <button className="btn link key" onClick={() => onCell({ row: r, date: day, entries: c.entries })}>{r.workItem.key}</button>
            <span className="grow small">{e.description}</span>
            <span className="small">{e.activityCategory}</span>
            <span className="mono">{mins(e.durationMinutes)}</span>
            <EntryChip status={e.approvalStatus} amendment={e.amendmentPending} />
          </div>
        )))}
      </div>
    </section>
  );
}

function CellModal({ cell, onClose, onLog, locked }: { cell: any; onClose: () => void; onLog: () => void; locked: boolean }) {
  return (
    <Modal title={`${cell.row.workItem.key} · ${fmtDay(cell.date)}`} onClose={onClose}
           footer={<><Link className="btn" to={`/work-items/${cell.row.workItem.key}`}>Open ticket</Link>{!locked && <button className="btn primary" onClick={onLog}>Log more time</button>}</>}>
      <div className="muted">{cell.row.workItem.title}</div>
      {cell.entries.map((e: any) => (
        <div key={e.id} className="stack-sm" style={{ borderTop: "1px solid var(--border)", paddingTop: 10 }}>
          <div className="row"><strong className="mono">{mins(e.durationMinutes)}</strong><span>{e.activityCategory}</span><EntryChip status={e.approvalStatus} amendment={e.amendmentPending} /></div>
          <div className="small">{e.description}</div>
          {e.rejectionReason && <div className="small tone-danger">Reason: {e.rejectionReason}</div>}
        </div>
      ))}
      <div className="subtle">Edit, void or request an amendment from the ticket's Work history.</div>
    </Modal>
  );
}
