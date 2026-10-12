import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, patch, post } from "../lib/api";
import { fmtDateTime, roleLabel } from "../lib/format";
import { useCan } from "../lib/session";
import { Card, Chip, Empty, ErrorBanner, Field, Loading, useToast, errorText } from "../components/ui";

export default function Admin() {
  const can = useCan();
  const [tab, setTab] = useState<"users" | "settings" | "audit" | "integrations" | "calendars">("users");
  if (!can.admin) return <Card><Empty>Administration is limited to platform administrators.</Empty></Card>;
  return (
    <>
      <h1>Administration</h1>
      <div className="tabs card" style={{ padding: "0 8px" }}>
        {([["users", "Identity & roles"], ["settings", "Settings & feature flags"], ["calendars", "Calendars"], ["integrations", "Integrations health"], ["audit", "Audit log"]] as const).map(([k, l]) => (
          <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === "users" && <Users />}
      {tab === "settings" && <OrgSettings />}
      {tab === "calendars" && <Calendars />}
      {tab === "integrations" && <Integrations />}
      {tab === "audit" && <Audit />}
    </>
  );
}

function Users() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["admin-users"], queryFn: () => api("/admin/users") });
  const [f, setF] = useState({ name: "", email: "" });
  const [error, setError] = useState<any>(null);
  const update = async (id: string, body: any) => {
    try { await patch(`/admin/users/${id}`, body); toast("Access change saved and audited"); qc.invalidateQueries({ queryKey: ["admin-users"] }); }
    catch (e) { toast(errorText(e), true); }
  };
  if (!q.data) return <Loading />;
  const roles = ["platform_admin", "resource_manager", "executive_viewer"];
  return (
    <Card pad={false} title="Users" extra="Production identities come from Entra ID; roles and project membership are managed here">
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Person</th><th>Project roles</th>{roles.map((r) => <th key={r}>{roleLabel(r)}</th>)}<th>Status</th><th>Last sign-in</th></tr></thead>
          <tbody>
            {q.data.map((u: any) => (
              <tr key={u.id}>
                <td><strong>{u.name}</strong><div className="subtle">{u.email}</div></td>
                <td className="small">{u.memberships.map((m: any) => `${m.projectKey}: ${roleLabel(m.role)}${m.approver ? " (approver)" : ""}`).join(" · ") || "—"}</td>
                {roles.map((r) => (
                  <td key={r}><input type="checkbox" aria-label={`${u.name} ${roleLabel(r)}`} checked={u.globalRoles.includes(r)}
                    onChange={(e) => update(u.id, { globalRoles: e.target.checked ? [...u.globalRoles, r] : u.globalRoles.filter((x: string) => x !== r) })} /></td>
                ))}
                <td><button className="btn sm" onClick={() => update(u.id, { status: u.status === "active" ? "deactivated" : "active" })}>
                  {u.status === "active" ? "Deactivate" : "Reactivate"}</button> {u.status !== "active" && <Chip tone="danger">Deactivated</Chip>}</td>
                <td className="small">{fmtDateTime(u.lastLoginAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row" style={{ padding: 16, borderTop: "1px solid var(--border)", alignItems: "flex-end" }}>
        <Field label="Name"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Email" error={error?.errors?.email}><input className="input" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <button className="btn primary" onClick={async () => { try { await post("/admin/users", f); setF({ name: "", email: "" }); setError(null); qc.invalidateQueries({ queryKey: ["admin-users"] }); } catch (e) { setError(e); } }}>Add user</button>
      </div>
    </Card>
  );
}

function OrgSettings() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["admin-settings"], queryFn: () => api("/admin/settings") });
  const [error, setError] = useState<any>(null);
  if (!q.data) return <Loading />;
  const s = q.data.settings;
  const save = async (settings: any) => {
    try { await patch("/admin/settings", { settings }); toast("Settings saved and audited"); qc.invalidateQueries(); setError(null); }
    catch (e) { setError(e); }
  };
  return (
    <div className="grid-3">
      <Card title="Feature flags">
        <div className="stack-sm">
          {Object.entries(s.feature_flags).map(([k, v]) => (
            <label key={k} className="radio"><input type="checkbox" checked={v as boolean} onChange={(e) => save({ feature_flags: { [k]: e.target.checked } })} />
              <span style={{ textTransform: "capitalize" }}>{k.replace(/_/g, " ")}</span></label>
          ))}
        </div>
      </Card>
      <Card title="Reporting & AI">
        <div className="stack">
          <ErrorBanner error={error} />
          <Field label="Default reporting policy" help="Which entries count as actual effort">
            <select className="input" value={s.reporting_policy} onChange={(e) => save({ reporting_policy: e.target.value })}>
              <option value="approved_submitted">Approved + submitted</option><option value="approved">Approved only</option><option value="all_valid">All valid (incl. draft)</option>
            </select>
          </Field>
          <Field label="AI provider" help="heuristic runs fully local; ollama calls a local LLM runtime (UPM_OLLAMA_URL)">
            <select className="input" value={s.ai.provider} onChange={(e) => save({ ai: { provider: e.target.value } })}><option value="heuristic">Local heuristic extractor</option><option value="ollama">Ollama (local LLM)</option></select>
          </Field>
          <Field label="Prompt version"><input className="input" defaultValue={s.ai.prompt_version} onBlur={(e) => e.target.value !== s.ai.prompt_version && save({ ai: { prompt_version: e.target.value } })} /></Field>
          <label className="radio"><input type="checkbox" checked={s.ai.require_due_date_on_approval} onChange={(e) => save({ ai: { require_due_date_on_approval: e.target.checked } })} />Require a due date before approving AI actions</label>
        </div>
      </Card>
      <Card title="Retention (days)" extra="Applied by record type">
        <div className="stack-sm">
          {Object.entries(s.retention_days).map(([k, v]) => (
            <Field key={k} label={k[0].toUpperCase() + k.slice(1)}>
              <input className="input" type="number" defaultValue={v as number} onBlur={(e) => Number(e.target.value) !== v && save({ retention_days: { [k]: Number(e.target.value) } })} />
            </Field>
          ))}
        </div>
      </Card>
    </div>
  );
}

function Calendars() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["calendars"], queryFn: () => api("/calendars") });
  const [ex, setEx] = useState({ date: "", reason: "Public holiday" });
  if (!q.data) return <Loading />;
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return (
    <>
      {q.data.map((c: any) => (
        <Card key={c.id} title={c.name} extra={c.timezone}>
          <div className="row">
            {c.weekdayMinutes.map((m: number, i: number) => (
              <Field key={i} label={days[i]}>
                <input className="input" style={{ width: 80 }} type="number" defaultValue={m / 60}
                  onBlur={async (e) => {
                    const wm = [...c.weekdayMinutes]; wm[i] = Math.round(Number(e.target.value) * 60);
                    if (wm[i] === c.weekdayMinutes[i]) return;
                    try { await api(`/calendars/${c.id}`, { method: "PUT", body: { weekdayMinutes: wm } }); toast("Calendar updated; capacity recalculates"); qc.invalidateQueries(); }
                    catch (err) { toast(errorText(err), true); }
                  }} />
              </Field>
            ))}
          </div>
          <div className="small" style={{ fontWeight: 600, marginTop: 16 }}>Holidays and exceptions</div>
          {c.exceptions.map((x: any) => <div key={x.id} className="small">{x.date} · {x.reason} · {x.minutes / 60}h</div>)}
          <div className="row" style={{ marginTop: 8 }}>
            <input className="input" style={{ width: 170 }} type="date" value={ex.date} onChange={(e) => setEx({ ...ex, date: e.target.value })} />
            <input className="input" style={{ width: 220 }} value={ex.reason} onChange={(e) => setEx({ ...ex, reason: e.target.value })} />
            <button className="btn" onClick={async () => { try { await post(`/calendars/${c.id}/exceptions`, { ...ex, minutes: 0 }); qc.invalidateQueries(); } catch (e) { toast(errorText(e), true); } }}>Add holiday</button>
          </div>
        </Card>
      ))}
    </>
  );
}

