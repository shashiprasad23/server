import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, newKey, post } from "../lib/api";
import { ErrorBanner, Field, Modal } from "./ui";

const DELIVERY_TYPES = ["story", "task", "bug", "subtask", "test_task", "epic"];
const SERVICE_TYPES = ["service_request", "incident", "change_request"];

export default function CreateItem({ project, defaults, onClose }: { project: any; defaults?: any; onClose: () => void }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const isService = project.kind === "service";
  const types = isService ? SERVICE_TYPES : DELIVERY_TYPES;
  const [f, setF] = useState<any>({ type: types[0], title: "", description: "", parentId: "", assigneeId: "",
    originalEstimateMinutes: "", storyPoints: "", sprintId: "", dueDate: "", priority: isService ? "P3" : "medium", ...defaults });
  const [error, setError] = useState<any>(null);
  const [key] = useState(newKey());
  const parents = useQuery({ queryKey: ["parents", project.id], queryFn: () => api(`/projects/${project.id}/work-items?pageSize=200&type=epic,story,task,bug,test_task`) });
  const save = async () => {
    const body: any = { projectId: project.id, type: f.type, title: f.title, description: f.description, priority: f.priority };
    for (const k of ["parentId", "assigneeId", "sprintId", "dueDate"]) if (f[k]) body[k] = f[k];
    if (f.originalEstimateMinutes) body.originalEstimateMinutes = f.originalEstimateMinutes;
    if (f.storyPoints !== "") body.storyPoints = Number(f.storyPoints);
    try {
      const item = await post("/work-items", body, key);
      qc.invalidateQueries();
      onClose();
      nav(`/work-items/${item.key}`);
    } catch (e) { setError(e); }
  };
  return (
    <Modal wide title={`New work item · ${project.name}`} onClose={onClose}
           footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Create</button></>}>
      <ErrorBanner error={error} />
      <div className="grid-cols">
        <Field label="Type"><select className="input" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{types.map((t) => <option key={t} value={t}>{project.typeLabels?.[t] ?? t}</option>)}</select></Field>
        <Field label="Priority"><select className="input" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>
          {(isService ? ["P1", "P2", "P3", "P4"] : ["lowest", "low", "medium", "high", "highest"]).map((p) => <option key={p}>{p}</option>)}</select></Field>
      </div>
      <Field label="Title" error={error?.errors?.title}><input className="input" autoFocus value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
      <Field label="Description"><textarea className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      <div className="grid-cols">
        {!isService && (
          <Field label="Parent" error={error?.errors?.parentId}>
            <select className="input" value={f.parentId} onChange={(e) => setF({ ...f, parentId: e.target.value })}>
              <option value="">None</option>
              {parents.data?.items.map((p: any) => <option key={p.id} value={p.id}>{p.key} · {p.title}</option>)}
            </select>
          </Field>
        )}
        <Field label="Assignee" error={error?.errors?.assigneeId}>
          <select className="input" value={f.assigneeId} onChange={(e) => setF({ ...f, assigneeId: e.target.value })}>
            <option value="">Unassigned</option>
            {project.members.map((m: any) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
          </select>
        </Field>
        <Field label="Original estimate" help="e.g. 4h or 90m" error={error?.errors?.originalEstimateMinutes}>
          <input className="input mono" value={f.originalEstimateMinutes} onChange={(e) => setF({ ...f, originalEstimateMinutes: e.target.value })} />
        </Field>
        {!isService && <Field label="Story points"><input className="input" type="number" min={0} value={f.storyPoints} onChange={(e) => setF({ ...f, storyPoints: e.target.value })} /></Field>}
        {!isService && (
          <Field label="Sprint" error={error?.errors?.sprintId}>
            <select className="input" value={f.sprintId} onChange={(e) => setF({ ...f, sprintId: e.target.value })}>
              <option value="">Backlog</option>
              {project.sprints.filter((s: any) => s.state !== "closed").map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
        )}
        <Field label="Due date"><input className="input" type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /></Field>
      </div>
      {project.settings?.estimates?.required_types?.includes(f.type) && !f.originalEstimateMinutes && (
        <div className="banner info">This project requires an original estimate for this type before sprint commitment or active work.</div>
      )}
    </Modal>
  );
}
