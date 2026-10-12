import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Avatar, Card, Chip, Loading, MeetingChip } from "../components/ui";

export default function SearchPage() {
  const [params] = useSearchParams();
  const q = params.get("q") ?? "";
  const r = useQuery({ queryKey: ["search", q], queryFn: () => api(`/search?q=${encodeURIComponent(q)}`), enabled: q.length >= 2 });
  if (!r.data) return <Loading />;
  const d = r.data;
  const total = d.workItems.length + d.projects.length + d.people.length + d.services.length + d.meetings.length;
  return (
    <>
      <h1>Search · “{q}”</h1>
      <div className="muted">{total} result(s). Results only include records you are already allowed to see.</div>
      {d.workItems.length > 0 && (
        <Card title="Tickets" pad={false}>
          <table className="table"><tbody>{d.workItems.map((w: any) => (
            <tr key={w.key}><td className="key"><Link to={`/work-items/${w.key}`}>{w.key}</Link></td><td>{w.title}</td><td><Chip>{w.type}</Chip></td><td className="small">{w.status}</td></tr>
          ))}</tbody></table>
        </Card>
      )}
      {d.meetings.length > 0 && (
        <Card title="Meetings & decisions">
          {d.meetings.map((m: any) => (
            <div key={m.id} className="stack-sm" style={{ marginBottom: 10 }}>
              <div className="row"><Link to={`/meetings/${m.id}`}><strong>{m.title}</strong></Link><MeetingChip status={m.status} /><span className="subtle">{m.projectKey}</span></div>
              {m.decisions.map((d: string, i: number) => <div key={i} className="small muted">Decision: {d}</div>)}
            </div>
          ))}
        </Card>
      )}
      {d.projects.length > 0 && <Card title="Projects">{d.projects.map((p: any) => <div key={p.id}><Link to={`/projects/${p.id}`}>{p.name}</Link> <span className="subtle">{p.key}</span></div>)}</Card>}
      {d.services.length > 0 && <Card title="Service offerings">{d.services.map((s: any) => <div key={s.id}><Link to="/service">{s.name}</Link> <span className="subtle">{s.category}</span></div>)}</Card>}
      {d.people.length > 0 && <Card title="People"><div className="stack-sm">{d.people.map((u: any) => <div key={u.id} className="row"><Avatar small initials={u.initials} />{u.name}<span className="subtle">{u.email}</span></div>)}</div></Card>}
      {total === 0 && <Card><div className="empty">No results.</div></Card>}
    </>
  );
}
