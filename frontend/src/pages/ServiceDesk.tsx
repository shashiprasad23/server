import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, newKey, post } from "../lib/api";
import { mins } from "../lib/format";
import { useCan } from "../lib/session";
import { LogWorkModal } from "../components/LogWork";
import { Card, Chip, ErrorBanner, Field, Loading, Modal, SlaChip, Stat, StatusChip, useToast } from "../components/ui";
import { SlaTimeline } from "./WorkItem";

export default function ServiceDesk() {
  const [view, setView] = useState<"catalog" | "queue" | "incidents" | "changes" | "sla">("queue");
  const [selected, setSelected] = useState<string | null>(null);
  const [requesting, setRequesting] = useState<any>(null);
  const [logKey, setLogKey] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["queue", view], queryFn: () => api(`/service/queue?view=${view === "catalog" || view === "sla" ? "queue" : view}`), refetchInterval: 30000 });
  const catalog = useQuery({ queryKey: ["catalog"], queryFn: () => api("/service/catalog") });
  if (q.isLoading) return <Loading />;
  if (q.isError) return <ErrorBanner error={q.error} />;
  const d = q.data;
  const current = d.items.find((i: any) => i.key === selected) ?? d.items[0];
  return (
    <>
      <div className="between">
        <div><div className="crumbs">Service desk</div><h1>{d.projects.map((p: any) => p.name).join(", ") || "Service desk"} queue</h1></div>
        <button className="btn primary" onClick={() => setView("catalog")}>New request</button>
      </div>
      <div className="tabs card" style={{ padding: "0 8px" }}>
        {([["catalog", "Catalog"], ["queue", "Queue"], ["incidents", "Incidents"], ["changes", "Changes"], ["sla", "SLA policies"]] as const).map(([k, l]) => (
          <button key={k} className={view === k ? "on" : ""} onClick={() => setView(k)}>{l}</button>
        ))}
      </div>
      {view === "catalog" && (
        <div className="grid-3">
          {(catalog.data ?? []).map((o: any) => (
            <section key={o.id} className="card card-pad stack-sm">
              <div className="between"><h3>{o.name}</h3><Chip>{o.category}</Chip></div>
              <div className="small muted">{o.description}</div>
              <div className="row small"><Chip tone="info">{{ service_request: "Service request", incident: "Incident", change_request: "Change" }[o.requestType as string]}</Chip>
                <span className="subtle">Default {o.defaultPriority}{o.slaPolicy ? ` · ${o.slaPolicy.name}` : ""}</span></div>
              <div><button className="btn" onClick={() => setRequesting(o)}>Request</button></div>
            </section>
          ))}
        </div>
      )}
      {view === "sla" && <SlaPolicies />}
      {view !== "catalog" && view !== "sla" && (
        <>
          <div className="grid-cols">
            <Stat label="Open in queue" value={d.stats.open} />
            <Stat label="Due within 4h" value={d.stats.dueWithin4h} tone={d.stats.dueWithin4h ? "warning" : undefined} />
            <Stat label="Breached" value={d.stats.breached} tone={d.stats.breached ? "danger" : undefined} />
            <Stat label="SLA paused" value={d.stats.paused} />
          </div>
          <div className="grid-2" style={{ gridTemplateColumns: "minmax(0,1fr) 340px" }}>
            <section className="card table-wrap">
              <table className="table">
                <thead><tr><th>Key</th><th>Summary</th><th>Priority</th><th>SLA</th><th>Assignee</th><th>Status</th><th className="right">Logged</th></tr></thead>
                <tbody>
                  {d.items.map((i: any) => (
                    <tr key={i.id} className="clickable" onClick={() => setSelected(i.key)} style={current?.key === i.key ? { background: "#f7f8fd" } : undefined}>
                      <td className="key">{i.key}</td>
                      <td style={{ minWidth: 220 }}>{i.title}<div className="subtle">{i.typeLabel}{i.offering ? ` · ${i.offering}` : ""}</div></td>
                      <td><Chip tone={i.priority === "P1" ? "danger" : i.priority === "P2" ? "warning" : "neutral"}>{i.priority}</Chip></td>
                      <td><SlaChip sla={i.sla} /></td>
                      <td className="small">{i.assignee?.name ?? <span className="muted">Unassigned</span>}</td>
                      <td><StatusChip name={i.statusName} category={i.statusCategory} /></td>
                      <td className="num">{mins(i.loggedMinutes)}</td>
                    </tr>
                  ))}
                  {d.items.length === 0 && <tr><td colSpan={7} className="empty">Queue is clear.</td></tr>}
                </tbody>
              </table>
            </section>
            {current && (
              <div className="stack">
                <section className="card emph card-pad stack-sm">
                  <div className="between"><span className="small muted">{current.key} · {current.typeLabel}</span><SlaChip sla={current.sla} /></div>
                  <h2>{current.title}</h2>
                  <div className="row"><Link className="btn sm" to={`/work-items/${current.key}`}>Open ticket</Link><button className="btn sm primary" onClick={() => setLogKey(current.key)}>Log work</button></div>
                </section>
                <SlaTimeline itemKey={current.key} canEdit serviceFields={current.serviceFields} />
              </div>
            )}
          </div>
        </>
      )}
      {requesting && <RequestModal offering={requesting} onClose={() => setRequesting(null)} />}
      {logKey && <LogWorkModal itemKey={logKey} onClose={() => setLogKey(null)} />}
    </>
  );
}

