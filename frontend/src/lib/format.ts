export function mins(m: number | null | undefined, empty = "—"): string {
  if (m === null || m === undefined) return empty;
  const sign = m < 0 ? "−" : "";
  const a = Math.abs(Math.round(m));
  return `${sign}${Math.floor(a / 60)}h ${String(a % 60).padStart(2, "0")}m`;
}

export function signedMins(m: number | null | undefined): string {
  if (m === null || m === undefined) return "—";
  return m > 0 ? `+${mins(m)}` : mins(m);
}

export function hours(m: number | null | undefined): string {
  if (m === null || m === undefined) return "—";
  const h = m / 60;
  return `${Number.isInteger(h) ? h : h.toFixed(1)}h`;
}

export function pct(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "N/A";
  return `${v.toFixed(digits)}%`;
}

const D = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" });
const DY = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
const DT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export const parseDay = (s: string) => new Date(`${s}T00:00:00`);
export const fmtDay = (s?: string | null) => (s ? D.format(parseDay(s)) : "—");
export const fmtDayYear = (s?: string | null) => (s ? DY.format(parseDay(s)) : "—");
export const fmtDateTime = (s?: string | null) => (s ? DT.format(new Date(s)) : "—");

export function isoDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDays(s: string, n: number): string {
  const d = parseDay(s);
  d.setDate(d.getDate() + n);
  return isoDay(d);
}

export function mondayOf(s: string): string {
  const d = parseDay(s);
  const wd = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - wd);
  return isoDay(d);
}

export function isoWeek(s: string): number {
  const d = parseDay(s);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const jan4 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d.getTime() - jan4.getTime()) / 86400000 - 3 + ((jan4.getDay() + 6) % 7)) / 7);
}

export function relative(s: string): string {
  const diff = (Date.now() - new Date(s).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export const ROLE_LABELS: Record<string, string> = {
  project_admin: "Project admin",
  project_manager: "Project manager",
  contributor: "Contributor",
  qa: "QA",
  service_agent: "Service agent",
  service_owner: "Service owner",
  approver: "Approver",
  ai_reviewer: "AI reviewer",
  viewer: "Viewer",
  platform_admin: "Platform admin",
  resource_manager: "Resource manager",
  executive_viewer: "Executive viewer",
};

export const roleLabel = (r: string) => ROLE_LABELS[r] ?? r;
