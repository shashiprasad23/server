import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, patch, post } from "../lib/api";
import { fmtDateTime, fmtDay, fmtDayYear, mins, relative, signedMins } from "../lib/format";
import { useMe } from "../lib/session";
import { LogWorkForm } from "../components/LogWork";
import {
  Avatar, Card, Chip, EntryChip, ErrorBanner, Field, Loading, Modal, SlaChip, StatusChip, TypeChip, errorText, useToast,
} from "../components/ui";

const POLICY_TEXT: Record<string, string> = {
  approved: "approved entries",
  approved_submitted: "approved + submitted entries",
  all_valid: "all valid entries",
};

export default function WorkItemPage() {
  const { key = "" } = useParams();
  const q = useQuery({ queryKey: ["work-item", key], queryFn: () => api(`/work-items/${key}`) });
  if (q.isLoading) return <Loading />;
  if (q.isError) return <ErrorBanner error={q.error} />;
  return <Detail item={q.data} />;
}

function Detail({ item }: { item: any }) {
  const qc = useQueryClient();
  const toast = useToast();
  const me = useMe();
  const [tab, setTab] = useState<"history" | "comments" | "status" | "changes">("history");
  const [editing, setEditing] = useState(false);
  const [entryEdit, setEntryEdit] = useState<any>(null);
  const [amend, setAmend] = useState<any>(null);
  const [error, setError] = useState<unknown>(null);
  const refresh = () => qc.invalidateQueries();
  const e = item.effort;
  const projected = (e.actualMinutes ?? 0) + (e.remainingEstimateMinutes ?? 0);
  const total = Math.max(projected, e.originalEstimateMinutes ?? 0, 1);
  const isService = !!item.sla;
  const order = item.statuses.map((s: any) => s.key);
  const primary = item.transitions
    .filter((t: any) => t.allowed && order.indexOf(t.to) > order.indexOf(item.status) && t.to !== "blocked")
    .sort((a: any, b: any) => order.indexOf(a.to) - order.indexOf(b.to))[0];

  const move = async (to: string) => {
    setError(null);
    try {
      await post(`/work-items/${item.key}/transitions`, { to });
      toast(`${item.key} moved to ${item.transitions.find((t: any) => t.to === to)?.name}`);
      refresh();
    } catch (err) {
      setError(err);
    }
  };

  return (
    <>
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link to={`/projects/${item.projectId}`}>{item.projectName}</Link>
        {item.parent && (<><span>/</span><Link to={`/work-items/${item.parent.key}`}>{item.parent.key} {item.parent.title}</Link></>)}
        <span>/</span><strong>{item.key}</strong>
      </nav>
      <div className="between">
        <div className="stack-sm" style={{ minWidth: 0 }}>
          <div className="row">
            <span className="key muted">{item.key}</span>
            <TypeChip label={item.typeLabel} />
            <StatusChip name={item.statusName} category={item.statusCategory} />
            {isService && <SlaChip sla={item.sla} />}
            {item.fromMeeting && <Chip tone="purple">From meeting</Chip>}
          </div>
          <h1>{item.title}</h1>
        </div>
        <div className="row">
          <button className="btn" onClick={async () => { await post(`/work-items/${item.key}/watch?on=${!item.watching}`); refresh(); }}>
            {item.watching ? "Watching" : "Watch"}
          </button>
          {item.permissions.edit && <button className="btn" onClick={() => setEditing(true)}>Edit</button>}
          {item.permissions.edit && item.transitions.length > 0 && (
            <select className="input" style={{ width: 180, height: 38 }} value="" aria-label="Change status"
                    onChange={(ev) => ev.target.value && move(ev.target.value)}>
              <option value="">Change status…</option>
              {item.transitions.map((t: any) => (
                <option key={t.to} value={t.to} disabled={!t.allowed}>{t.name}{t.allowed ? "" : ` (${t.roles.join(", ")} only)`}</option>
              ))}
            </select>
          )}
          {item.permissions.edit && primary && (
            <button className="btn dark" onClick={() => move(primary.to)}>Move to {primary.name}</button>
          )}
        </div>
      </div>
      <ErrorBanner error={error} />

      <div className="grid-2">
        <div className="stack">
          <Card title="Effort" extra={`Reporting policy: ${POLICY_TEXT[e.policy]}`}>
            <div className="grid-cols" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>
              <div><div className="small" style={{ fontWeight: 600 }}>Original estimate</div>
                <div className="mono" style={{ fontSize: 24, fontWeight: 600 }}>{mins(e.originalEstimateMinutes)}</div>
                <div className="subtle">{item.estimateLocked ? "Baseline · locked at sprint start" : "Baseline"}</div></div>
              <div><div className="small" style={{ fontWeight: 600 }}>Remaining estimate</div>
                <div className="mono" style={{ fontSize: 24, fontWeight: 600 }}>{mins(e.remainingEstimateMinutes)}</div>
                <div className="subtle">Editable · every change audited</div></div>
              <div><div className="small" style={{ fontWeight: 600 }}>Actual effort</div>
                <div className="mono tone-info" style={{ fontSize: 24, fontWeight: 600 }}>{mins(e.actualMinutes)}</div>
                <div className="subtle">Derived from {e.countedEntries} entr{e.countedEntries === 1 ? "y" : "ies"} · read-only</div></div>
            </div>
            <div style={{ display: "flex", height: 10, marginTop: 16, borderRadius: 3, overflow: "hidden", border: "1px solid var(--border-strong)" }}
                 role="img" aria-label={`Actual ${mins(e.actualMinutes)}, remaining ${mins(e.remainingEstimateMinutes)}`}>
              <span style={{ width: `${(e.actualMinutes / total) * 100}%`, background: "var(--primary)" }} />
              <span className="bar striped" style={{ width: `${((e.remainingEstimateMinutes ?? 0) / total) * 100}%`, border: "none", borderRadius: 0, height: "100%" }} />
            </div>
            <div className="legend" style={{ marginTop: 8, fontSize: 12.5 }}>
              <span><i style={{ background: "var(--primary)", width: 10 }} />Actual {mins(e.actualMinutes)}</span>
              <span><i style={{ background: "#c9d2f2", width: 10 }} />Remaining {mins(e.remainingEstimateMinutes)}</span>
              {e.originalEstimateMinutes !== null && (
                <span>Projected {mins(projected)} vs original {mins(e.originalEstimateMinutes)} · {signedMins(projected - e.originalEstimateMinutes)}</span>
              )}
              {e.draftMinutes > 0 && <span>{mins(e.draftMinutes)} in draft entries not yet counted</span>}
            </div>
          </Card>

          <Card title="Time summary · hierarchy" extra="Parent = direct + descendants, each entry counted once" pad={false}>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Work item</th><th className="right">Direct</th><th className="right">Descendants</th><th className="right">Total</th></tr></thead>
                <tbody>
                  {item.hierarchy.map((h: any) => (
                    <tr key={h.id}>
                      <td style={{ paddingLeft: h.isRoot ? 16 : 40 }}>
                        <Link to={`/work-items/${h.key}`} className="key" style={{ color: "var(--text)", textDecoration: "none" }}>{h.key}</Link>{" "}
                        <span className="muted">{h.isRoot ? "" : `${h.typeLabel} · `}{h.title}</span>
                      </td>
                      <td className="num">{mins(h.direct)}</td>
                      <td className="num muted">{h.descendants ? mins(h.descendants) : "—"}</td>
                      <td className="num" style={{ fontWeight: 600 }}>{mins(h.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <section className="card">
            <div className="tabs" role="tablist">
              {([["comments", "Comments"], ["history", "Work history"], ["status", "Status history"], ["changes", "Audit"]] as const).map(([k, l]) => (
                <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>
              ))}
            </div>
            {tab === "history" && (
              <WorkHistory item={item} meId={me.id} onEdit={setEntryEdit} onAmend={setAmend} onChanged={refresh} />
            )}
            {tab === "comments" && <Comments itemKey={item.key} canComment={item.permissions.edit} />}
            {tab === "status" && <History itemKey={item.key} field="status" />}
            {tab === "changes" && <History itemKey={item.key} />}
          </section>

          {isService && <SlaTimeline itemKey={item.key} canEdit={item.permissions.edit} serviceFields={item.serviceFields} />}

          <Card title="Details">
            <dl className="kv">
              <div><dt>Assignee</dt><dd>{item.assignee?.name ?? "Unassigned"}</dd></div>
              <div><dt>Reporter</dt><dd>{item.reporter?.name}</dd></div>
              <div><dt>Priority</dt><dd style={{ textTransform: "capitalize" }}>{item.priority}</dd></div>
              <div><dt>Sprint</dt><dd>{item.sprint ? `${item.sprint.name} · ${fmtDay(item.sprint.startDate)}–${fmtDay(item.sprint.endDate)}` : "Backlog"}</dd></div>
              <div><dt>Parent</dt><dd>{item.parent ? <Link to={`/work-items/${item.parent.key}`}>{item.parent.key} · {item.parent.typeLabel}</Link> : "—"}</dd></div>
              <div><dt>Due date</dt><dd>{fmtDayYear(item.dueDate)}</dd></div>
              <div><dt>Story points</dt><dd>{item.storyPoints ?? "—"}</dd></div>
              <div><dt>Labels</dt><dd>{item.labels.length ? item.labels.join(", ") : "—"}</dd></div>
              <div><dt>Links</dt><dd>{item.links.length ? item.links.map((l: any) => (
                <div key={l.id}>{l.label} {l.title ? <Link to={`/work-items/${l.key}`}>{l.key}</Link> : <span className="muted">{l.key}</span>}</div>
              )) : "—"}</dd></div>
              <div><dt>Meeting source</dt><dd>{item.meetingSource
                ? (item.meetingSource.restricted ? <span className="muted">Restricted meeting</span>
                  : <Link to={`/meetings/${item.meetingSource.id}`}>{item.meetingSource.title}
                      {item.meetingSource.segmentStart != null && ` · ${fmtTs(item.meetingSource.segmentStart)}`}</Link>)
                : "—"}</dd></div>
            </dl>
            {item.description && <p className="muted" style={{ whiteSpace: "pre-wrap", marginBottom: 0 }}>{item.description}</p>}
            {item.children.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div className="small" style={{ fontWeight: 600, marginBottom: 6 }}>Child items</div>
                {item.children.map((c: any) => (
                  <div key={c.id} className="row" style={{ padding: "4px 0" }}>
                    <Link className="key" to={`/work-items/${c.key}`}>{c.key}</Link><span className="grow">{c.title}</span>
                    <StatusChip name={c.statusName} category={c.statusCategory} />
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <aside style={{ position: "sticky", top: 90 }}>
          <section className="card emph">
            <div className="card-head"><h2>Log work</h2><span className="key subtle">{item.key}</span></div>
            <div className="card-pad" style={{ paddingTop: 4 }}>
              {item.permissions.logWork
                ? <LogWorkForm itemKey={item.key} policy={item.logWorkPolicy} remaining={item.remainingEstimateMinutes} />
                : <div className="muted">You can view this ticket but do not have Log Work permission in this project.</div>}
            </div>
          </section>
        </aside>
      </div>
      {editing && <EditItem item={item} onClose={() => setEditing(false)} />}
      {entryEdit && <EditEntry entry={entryEdit} policy={item.logWorkPolicy} onClose={() => setEntryEdit(null)} />}
      {amend && <Amend entry={amend} onClose={() => setAmend(null)} />}
    </>
  );
}

const fmtTs = (s: number) => `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

function WorkHistory({ item, meId, onEdit, onAmend, onChanged }: { item: any; meId: string; onEdit: (e: any) => void; onAmend: (e: any) => void; onChanged: () => void }) {
  const toast = useToast();
  if (!item.timeEntries.length) return <div className="empty">No time logged yet. Use Log work to add the first entry.</div>;
  return (
    <div className="table-wrap">
      <table className="table">
        <tbody>
          {item.timeEntries.map((t: any) => {
            const mine = t.userId === meId;
            return (
              <tr key={t.id} style={t.approvalStatus === "voided" ? { opacity: 0.55 } : undefined}>
                <td className="mono nowrap">{fmtDay(t.workDate)}</td>
                <td className="nowrap">{t.user?.name}</td>
                <td className="nowrap">{t.activityCategory}</td>
                <td className="num" style={{ fontWeight: 600 }}>{mins(t.durationMinutes)}</td>
                <td style={{ minWidth: 200 }}>
                  <EntryChip status={t.approvalStatus} amendment={t.amendmentPending} />
                  <div className="small" style={{ marginTop: 4 }}>{t.description}</div>
                  {t.rejectionReason && <div className="small tone-danger">Reason: {t.rejectionReason}</div>}
                  {t.correctsEntryId && <div className="subtle">Amendment of an approved entry</div>}
                </td>
                <td className="right nowrap">
                  {mine && ["draft", "submitted", "rejected"].includes(t.approvalStatus) && (
                    <div className="row" style={{ justifyContent: "flex-end" }}>
                      <button className="btn sm" onClick={() => onEdit(t)}>Edit</button>
                      <button className="btn sm danger" onClick={async () => {
                        try { await post(`/time-entries/${t.id}/void`, { reason: "Voided by owner" }); toast("Entry voided"); onChanged(); }
                        catch (e) { toast(errorText(e), true); }
                      }}>Void</button>
                    </div>
                  )}
                  {mine && t.approvalStatus === "approved" && !t.amendmentPending && (
                    <button className="btn sm" onClick={() => onAmend(t)}>Request amendment</button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function EditEntry({ entry, policy, onClose }: { entry: any; policy: any; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ workDate: entry.workDate, durationMinutes: String(entry.durationMinutes),
    activityCategory: entry.activityCategory, description: entry.description });
  const [error, setError] = useState<any>(null);
  const save = async () => {
    try {
      await patch(`/time-entries/${entry.id}`, { ...form, durationMinutes: form.durationMinutes, version: entry.version });
      qc.invalidateQueries();
      onClose();
    } catch (e) { setError(e); }
  };
  return (
    <Modal title="Edit time entry" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Save</button></>}>
      {entry.approvalStatus === "rejected" && <div className="banner warning">Saving a corrected entry returns it to draft so you can resubmit.</div>}
      <ErrorBanner error={error} />
      <Field label="Work date" error={error?.errors?.workDate}><input className="input" type="date" min={policy.earliestDate} max={policy.latestDate} value={form.workDate} onChange={(e) => setForm({ ...form, workDate: e.target.value })} /></Field>
      <Field label="Duration (minutes or 1h 30m)" error={error?.errors?.durationMinutes}><input className="input mono" value={form.durationMinutes} onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })} /></Field>
      <Field label="Activity"><select className="input" value={form.activityCategory} onChange={(e) => setForm({ ...form, activityCategory: e.target.value })}>{policy.activityCategories.map((c: string) => <option key={c}>{c}</option>)}</select></Field>
      <Field label="Work description" error={error?.errors?.description}><textarea className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
    </Modal>
  );
}

function Amend({ entry, onClose }: { entry: any; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [reversal, setReversal] = useState(false);
  const [reason, setReason] = useState("");
  const [duration, setDuration] = useState(String(entry.durationMinutes));
  const [workDate, setWorkDate] = useState(entry.workDate);
  const [error, setError] = useState<any>(null);
  const send = async () => {
    try {
      await post(`/time-entries/${entry.id}/amendments`, reversal ? { reason, reversal: true } : { reason, durationMinutes: duration, workDate });
      toast("Amendment sent to the project's approver");
      qc.invalidateQueries();
      onClose();
    } catch (e) { setError(e); }
  };
  return (
    <Modal title="Request amendment" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={send}>Send for approval</button></>}>
      <div className="banner info">Approved entries change only through an amendment. The original stays in the audit trail.</div>
      <ErrorBanner error={error} />
      <label className="radio"><input type="radio" checked={!reversal} onChange={() => setReversal(false)} />Correct the values</label>
      <label className="radio"><input type="radio" checked={reversal} onChange={() => setReversal(true)} />Reverse the entry entirely</label>
      {!reversal && (
        <div className="row" style={{ alignItems: "flex-start" }}>
          <Field label="Work date"><input className="input" type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)} /></Field>
          <Field label="Duration"><input className="input mono" value={duration} onChange={(e) => setDuration(e.target.value)} /></Field>
        </div>
      )}
      <Field label="Reason" error={error?.errors?.reason}><textarea className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
    </Modal>
  );
}

function EditItem({ item, onClose }: { item: any; onClose: () => void }) {
  const qc = useQueryClient();
  const project = useQuery({ queryKey: ["project", item.projectId], queryFn: () => api(`/projects/${item.projectId}`) });
  const [f, setF] = useState<any>({
    title: item.title, description: item.description, priority: item.priority, assigneeId: item.assignee?.id ?? "",
    originalEstimateMinutes: item.originalEstimateMinutes ?? "", remainingEstimateMinutes: item.remainingEstimateMinutes ?? "",
    storyPoints: item.storyPoints ?? "", dueDate: item.dueDate ?? "", sprintId: item.sprintId ?? "", estimateChangeReason: "",
  });
  const [error, setError] = useState<any>(null);
  const save = async () => {
    const body: any = {
      title: f.title, description: f.description, priority: f.priority, assigneeId: f.assigneeId || null,
      originalEstimateMinutes: f.originalEstimateMinutes === "" ? null : f.originalEstimateMinutes,
      remainingEstimateMinutes: f.remainingEstimateMinutes === "" ? null : f.remainingEstimateMinutes,
      storyPoints: f.storyPoints === "" ? null : Number(f.storyPoints), dueDate: f.dueDate || null,
      sprintId: f.sprintId || null, version: item.version,
    };
    if (f.estimateChangeReason) body.estimateChangeReason = f.estimateChangeReason;
    if (item.sla) { delete body.sprintId; delete body.storyPoints; }
    try {
      await patch(`/work-items/${item.key}`, body);
      qc.invalidateQueries();
      onClose();
    } catch (e) { setError(e); }
  };
  const priorities = item.sla ? ["P1", "P2", "P3", "P4"] : ["lowest", "low", "medium", "high", "highest"];
  return (
    <Modal wide title={`Edit ${item.key}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Save changes</button></>}>
      <ErrorBanner error={error} />
      <Field label="Title" error={error?.errors?.title}><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
      <Field label="Description"><textarea className="input" rows={4} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      <div className="grid-cols">
        <Field label="Assignee" error={error?.errors?.assigneeId}>
          <select className="input" value={f.assigneeId} onChange={(e) => setF({ ...f, assigneeId: e.target.value })}>
            <option value="">Unassigned</option>
            {project.data?.members.map((m: any) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
          </select>
        </Field>
        <Field label="Priority"><select className="input" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>{priorities.map((p) => <option key={p}>{p}</option>)}</select></Field>
        <Field label="Due date"><input className="input" type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /></Field>
        {!item.sla && <Field label="Story points"><input className="input" type="number" min={0} value={f.storyPoints} onChange={(e) => setF({ ...f, storyPoints: e.target.value })} /></Field>}
        <Field label="Original estimate" help={item.estimateLocked ? "Locked baseline — managers only, reason required" : "e.g. 8h"} error={error?.errors?.originalEstimateMinutes}>
          <input className="input mono" value={f.originalEstimateMinutes} onChange={(e) => setF({ ...f, originalEstimateMinutes: e.target.value })} />
        </Field>
        <Field label="Remaining estimate"><input className="input mono" value={f.remainingEstimateMinutes} onChange={(e) => setF({ ...f, remainingEstimateMinutes: e.target.value })} /></Field>
        {!item.sla && (
          <Field label="Sprint">
            <select className="input" value={f.sprintId} onChange={(e) => setF({ ...f, sprintId: e.target.value })}>
              <option value="">Backlog</option>
              {project.data?.sprints.filter((s: any) => s.state !== "closed").map((s: any) => <option key={s.id} value={s.id}>{s.name} ({s.state})</option>)}
            </select>
          </Field>
        )}
      </div>
      {item.estimateLocked && (
        <Field label="Reason for changing the baseline" error={error?.errors?.estimateChangeReason}>
          <input className="input" value={f.estimateChangeReason} onChange={(e) => setF({ ...f, estimateChangeReason: e.target.value })} />
        </Field>
      )}
    </Modal>
  );
}

function Comments({ itemKey, canComment }: { itemKey: string; canComment: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["comments", itemKey], queryFn: () => api(`/work-items/${itemKey}/comments`) });
  const [body, setBody] = useState("");
  return (
    <div className="card-pad stack">
      {(q.data ?? []).length === 0 && <div className="muted">No comments yet.</div>}
      {(q.data ?? []).map((c: any) => (
        <div key={c.id} className="row" style={{ alignItems: "flex-start" }}>
          <Avatar small initials={c.author?.initials} title={c.author?.name} />
          <div className="grow">
            <div><strong>{c.author?.name}</strong> <span className="subtle">{relative(c.createdAt)}</span></div>
            <div style={{ whiteSpace: "pre-wrap" }}>{c.body}</div>
          </div>
        </div>
      ))}
      {canComment && (
        <form className="stack-sm" onSubmit={async (e) => {
          e.preventDefault();
          if (!body.trim()) return;
          await post(`/work-items/${itemKey}/comments`, { body });
          setBody("");
          qc.invalidateQueries({ queryKey: ["comments", itemKey] });
        }}>
          <textarea className="input" placeholder="Add a comment. Mention project members with @name (e.g. @a.rao)" value={body} onChange={(e) => setBody(e.target.value)} />
          <div><button className="btn primary">Comment</button></div>
        </form>
      )}
    </div>
  );
}

function History({ itemKey, field }: { itemKey: string; field?: string }) {
  const q = useQuery({ queryKey: ["history", itemKey, field], queryFn: () => api(`/work-items/${itemKey}/history${field ? `?field=${field}` : ""}`) });
  if (!q.data) return <Loading />;
  if (!q.data.length) return <div className="empty">No changes recorded.</div>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead><tr><th>When</th><th>Who</th><th>Field</th><th>Change</th></tr></thead>
        <tbody>
          {q.data.map((h: any) => (
            <tr key={h.id}>
              <td className="nowrap small">{fmtDateTime(h.occurredAt)}</td>
              <td className="nowrap">{h.actor?.name ?? "System"}</td>
              <td className="mono small">{h.field.replace(/_/g, " ")}</td>
              <td className="small">{h.oldValue ?? "—"} → <strong>{h.newValue ?? "—"}</strong>{h.reason && <div className="subtle">{h.reason}</div>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SlaTimeline({ itemKey, canEdit, serviceFields }: { itemKey: string; canEdit: boolean; serviceFields?: any }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["sla", itemKey], queryFn: () => api(`/work-items/${itemKey}/sla`) });
  const [reason, setReason] = useState("");
  const [open, setOpen] = useState(false);
  if (!q.data) return null;
  return (
    <Card title="SLA timeline" extra={<SlaChip sla={q.data.state} />}>
      {serviceFields && (
        <dl className="kv" style={{ marginBottom: 16 }}>
          {serviceFields.severity_level && <div><dt>Severity</dt><dd>{serviceFields.severity_level}</dd></div>}
          {serviceFields.impact && <div><dt>Impact · urgency</dt><dd style={{ textTransform: "capitalize" }}>{serviceFields.impact} · {serviceFields.urgency}</dd></div>}
          {serviceFields.service && <div><dt>Service</dt><dd>{serviceFields.service}</dd></div>}
          {serviceFields.offering && serviceFields.offering !== serviceFields.service && <div><dt>Offering</dt><dd>{serviceFields.offering}</dd></div>}
          {serviceFields.maintenance_window && <div><dt>Window</dt><dd>{serviceFields.maintenance_window}</dd></div>}
          {Object.entries(serviceFields.answers ?? {}).filter(([k]) => k !== "service").map(([k, v]) => <div key={k}><dt style={{ textTransform: "capitalize" }}>{k.replace(/_/g, " ")}</dt><dd>{String(v)}</dd></div>)}
        </dl>
      )}
      <div className="stack-sm">
        {q.data.events.map((ev: any, i: number) => (
          <div key={i} className="row" style={{ alignItems: "baseline" }}>
            <span className="mono small" style={{ width: 120 }}>{fmtDateTime(ev.at)}</span>
            <span><strong style={{ textTransform: "capitalize" }}>{ev.kind}</strong> · {ev.detail}{ev.actor && <span className="subtle"> · {ev.actor.name}</span>}</span>
          </div>
        ))}
        {q.data.resolutionDueAt && <div className="subtle">Resolution due {fmtDateTime(q.data.resolutionDueAt)} · paused {q.data.pausedMinutes}m total</div>}
      </div>
      {canEdit && (
        <div style={{ marginTop: 14 }}>
          {!open ? <button className="btn" onClick={() => setOpen(true)}>Escalate</button> : (
            <div className="row">
              <input className="input grow" placeholder="Reason for escalation" value={reason} onChange={(e) => setReason(e.target.value)} />
              <button className="btn dark" onClick={async () => {
                try { await post(`/work-items/${itemKey}/escalate`, { reason }); toast("Escalated and owner notified"); setOpen(false); qc.invalidateQueries(); }
                catch (e) { toast(errorText(e), true); }
              }}>Escalate</button>
            </div>
          )}
        </div>
      )}
      <div className="subtle" style={{ marginTop: 12 }}>Service tickets use the same Log Work and time-entry model as delivery tickets. Every SLA pause and breach is audited.</div>
    </Card>
  );
}