function Integrations() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["integrations"], queryFn: () => api("/admin/integrations/health"), refetchInterval: 10000 });
  if (!q.data) return <Loading />;
  const d = q.data;
  return (
    <>
      <div className="grid-3">
        {d.connectors.map((c: any) => (
          <Card key={c.name} title={c.name}><Chip tone={c.configured ? "success" : "neutral"}>{c.configured ? "Configured" : "Not configured"}</Chip><div className="small muted" style={{ marginTop: 8 }}>{c.detail}</div></Card>
        ))}
      </div>
      <Card title="Outbox / background delivery">
        <div className="row"><Chip>{d.outbox.pending} pending</Chip><Chip>Oldest {d.outbox.oldestAgeSeconds}s</Chip><Chip tone={d.outbox.deadLettered ? "danger" : "success"}>{d.outbox.deadLettered} dead-lettered</Chip></div>
      </Card>
      {d.deadLetters.length > 0 && (
        <Card title="Dead letters" pad={false}>
          <table className="table"><thead><tr><th>Event</th><th>Attempts</th><th>Error</th><th>Correlation</th><th /></tr></thead>
            <tbody>{d.deadLetters.map((e: any) => (
              <tr key={e.id}><td className="mono small">{e.eventType}</td><td className="num">{e.attempts}</td><td className="small">{e.error}</td><td className="mono small">{e.correlationId}</td>
                <td><button className="btn sm" onClick={async () => { await post(`/admin/integrations/dead-letters/${e.id}/replay`); toast("Replay queued"); qc.invalidateQueries({ queryKey: ["integrations"] }); }}>Replay</button></td></tr>
            ))}</tbody></table>
        </Card>
      )}
    </>
  );
}

function Audit() {
  const [action, setAction] = useState("");
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ["audit", action, page], queryFn: () => api(`/admin/audit?page=${page}&pageSize=50${action ? `&action=${encodeURIComponent(action)}` : ""}`) });
  return (
    <Card pad={false} title={<input className="input" style={{ width: 300 }} placeholder="Filter by action prefix, e.g. time_entry." value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} />}
          extra={`${q.data?.total ?? 0} events · append-only`}>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Entity</th><th>Details</th></tr></thead>
          <tbody>
            {(q.data?.items ?? []).map((a: any) => (
              <tr key={a.id}>
                <td className="small nowrap">{fmtDateTime(a.occurredAt)}</td>
                <td className="small">{a.actor?.name ?? "System"}</td>
                <td className="mono small">{a.action}</td>
                <td className="mono small">{a.entityType}</td>
                <td className="mono" style={{ fontSize: 11, maxWidth: 520, wordBreak: "break-word" }}>{JSON.stringify(a.metadata)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row" style={{ padding: 12, justifyContent: "flex-end" }}>
        <button className="btn sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
        <span className="small">Page {page}</span>
        <button className="btn sm" disabled={(q.data?.items ?? []).length < 50} onClick={() => setPage(page + 1)}>Next</button>
      </div>
    </Card>
  );
}
