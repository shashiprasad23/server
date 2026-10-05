import { useEffect, useState } from 'react';
import { Json, api, when } from '../api';

export function Accounts() {
  const [q, setQ] = useState('');
  const [items, setItems] = useState<Json[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<Json | null>(null);

  useEffect(() => {
    api<{ items: Json[] }>(`/v1/records/accounts?limit=100${q ? `&q=${encodeURIComponent(q)}` : ''}`).then((r) => setItems(r.items));
  }, [q]);
  useEffect(() => {
    if (open) api(`/v1/timeline/accounts/${open}`).then(setTimeline);
  }, [open]);

  return (
    <>
      <header>
        <h2>Accounts</h2>
        <input placeholder="Search name or domain" value={q} onChange={(e) => setQ(e.target.value)} />
      </header>
      <div className="split">
        <table className="list">
          <thead>
            <tr>
              <th>Account</th>
              <th>Domain</th>
              <th>First seen</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {items.map((a) => (
              <tr key={a.id} className={open === a.id ? 'selected' : ''} onClick={() => setOpen(a.id)}>
                <td>{a.name}</td>
                <td className="muted">{a.domain}</td>
                <td>
                  <span className={`chip ch-${a.channel_first_seen}`}>{a.channel_first_seen ?? 'rep'}</span>
                </td>
                <td className="small">{when(a.updated_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {timeline && (
          <section className="timeline">
            <h3>{timeline.account.name}: one timeline across every channel</h3>
            {timeline.items.map((i: Json) => (
              <div key={`${i.kind}-${i.id}`} className={`tl tl-${i.kind}`}>
                <div className="small muted">
                  {when(i.at)} · {i.kind === 'activity' ? `${i.source} ${i.subtype}${i.direction ? ` (${i.direction})` : ''}` : i.kind === 'agent_action' ? `${i.source} · ${i.direction}` : `opportunity · ${i.direction}`}
                </div>
                <div>{i.title ?? i.subtype}</div>
                {i.kind === 'activity' && i.meta?.summary && <div className="small">AI summary: {i.meta.summary}</div>}
                {i.kind === 'activity' && i.detail && <div className="small muted clamp">{i.detail}</div>}
              </div>
            ))}
          </section>
        )}
      </div>
    </>
  );
}
