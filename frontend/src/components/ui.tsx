import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { ApiError } from "../lib/api";

export type Tone = "neutral" | "success" | "info" | "warning" | "danger" | "purple" | "dark" | "muted";

export function Chip({ tone = "neutral", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span className={`chip ${tone === "neutral" || tone === "muted" ? "" : tone}`} title={title}>
      {children}
    </span>
  );
}

// State vocabulary from the blueprint: every chip carries a word, never colour alone.
const ENTRY: Record<string, [string, Tone]> = {
  draft: ["Draft", "neutral"],
  submitted: ["Submitted", "info"],
  approved: ["Approved", "success"],
  rejected: ["Rejected", "danger"],
  voided: ["Voided", "neutral"],
  locked: ["Locked", "dark"],
  open: ["Open", "info"],
};
export const EntryChip = ({ status, amendment }: { status: string; amendment?: boolean }) =>
  amendment ? <Chip tone="warning">Amendment requested</Chip> : <Chip tone={ENTRY[status]?.[1]}>{ENTRY[status]?.[0] ?? status}</Chip>;

const MEETING: Record<string, [string, Tone]> = {
  imported: ["Imported", "neutral"],
  queued: ["Queued", "neutral"],
  processing: ["Processing", "info"],
  review_required: ["Review required", "warning"],
  published: ["Published", "success"],
  failed: ["Failed", "danger"],
  archived: ["Archived", "neutral"],
};
export const MeetingChip = ({ status }: { status: string }) => (
  <Chip tone={MEETING[status]?.[1]}>{MEETING[status]?.[0] ?? status}</Chip>
);

const PROPOSAL: Record<string, [string, Tone]> = {
  pending: ["Needs review", "warning"],
  approved: ["Approved", "success"],
  rejected: ["Rejected", "danger"],
};
export const ProposalChip = ({ state }: { state: string }) => <Chip tone={PROPOSAL[state]?.[1]}>{PROPOSAL[state]?.[0]}</Chip>;

const SLA: Record<string, Tone> = { breached: "danger", due_soon: "warning", running: "info", paused: "neutral", met: "success", none: "neutral" };
export const SlaChip = ({ sla }: { sla?: { state: string; label: string } }) =>
  sla ? <Chip tone={SLA[sla.state]}>{sla.state === "paused" ? `SLA paused` : sla.label}</Chip> : null;

const CATEGORY: Record<string, Tone> = { todo: "neutral", in_progress: "info", done: "success" };
export const StatusChip = ({ name, category }: { name: string; category: string }) => (
  <Chip tone={name === "Blocked" ? "danger" : CATEGORY[category]}>{name}</Chip>
);

export const TypeChip = ({ label }: { label: string }) => <Chip>{label}</Chip>;

export function Avatar({ initials, small, title }: { initials?: string; small?: boolean; title?: string }) {
  return (
    <span className={`avatar ${small ? "sm" : ""}`} title={title} aria-label={title}>
      {initials ?? "–"}
    </span>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: string }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className={`value ${tone ? `tone-${tone}` : ""}`}>{value}</div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function Card({ title, extra, children, className = "", pad = true }: {
  title?: ReactNode; extra?: ReactNode; children: ReactNode; className?: string; pad?: boolean;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || extra) && (
        <div className="card-head">
          {typeof title === "string" ? <h2>{title}</h2> : title}
          {extra && <div className="subtle">{extra}</div>}
        </div>
      )}
      {pad ? <div className="card-pad" style={title ? { paddingTop: 4 } : undefined}>{children}</div> : children}
    </section>
  );
}

export function Field({ label, help, error, children }: { label: string; help?: ReactNode; error?: string[]; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {error?.map((e) => <span key={e} className="err" role="alert">{e}</span>)}
      {help && !error?.length && <span className="help">{help}</span>}
    </label>
  );
}

export function ErrorBanner({ error }: { error: unknown }) {
  if (!error) return null;
  const e = error as ApiError;
  return (
    <div className="banner danger" role="alert">
      {e.message ?? String(error)}
      {e.errors && Object.keys(e.errors).length > 0 && (
        <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
          {Object.entries(e.errors).map(([k, v]) => (
            <li key={k}>{Array.isArray(v) ? v.join(" ") : String(v)}{/^\d{4}-/.test(k) ? ` (${k})` : ""}</li>
          ))}
        </ul>
      )}
      {e.correlationId && <div className="subtle" style={{ marginTop: 4 }}>Correlation id {e.correlationId}</div>}
    </div>
  );
}

export function Modal({ title, onClose, children, footer, wide }: {
  title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} style={wide ? { width: "min(860px, 100%)" } : undefined}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn sm" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export const Loading = ({ label = "Loading…" }: { label?: string }) => <div className="spinner">{label}</div>;
export const Empty = ({ children }: { children: ReactNode }) => <div className="empty">{children}</div>;

// ---------------------------------------------------------------- toasts
type ToastT = { id: number; text: string; error?: boolean };
const ToastCtx = createContext<(text: string, error?: boolean) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastT[]>([]);
  const push = useCallback((text: string, error?: boolean) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, error }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite">
        {toasts.map((t, i) => (
          <div key={t.id} className={`toast ${t.error ? "error" : ""}`} style={{ bottom: 24 + i * 60 }}>{t.text}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

export function errorText(e: unknown): string {
  const err = e as ApiError;
  const first = err?.errors ? Object.values(err.errors)[0]?.[0] : undefined;
  return first ? `${err.message}: ${first}` : err?.message ?? "Something went wrong";
}
