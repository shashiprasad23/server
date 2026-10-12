import { useState, type ReactNode } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, auth, post } from "../lib/api";
import { relative } from "../lib/format";
import { useCan, useMe } from "../lib/session";
import { Avatar } from "./ui";

function Bell() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </svg>
  );
}

function Notifications() {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["notifications"], queryFn: () => api("/notifications"), refetchInterval: 20000 });
  const unread = q.data?.unread ?? 0;
  const markAll = async () => {
    await post("/notifications/read", {});
    qc.invalidateQueries({ queryKey: ["notifications"] });
  };
  return (
    <div style={{ position: "relative" }}>
      <button className="icon-btn" aria-label={`Notifications, ${unread} unread`} onClick={() => setOpen((o) => !o)}>
        <Bell />
        {unread > 0 && <span className="count">{unread}</span>}
      </button>
      {open && (
        <div className="popover" role="dialog" aria-label="Notifications">
          <div className="between" style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
            <strong>Notifications</strong>
            {unread > 0 && <button className="btn link small" onClick={markAll}>Mark all read</button>}
          </div>
          {(q.data?.items ?? []).length === 0 && <div className="empty">You're all caught up.</div>}
          {(q.data?.items ?? []).map((n: any) => (
            <Link key={n.id} to={n.link || "#"} className={`popover-item ${n.read ? "" : "unread"}`}
                  onClick={async () => { setOpen(false); await post("/notifications/read", { ids: [n.id] }); qc.invalidateQueries({ queryKey: ["notifications"] }); }}>
              <div style={{ fontWeight: 600 }}>{n.title}</div>
              {n.body && <div className="small muted">{n.body}</div>}
              <div className="subtle">{relative(n.createdAt)}</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Shell({ children }: { children: ReactNode }) {
  const me = useMe();
  const can = useCan();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [menu, setMenu] = useState(false);
  const approvals = useQuery({ queryKey: ["approvals"], queryFn: () => api("/timesheets/approvals"), enabled: can.approver,
                               refetchInterval: 60000 });
  const pending = (approvals.data?.queue?.length ?? 0) + (approvals.data?.amendments?.length ?? 0);
  const firstDelivery = me.memberships.find((m) => m.projectKind === "delivery");
  const service = me.memberships.some((m) => m.projectKind === "service") || can.admin;
  const links: [string, string, ReactNode?][] = [
    ["/", "My work"],
    ["/projects", "Projects"],
    ...(firstDelivery ? [[`/projects/${firstDelivery.projectId}/board`, "Boards"] as [string, string]] : []),
    ["/timesheets", "Timesheets", pending > 0 ? <span className="nav-badge" aria-label={`${pending} pending approvals`}>{pending}</span> : null],
    ["/resources", "Resources"],
    ...(service ? [["/service", "Service desk"] as [string, string]] : []),
    ["/meetings", "Meetings"],
    ["/reports", "Reports"],
    ...(can.admin ? [["/admin", "Admin"] as [string, string]] : []),
  ];
  return (
    <div className="shell">
      <nav className="sidebar" aria-label="Main">
        <Link to="/" className="brand"><span className="brand-mark">U</span>Unified PM</Link>
        {links.map(([to, label, badge]) => (
          <NavLink key={label} to={to} end={to === "/"} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
            <span>{label}</span>{badge}
          </NavLink>
        ))}
        {me.memberships.length > 0 && <div className="nav-section">My projects</div>}
        {me.memberships.map((m) => (
          <NavLink key={m.projectId} to={`/projects/${m.projectId}`} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
            <span className="row" style={{ gap: 8 }}><i className="dot" style={{ background: m.color }} />{m.projectName}</span>
          </NavLink>
        ))}
      </nav>
      <div className="main">
        <header className="topbar">
          <label htmlFor="global-search">Search</label>
          <form className="grow" style={{ maxWidth: 520 }} onSubmit={(e) => { e.preventDefault(); if (q.trim()) nav(`/search?q=${encodeURIComponent(q.trim())}`); }}>
            <input id="global-search" className="search" style={{ width: "100%" }} placeholder="Tickets, projects, people, meetings"
                   value={q} onChange={(e) => setQ(e.target.value)} />
          </form>
          <div className="grow" />
          <Notifications />
          <div style={{ position: "relative" }}>
            <button className="icon-btn" style={{ border: "none", width: "auto" }} onClick={() => setMenu((m) => !m)}
                    aria-label={`Account menu for ${me.name}`}>
              <Avatar initials={me.initials} title={me.name} />
            </button>
            {menu && (
              <div className="popover" style={{ width: 260 }}>
                <div className="popover-item">
                  <div style={{ fontWeight: 600 }}>{me.name}</div>
                  <div className="subtle">{me.email}</div>
                  <div className="subtle">{me.organization.name} · {me.organization.timezone}</div>
                </div>
                <Link to="/settings" className="popover-item" onClick={() => setMenu(false)}>Notification preferences</Link>
                <button className="popover-item btn link" style={{ width: "100%", textAlign: "left", padding: "12px 16px", color: "var(--danger-fg)" }}
                        onClick={() => { auth.token = null; qc.clear(); nav("/login"); location.reload(); }}>
                  Sign out
                </button>
              </div>
            )}
          </div>
        </header>
        <main className="content" id="main">{children}</main>
      </div>
    </div>
  );
}