function RequestModal({ offering, onClose }: { offering: any; onClose: () => void }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [impact, setImpact] = useState("medium");
  const [urgency, setUrgency] = useState("medium");
  const [error, setError] = useState<any>(null);
  const [key] = useState(newKey());
  const submit = async () => {
    try {
      const r = await post(`/service/offerings/${offering.id}/requests`, { title, description, answers, impact, urgency }, key);
      toast(`Request ${r.key} raised · SLA started`);
      qc.invalidateQueries();
      onClose();
      nav(`/work-items/${r.key}`);
    } catch (e) { setError(e); }
  };
  return (
    <Modal wide title={offering.name} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={submit}>Submit request</button></>}>
      <div className="muted small">{offering.description} · routed to {offering.supportGroup || offering.projectName}</div>
      <ErrorBanner error={error} />
      <Field label="Summary" help={`Defaults to “${offering.name}”`}><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
      {offering.formSchema.map((f: any) => (
        <Field key={f.key} label={`${f.label}${f.required ? " *" : ""}`} error={error?.errors?.[f.key]}>
          {f.type === "select" ? (
            <select className="input" value={answers[f.key] ?? ""} onChange={(e) => setAnswers({ ...answers, [f.key]: e.target.value })}><option value="">Choose…</option>{f.options.map((o: string) => <option key={o}>{o}</option>)}</select>
          ) : f.type === "textarea" ? (
            <textarea className="input" value={answers[f.key] ?? ""} onChange={(e) => setAnswers({ ...answers, [f.key]: e.target.value })} />
          ) : (
            <input className="input" type={f.type === "date" ? "date" : f.type === "number" ? "number" : "text"} value={answers[f.key] ?? ""} onChange={(e) => setAnswers({ ...answers, [f.key]: e.target.value })} />
          )}
        </Field>
      ))}
      {offering.requestType === "incident" && (
        <div className="grid-cols">
          <Field label="Impact"><select className="input" value={impact} onChange={(e) => setImpact(e.target.value)}><option>high</option><option>medium</option><option>low</option></select></Field>
          <Field label="Urgency"><select className="input" value={urgency} onChange={(e) => setUrgency(e.target.value)}><option>high</option><option>medium</option><option>low</option></select></Field>
        </div>
      )}
      <Field label="Details"><textarea className="input" value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
    </Modal>
  );
}

function SlaPolicies() {
  const q = useQuery({ queryKey: ["sla-policies"], queryFn: () => api("/service/sla-policies") });
  const can = useCan();
  return (
    <>
      {(q.data ?? []).map((p: any) => (
        <Card key={p.id} title={p.name} extra={`${p.calendar} calendar`} pad={false}>
          <table className="table">
            <thead><tr><th>Priority</th><th className="right">Response target</th><th className="right">Resolution target</th></tr></thead>
            <tbody>{Object.entries(p.targets).map(([k, v]: any) => <tr key={k}><td><Chip>{k}</Chip></td><td className="num">{mins(v.response)}</td><td className="num">{mins(v.resolution)}</td></tr>)}</tbody>
          </table>
        </Card>
      ))}
      <div className="subtle">SLA timers pause only in statuses configured to pause them (e.g. Waiting on requester); every pause, resume and breach is audited.{can.admin ? " Policies are managed by administrators." : ""}</div>
    </>
  );
}
