import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, auth, newKey, post } from "../lib/api";
import { fmtDateTime } from "../lib/format";
import { useMe } from "../lib/session";
import { Card, ErrorBanner, Field, Loading, MeetingChip, Modal } from "../components/ui";

const SAMPLE = `00:00:05 R. Iyer: Quick sync on the payment release.
00:01:10 A. Rao: I'll add retry logging to the capture API by Thursday.
00:02:30 M. Lin: The regression run might slip if staging stays down.
00:03:15 R. Iyer: We agree to ship behind the feature flag.`;

export default function Meetings() {
  const nav = useNavigate();
  const me = useMe();
  const [importing, setImporting] = useState(false);
  const q = useQuery({ queryKey: ["meetings"], queryFn: () => api("/meetings"), refetchInterval: (query) =>
    (query.state.data as any[] | undefined)?.some((m) => ["queued", "processing"].includes(m.status)) ? 2000 : false });
  if (q.isLoading) return <Loading />;
  const enabled = me.organization.featureFlags.ai;
  return (
    <>
      <div className="between">
        <div>
          <h1>Meetings</h1>
          <div className="muted">Authorised transcripts become reviewed summaries and approved actions. Nothing is created until a reviewer approves it.</div>
        </div>
        {enabled ? <button className="btn primary" onClick={() => setImporting(true)}>Import transcript</button>
          : <span className="chip">AI meeting intelligence is disabled</span>}
      </div>
      <Card pad={false}>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Meeting</th><th>Project</th><th>When</th><th>Source</th><th>Status</th><th className="right">Proposals</th></tr></thead>
            <tbody>
              {(q.data ?? []).map((m: any) => (
                <tr key={m.id} className="clickable" onClick={() => nav(`/meetings/${m.id}`)}>
                  <td><strong>{m.title}</strong><div className="subtle">{m.participants.length} participants · {m.accessScope === "attendees" ? "attendees only" : "project members"}</div></td>
                  <td>{m.projectName}</td>
                  <td className="small nowrap">{fmtDateTime(m.startAt)}</td>
                  <td className="small" style={{ textTransform: "capitalize" }}>{m.provider}</td>
                  <td><MeetingChip status={m.status} /></td>
                  <td className="num">{m.pending ? `${m.pending} to review · ` : ""}{m.approved} approved</td>
                </tr>
              ))}
              {(q.data ?? []).length === 0 && <tr><td colSpan={6} className="empty">No meetings you can access yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
      {importing && <ImportModal onClose={() => setImporting(false)} onDone={(id) => nav(`/meetings/${id}`)} />}
    </>
  );
}

function ImportModal({ onClose, onDone }: { onClose: () => void; onDone: (id: string) => void }) {
  const me = useMe();
  const qc = useQueryClient();
  const projects = me.memberships.filter((m) => !["viewer"].includes(m.role));
  const [source, setSource] = useState<"paste" | "file" | "teams">("paste");
  const [f, setF] = useState({ projectId: projects[0]?.projectId ?? "", title: "", startAt: new Date().toISOString().slice(0, 16),
    transcript: "", accessScope: "project", externalMeetingId: "", organizerId: "" });
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const meta = { projectId: f.projectId, title: f.title, startAt: new Date(f.startAt).toISOString(), accessScope: f.accessScope };
      let m;
      if (source === "file") {
        if (!file) throw { message: "Choose a .vtt or .txt transcript, or an audio file" };
        const fd = new FormData();
        fd.append("metadata", JSON.stringify(meta));
        fd.append("file", file);
        const res = await fetch("/api/v1/meetings/upload", { method: "POST", body: fd, headers: { Authorization: `Bearer ${auth.token}` } });
        m = await res.json();
        if (!res.ok) throw m;
      } else if (source === "teams") {
        m = await post("/meetings/import", { ...meta, source: "teams", externalMeetingId: f.externalMeetingId, organizerId: f.organizerId }, newKey());
      } else {
        m = await post("/meetings/import", { ...meta, transcript: f.transcript }, newKey());
      }
      qc.invalidateQueries({ queryKey: ["meetings"] });
      onDone(m.id);
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <Modal wide title="Import meeting transcript" onClose={onClose}
           footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>{busy ? "Importing…" : "Import & process"}</button></>}>
      <div className="banner info">Only import meetings you are permitted to share. Recording and transcription depend on participant notice and organisational policy; the platform never records silently.</div>
      <ErrorBanner error={error} />
      <div className="seg" role="group" aria-label="Source">
        <button className={source === "paste" ? "on" : ""} onClick={() => setSource("paste")}>Paste transcript</button>
        <button className={source === "file" ? "on" : ""} onClick={() => setSource("file")}>Upload file</button>
        <button className={source === "teams" ? "on" : ""} onClick={() => setSource("teams")}>Microsoft Teams</button>
      </div>
      <div className="grid-cols">
        <Field label="Project"><select className="input" value={f.projectId} onChange={(e) => setF({ ...f, projectId: e.target.value })}>{projects.map((p) => <option key={p.projectId} value={p.projectId}>{p.projectName}</option>)}</select></Field>
        <Field label="Visible to"><select className="input" value={f.accessScope} onChange={(e) => setF({ ...f, accessScope: e.target.value })}><option value="project">Project members (after publish)</option><option value="attendees">Attendees and reviewers only</option></select></Field>
        <Field label="Title" error={error?.errors?.title}><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Started at" error={error?.errors?.startAt}><input className="input" type="datetime-local" value={f.startAt} onChange={(e) => setF({ ...f, startAt: e.target.value })} /></Field>
      </div>
      {source === "paste" && (
        <Field label="Transcript" help="WebVTT or lines like '00:12:41 Speaker: text'" error={error?.errors?.transcript}>
          <textarea className="input mono" rows={10} style={{ fontSize: 12.5 }} placeholder={SAMPLE} value={f.transcript} onChange={(e) => setF({ ...f, transcript: e.target.value })} />
        </Field>
      )}
      {source === "paste" && !f.transcript && <div><button className="btn sm" onClick={() => setF({ ...f, transcript: SAMPLE, title: f.title || "Payment release sync" })}>Use sample transcript</button></div>}
      {source === "file" && (
        <Field label="File" help=".vtt / .txt transcript, or audio (.wav, .mp3, .m4a) for speech-to-text when the worker has faster-whisper installed">
          <input className="input" type="file" accept=".vtt,.txt,.wav,.mp3,.m4a,.ogg,.webm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} style={{ paddingTop: 8 }} />
        </Field>
      )}
      {source === "teams" && (
        <div className="grid-cols">
          <Field label="Teams meeting id" error={error?.errors?.externalMeetingId}><input className="input" value={f.externalMeetingId} onChange={(e) => setF({ ...f, externalMeetingId: e.target.value })} /></Field>
          <Field label="Organizer (Entra object id)"><input className="input" value={f.organizerId} onChange={(e) => setF({ ...f, organizerId: e.target.value })} /></Field>
        </div>
      )}
    </Modal>
  );
}
