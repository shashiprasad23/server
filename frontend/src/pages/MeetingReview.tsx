import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, newKey, patch, post } from "../lib/api";
import { fmtDateTime, fmtDayYear } from "../lib/format";
import { Card, Chip, ErrorBanner, Field, Loading, MeetingChip, Modal, ProposalChip, errorText, useToast } from "../components/ui";

const ts = (s: number | null | undefined) =>
  s === null || s === undefined ? "—" : `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

export default function MeetingReview() {
  const { meetingId = "" } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const [selected, setSelected] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<any>(null);
  const [rejecting, setRejecting] = useState<any>(null);
  const [error, setError] = useState<unknown>(null);
  const q = useQuery({ queryKey: ["meeting", meetingId], queryFn: () => api(`/meetings/${meetingId}`),
    refetchInterval: (query) => ["queued", "processing"].includes((query.state.data as any)?.status) ? 1500 : false });
  const m = q.data;
  const segs = useMemo(() => (m?.segments ?? []).filter((s: any) => !search || `${s.speaker} ${s.text}`.toLowerCase().includes(search.toLowerCase())), [m, search]);
  if (q.isLoading) return <Loading />;
  if (q.isError) return <ErrorBanner error={q.error} />;
  const reviewer = m.access.reviewer;
  const refresh = () => qc.invalidateQueries({ queryKey: ["meeting", meetingId] });

  const tagFor = (seq: number) => {
    const s = m.summary;
    if (!s) return null;
    if (s.decisions.some((d: any) => d.evidence?.segment === seq)) return ["Decision", "warning"];
    if (m.proposals.some((p: any) => p.evidence && m.segments.find((x: any) => x.seq === seq)?.start === p.evidence.start)) return ["Action", "warning"];
    if (s.risks.some((d: any) => d.evidence?.segment === seq)) return ["Risk", "warning"];
    return null;
  };

  const approve = async (p: any) => {
    setError(null);
    try {
      const r = await post(`/ai-action-proposals/${p.id}/decision`, { decision: "approve" }, newKey());
      toast(r.createdWorkItem ? `${p.kind === "update" ? "Updated" : "Created"} ${r.createdWorkItem.key} · linked to this meeting` : "Approved");
      qc.invalidateQueries();
    } catch (e) { setError(e); }
  };

  return (
    <>
      <div className="crumbs"><Link to="/meetings">Meetings</Link><span>·</span><span>Review queue</span></div>
      <div className="between">
        <div className="stack-sm">
          <h1>{m.title}</h1>
          <div className="row muted small">
            <span style={{ textTransform: "capitalize" }}>{m.provider} transcript · {fmtDateTime(m.startAt)}{m.endAt ? `–${new Date(m.endAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : ""} · {m.participants.length} participants</span>
            <MeetingChip status={m.status} />
          </div>
        </div>
        {reviewer && (
          <div className="row">
            <button className="btn" disabled={m.status === "published" || ["queued", "processing"].includes(m.status)}
                    onClick={async () => { try { await post(`/meetings/${m.id}/process`); toast("Reprocessing queued"); refresh(); } catch (e) { toast(errorText(e), true); } }}>Reprocess</button>
            <button className="btn primary" disabled={!m.summary || m.status === "published"}
                    onClick={async () => { try { await post(`/meetings/${m.id}/publish`, {}); toast("Summary published to attendees"); refresh(); } catch (e) { toast(errorText(e), true); } }}>
              {m.status === "published" ? "Published" : "Publish summary"}</button>
          </div>
        )}
      </div>

      <div className="pipeline" aria-label="Processing lifecycle">
        {m.lifecycle.map((s: any, i: number) => (
          <div key={s.key} className={s.failed ? "failed" : s.done ? "done" : s.current ? "current" : ""}><small>{i + 1}</small>{s.failed ? "Failed" : s.label}</div>
        ))}
      </div>

      {m.status === "failed" && (
        <div className="banner danger">Processing failed{m.error ? `: ${m.error}` : ""}. {reviewer ? "Retry with Reprocess, or review the transcript manually." : ""}</div>
      )}
      {["queued", "processing"].includes(m.status) && <div className="banner info">AI processing is {m.status}… this page updates automatically.</div>}

      {m.summary && (
        <div className="dashed row small">
          <span className="tag-ai">AI-GENERATED</span>
          <span className="muted">{m.summary.publishedAt ? `Published ${fmtDateTime(m.summary.publishedAt)}${m.summary.reviewer ? ` by ${m.summary.reviewer.name}` : ""}` : "Unpublished until reviewed"} · model {m.summary.modelName} · prompt {m.summary.promptVersion} · generated {fmtDateTime(m.summary.generatedAt)} · visible to {m.accessScope === "attendees" ? "attendees and reviewers" : `attendees and ${m.projectName} members`}</span>
        </div>
      )}
      <ErrorBanner error={error} />

      <div className="grid-2">
        <div className="stack">
          {m.summary ? (
            <Card title="Summary">
              <p style={{ fontSize: 15, marginTop: 0 }}>{m.summary.executiveSummary}</p>
              <div className="grid-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
                {([["Decision", m.summary.decisions], ["Risk", m.summary.risks], ["Open question", m.summary.openQuestions]] as const).map(([label, items]) => (
                  <div key={label} style={{ borderTop: "2px solid var(--text)", paddingTop: 10 }}>
                    <div className="small" style={{ fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>{label}</div>
                    {items.length === 0 && <div className="muted small">None identified</div>}
                    {items.map((d: any, i: number) => (
                      <div key={i} style={{ marginTop: 6 }}>
                        <div>{d.text}</div>
                        {d.evidence ? <button className="btn link mono small" onClick={() => setSelected(d.evidence.segment)}>{ts(d.evidence.start)}</button>
                          : <span className="subtle">Evidence unavailable</span>}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </Card>
          ) : !["queued", "processing"].includes(m.status) && (
            <Card><div className="empty">{reviewer ? "No summary yet." : "The summary is not published yet."}</div></Card>
          )}

          {m.proposals.length > 0 && (
            <>
              <div className="between"><h2>Proposed actions · {m.proposals.length}</h2><span className="subtle">Nothing is created until you approve it</span></div>
              {m.proposals.map((p: any) => (
                <section key={p.id} className={`card card-pad stack-sm ${p.reviewState === "pending" ? "emph" : ""}`}>
                  <div className="between">
                    <div>
                      <h3>{p.title}</h3>
                      <div className="subtle">{p.kind === "update" ? `Change to existing ticket · ${p.target?.key}` : (p.proposedType === "task" ? "Task" : p.proposedType)} · {m.projectName} · confidence {p.confidence.toFixed(2)} (review aid only){p.edited ? " · edited by reviewer" : ""}</div>
                    </div>
                    <ProposalChip state={p.reviewState} />
                  </div>
                  <dl className="kv">
                    <div><dt>Owner</dt><dd className={p.owner ? "" : "tone-warning"}>{p.owner?.name ?? "Unassigned — not stated in transcript"}</dd></div>
                    <div><dt>Due date</dt><dd className={p.dueDate ? "" : "tone-warning"}>{p.dueDate ? fmtDayYear(p.dueDate) : `Not stated${p.reviewState === "pending" && p.kind === "create" && m.aiSettings.requireDueDate ? " — set before approving" : ""}`}</dd></div>
                    <div><dt>Evidence</dt><dd>{p.evidence ? <button className="btn link mono small" onClick={() => setSelected(m.segments.find((s: any) => s.start === p.evidence.start)?.seq ?? null)}>{p.evidence.startLabel} – {p.evidence.endLabel}</button> : <span className="muted">Unavailable</span>}</dd></div>
                  </dl>
                  {p.evidence?.quote && <div className="quote">“{p.evidence.quote}” — {p.evidence.speaker}</div>}
                  {p.reviewState === "approved" && p.createdWorkItem && (
                    <div className="small muted">{p.kind === "update" ? "Updated" : "Created"} <Link to={`/work-items/${p.createdWorkItem.key}`}>{p.createdWorkItem.key}</Link> · approved by {p.reviewer?.name} at {fmtDateTime(p.reviewedAt)} · linked to this meeting and segment</div>
                  )}
                  {p.reviewState === "rejected" && <div className="small muted">Rejected by {p.reviewer?.name} · reason: {p.rejectReason} · no ticket created</div>}
                  {reviewer && p.reviewState === "pending" && (
                    <div className="row">
                      <button className="btn dark" onClick={() => approve(p)}>{p.kind === "update" ? "Approve change" : "Approve & create ticket"}</button>
                      <button className="btn" onClick={() => setEditing(p)}>Edit</button>
                      <button className="btn" onClick={() => setRejecting(p)}>Reject</button>
                    </div>
                  )}
                </section>
              ))}
            </>
          )}
        </div>

        <aside className="card" style={{ position: "sticky", top: 90, maxHeight: "calc(100vh - 110px)", overflowY: "auto" }}>
          <div className="card-head"><h2>Transcript</h2></div>
          {m.access.transcript ? (
            <>
              <div style={{ padding: "0 20px 14px" }}>
                <Field label="Search this transcript"><input className="input" placeholder="Word or speaker" value={search} onChange={(e) => setSearch(e.target.value)} /></Field>
              </div>
              {segs.map((s: any) => {
                const tag = selected === s.seq ? ["Selected evidence", "warning"] : tagFor(s.seq);
                return (
                  <div key={s.seq} className={`segment ${selected === s.seq ? "selected" : ""}`} id={`seg-${s.seq}`}>
                    <div className="row small"><span className="mono muted">{s.startLabel}</span><strong>{s.speaker}</strong>{tag && <span className="tone-warning" style={{ fontWeight: 600 }}>{tag[0]}</span>}</div>
                    <div>{s.text}</div>
                  </div>
                );
              })}
              {segs.length === 0 && <div className="empty">No matching lines.</div>}
            </>
          ) : <div className="empty">The transcript is restricted to attendees and reviewers.</div>}
        </aside>
      </div>
      {editing && <EditProposal proposal={editing} members={m.members} onClose={() => { setEditing(null); refresh(); }} />}
      {rejecting && <RejectProposal proposal={rejecting} onClose={() => { setRejecting(null); refresh(); }} />}
    </>
  );
}

function EditProposal({ proposal, members, onClose }: { proposal: any; members: any[]; onClose: () => void }) {
  const [f, setF] = useState({ title: proposal.title, description: proposal.description, ownerUserId: proposal.owner?.id ?? "", dueDate: proposal.dueDate ?? "", proposedType: proposal.proposedType });
  const [error, setError] = useState<any>(null);
  const save = async () => {
    try { await patch(`/ai-action-proposals/${proposal.id}`, { ...f, ownerUserId: f.ownerUserId || null, dueDate: f.dueDate || null }); onClose(); }
    catch (e) { setError(e); }
  };
  return (
    <Modal title="Edit proposed action" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Save</button></>}>
      <div className="small muted">Confirm the owner and date with the people involved. The model is never asked to guess them.</div>
      <ErrorBanner error={error} />
      <Field label="Title"><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
      <Field label="Description"><textarea className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      <div className="grid-cols">
        <Field label="Owner" error={error?.errors?.ownerUserId}><select className="input" value={f.ownerUserId} onChange={(e) => setF({ ...f, ownerUserId: e.target.value })}><option value="">Unassigned</option>{members.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
        <Field label="Due date"><input className="input" type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /></Field>
        {proposal.kind === "create" && <Field label="Ticket type"><select className="input" value={f.proposedType} onChange={(e) => setF({ ...f, proposedType: e.target.value })}><option value="task">Task</option><option value="story">Story</option><option value="bug">Bug</option><option value="test_task">Test / QA task</option></select></Field>}
      </div>
    </Modal>
  );
}

function RejectProposal({ proposal, onClose }: { proposal: any; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<any>(null);
  return (
    <Modal title="Reject proposed action" onClose={onClose}
           footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn dark" disabled={!reason.trim()} onClick={async () => {
             try { await post(`/ai-action-proposals/${proposal.id}/decision`, { decision: "reject", reason }, newKey()); onClose(); } catch (e) { setError(e); }
           }}>Reject</button></>}>
      <ErrorBanner error={error} />
      <div className="muted">“{proposal.title}” — no ticket will be created. The reason feeds AI quality evaluation.</div>
      <div className="row">{["Raised as an idea, not agreed", "Duplicate of an existing ticket", "Not an action"].map((r) => <Chip key={r}><button className="btn link small" onClick={() => setReason(r)}>{r}</button></Chip>)}</div>
      <textarea className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason" />
    </Modal>
  );
}
