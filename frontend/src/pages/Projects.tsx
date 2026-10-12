import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, post } from "../lib/api";
import { roleLabel } from "../lib/format";
import { useCan, useMe } from "../lib/session";
import { Card, Chip, ErrorBanner, Field, Loading, Modal } from "../components/ui";

export default function Projects() {
  const q = useQuery({ queryKey: ["projects"], queryFn: () => api("/projects") });
  const me = useMe();
  const can = useCan();
  const [creating, setCreating] = useState(false);
  const canCreate = can.admin || me.memberships.some((m) => ["project_manager", "project_admin"].includes(m.role));
  if (q.isLoading) return <Loading />;
  return (
    <>
      <div className="between">
        <h1>Projects</h1>
        {canCreate && <button className="btn primary" onClick={() => setCreating(true)}>New project</button>}
      </div>
      <div className="grid-3">
        {(q.data ?? []).map((p: any) => (
          <Link key={p.id} to={`/projects/${p.id}`} className="card card-pad stack-sm" style={{ textDecoration: "none", color: "var(--text)" }}>
            <div className="between"><div className="row"><i className="dot" style={{ background: p.color, width: 12, height: 12 }} /><h3>{p.name}</h3></div><Chip>{p.key}</Chip></div>
            <div className="small muted">{p.description || p.methodology}</div>
            <div className="row"><Chip tone={p.kind === "service" ? "purple" : "info"}>{p.kind === "service" ? "Service queue" : "Delivery"}</Chip>
              {p.myRole && <Chip>{roleLabel(p.myRole)}</Chip>}<span className="subtle">{p.itemCount} items</span></div>
          </Link>
        ))}
      </div>
      {creating && <CreateProject onClose={() => setCreating(false)} />}
    </>
  );
}

function CreateProject({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [f, setF] = useState({ key: "", name: "", description: "", kind: "delivery" });
  const [error, setError] = useState<any>(null);
  const save = async () => {
    try {
      const p = await post("/projects", f);
      qc.invalidateQueries();
      nav(`/projects/${p.id}`);
      onClose();
    } catch (e) { setError(e); }
  };
  return (
    <Modal title="New project" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Create project</button></>}>
      <ErrorBanner error={error} />
      <Field label="Name" error={error?.errors?.name}><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <Field label="Key" help="2–10 letters; prefixes ticket keys (e.g. WP-1042)" error={error?.errors?.key}><input className="input mono" value={f.key} onChange={(e) => setF({ ...f, key: e.target.value.toUpperCase() })} /></Field>
      <Field label="Type"><select className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="delivery">Delivery (agile)</option><option value="service">Service queue (SLA)</option></select></Field>
      <Field label="Description"><textarea className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      <Card><div className="small muted">You become the project manager and time approver. Workflow, required estimates, activity categories and time rules can be adjusted under Settings.</div></Card>
    </Modal>
  );
}
