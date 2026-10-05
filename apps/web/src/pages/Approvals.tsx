import { useCallback, useEffect, useState } from 'react';
import { Json, api, when } from '../api';

export function Approvals({ onChange }: { onChange: (n: number) => void }) {
  const [items, setItems] = useState<Json[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const a = await api<Json[]>('/v1/approvals');
    setItems(a);
    onChange(a.length);
  }, [onChange]);
  useEffect(() => {
    load();
  }, [load]);

  const decide = async (id: string, verb: 'approve' | 'reject') => {
    setBusy(id);
    try {
      await api(`/v1/approvals/${id}/${verb}`, { body: verb === 'reject' ? { note: prompt('Reason for rejecting?') ?? undefined } : {} });
      await load();
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <header>
        <h2>Approvals</h2>
        <span className="muted">Agent actions waiting on a person. Nothing here is approved automatically; items expire.</span>
      </header>
      {!items.length && <p className="muted">Nothing waiting for you.</p>}
      {items.map((a) => (
        <article key={a.id} className="approval">
          <div className="row">
            <strong>{a.summary}</strong>
            <span className="chip">{a.agent_id}</span>
            <span className="chip">{a.action_type}</span>
            <span className="muted small">confidence {Number(a.confidence ?? 0).toFixed(2)} · expires {when(a.expires_at)}</span>
          </div>
          <div className="muted small">Why it is waiting: {a.reason}</div>
          {a.action_type === 'send_email' && (
            <pre className="email">
              To: {a.payload.to}
              {'\n'}Subject: {a.payload.subject}
              {'\n\n'}
              {a.payload.body}
            </pre>
          )}
          {a.action_type === 'update_fields' && <pre className="email">{JSON.stringify(a.payload.fields, null, 2)}</pre>}
          {!!a.evidence?.length && (
            <details>
              <summary className="small">Evidence ({a.evidence.length})</summary>
              {a.evidence.map((e: Json, i: number) => (
                <div key={i} className="quote small">
                  {e.field}: “{e.quote}”
                </div>
              ))}
            </details>
          )}
          <div className="row">
            <button disabled={busy === a.id} onClick={() => decide(a.id, 'approve')}>
              Approve
            </button>
            <button className="secondary" disabled={busy === a.id} onClick={() => decide(a.id, 'reject')}>
              Reject
            </button>
          </div>
        </article>
      ))}
    </>
  );
}
