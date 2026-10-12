import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError, newKey, post } from "../lib/api";
import { fmtDay, mins } from "../lib/format";
import { Field, Modal, useToast } from "./ui";

export type LogWorkPolicy = {
  activityCategories: string[];
  minDescriptionLength: number;
  backdateDays: number;
  earliestDate: string;
  latestDate: string;
  maxEntryMinutes: number;
  periodStart: string;
  periodEnd: string;
};

function parseDuration(text: string): number | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  if (/^\d+$/.test(t)) return parseInt(t, 10);
  if (/^\d+:\d{1,2}$/.test(t)) {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  }
  const m = t.match(/^(?:(\d+(?:\.\d+)?)\s*h)?\s*(?:(\d+)\s*m)?$/);
  if (!m || (!m[1] && !m[2])) return null;
  return Math.round(parseFloat(m[1] ?? "0") * 60) + parseInt(m[2] ?? "0", 10);
}

/** The single Log Work component. Every work-item type uses it; there is no per-type variant (FSD C4, rule 1). */
export function LogWorkForm({ itemKey, policy, remaining, onDone, onCancel }: {
  itemKey: string; policy: LogWorkPolicy; remaining: number | null; onDone?: () => void; onCancel?: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [workDate, setWorkDate] = useState(policy.latestDate);
  const [duration, setDuration] = useState("");
  const [activity, setActivity] = useState(policy.activityCategories[0]);
  const [description, setDescription] = useState("");
  const [action, setAction] = useState<"REDUCE_AUTOMATICALLY" | "KEEP_CURRENT" | "SET_NEW">("REDUCE_AUTOMATICALLY");
  const [newRemaining, setNewRemaining] = useState("");
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // One idempotency key per logical submission: retries (double click, network retry) reuse it.
  const key = useRef(newKey());

  const minutes = useMemo(() => parseDuration(duration), [duration]);
  const projected = remaining === null || minutes === null ? null : Math.max(remaining - minutes, 0);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const local: Record<string, string[]> = {};
    if (minutes === null || minutes <= 0) local.durationMinutes = ["Enter a duration like 1h 30m or 90m"];
    if (description.trim().length < policy.minDescriptionLength)
      local.description = [`Required by project policy · min ${policy.minDescriptionLength} characters`];
    if (action === "SET_NEW" && parseDuration(newRemaining) === null) local.remainingEstimateMinutes = ["Enter the new remaining estimate"];
    setErrors(local);
    if (Object.keys(local).length) return;
    setBusy(true);
    setMessage(null);
    try {
      await post(`/work-items/${itemKey}/time-entries`, {
        workDate, durationMinutes: minutes, activityCategory: activity, description,
        remainingEstimateAction: action, remainingEstimateMinutes: action === "SET_NEW" ? parseDuration(newRemaining) : undefined,
      }, key.current);
      toast(`Logged ${mins(minutes)} on ${itemKey}`);
      key.current = newKey();
      setDuration("");
      setDescription("");
      qc.invalidateQueries();
      onDone?.();
    } catch (err) {
      const ae = err as ApiError;
      setErrors(ae.errors ?? {});
      setMessage(ae.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="stack" onSubmit={submit} noValidate>
      <div className="banner success">
        Period {fmtDay(policy.periodStart)}–{fmtDay(policy.periodEnd)} is open · backdating allowed up to {policy.backdateDays} days
      </div>
      {message && <div className="banner danger" role="alert">{message}</div>}
      <div className="row" style={{ alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: "1 1 140px" }}>
          <Field label="Work date" error={errors.workDate}>
            <input className={`input ${errors.workDate ? "invalid" : ""}`} type="date" value={workDate} min={policy.earliestDate}
                   max={policy.latestDate} onChange={(e) => setWorkDate(e.target.value)} required />
          </Field>
        </div>
        <div style={{ flex: "1 1 110px" }}>
          <Field label="Duration" error={errors.durationMinutes}>
            <input className={`input mono ${errors.durationMinutes ? "invalid" : ""}`} placeholder="1h 30m" value={duration}
                   onChange={(e) => setDuration(e.target.value)} aria-describedby="dur-help" required />
          </Field>
        </div>
      </div>
      <Field label="Activity" error={errors.activityCategory}>
        <select className="input" value={activity} onChange={(e) => setActivity(e.target.value)}>
          {policy.activityCategories.map((c) => <option key={c}>{c}</option>)}
        </select>
      </Field>
      <Field label="Work description" error={errors.description}
             help={`Required by project policy · min ${policy.minDescriptionLength} characters`}>
        <textarea className={`input ${errors.description ? "invalid" : ""}`} value={description}
                  onChange={(e) => setDescription(e.target.value)} rows={3} />
      </Field>
      <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
        <legend style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>Remaining estimate</legend>
        <label className="radio">
          <input type="radio" name="rem" checked={action === "REDUCE_AUTOMATICALLY"} onChange={() => setAction("REDUCE_AUTOMATICALLY")} />
          <span className="grow">Reduce automatically</span>
          {remaining !== null && minutes !== null && <span className="mono small muted">{mins(remaining)} → {mins(projected)}</span>}
        </label>
        <label className="radio">
          <input type="radio" name="rem" checked={action === "KEEP_CURRENT"} onChange={() => setAction("KEEP_CURRENT")} />
          <span>Keep current</span>
        </label>
        <label className="radio">
          <input type="radio" name="rem" checked={action === "SET_NEW"} onChange={() => setAction("SET_NEW")} />
          <span>Set new remaining estimate</span>
        </label>
        {action === "SET_NEW" && (
          <Field label="New remaining estimate" error={errors.remainingEstimateMinutes}>
            <input className="input mono" placeholder="2h" value={newRemaining} onChange={(e) => setNewRemaining(e.target.value)} />
          </Field>
        )}
      </fieldset>
      <div className="row">
        <button className="btn primary grow" disabled={busy} type="submit">
          {busy ? "Saving…" : `Log ${minutes ? mins(minutes) : "work"}`}
        </button>
        {onCancel && <button type="button" className="btn" onClick={onCancel}>Cancel</button>}
      </div>
      <div className="subtle">
        Saved as one entry with an idempotency key; retries never duplicate it. Logging time does not change the ticket status.
      </div>
    </form>
  );
}

/** Opens Log Work for any ticket from lists (My work, service desk, board). */
export function LogWorkModal({ itemKey, onClose }: { itemKey: string; onClose: () => void }) {
  const [state, setState] = useState<{ policy: LogWorkPolicy; remaining: number | null; title: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api(`/work-items/${itemKey}`)
      .then((d) => setState({ policy: d.logWorkPolicy, remaining: d.remainingEstimateMinutes, title: d.title }))
      .catch((e) => setError(e.message));
  }, [itemKey]);
  return (
    <Modal title={`Log work · ${itemKey}`} onClose={onClose}>
      {error && <div className="banner danger">{error}</div>}
      {state && <div className="muted">{state.title}</div>}
      {state && <LogWorkForm itemKey={itemKey} policy={state.policy} remaining={state.remaining} onDone={onClose} onCancel={onClose} />}
    </Modal>
  );
}
