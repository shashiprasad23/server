import { useCallback, useEffect, useState } from 'react';
import { ApiError, Json, api, when } from '../api';

export function Agents({ roles }: { roles: string[] }) {
  const [agents, setAgents] = useState<Json[]>([]);
  const [actions, setActions] = useState<Json[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const canControl = roles.includes('sales_leader') || roles.includes('admin');

  const load = useCallback(async () => {
    const [a, x] = await Promise.all([api<Json[]>('/v1/agents'), api<Json[]>('/v1/agents/actions')]);
    setAgents(a);
    setActions(x);
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load]);

  const act = async (path: string) => {
    setMsg(null);
    try {
      const r = await api(path, { body: {} });
      if (r?.reverted) setMsg(`Reverted: ${r.reverted.join(', ') || 'nothing'}${r.skipped?.length ? ` · Left alone: ${r.skipped.join('; ')}` : ''}`);
      await load();
    } catch (e) {
      setMsg((e as ApiError).message);
    }
  };

  return (
    <>
      <header>
        <h2>Agents</h2>
        <span className="muted">Every action is classified, scoped, logged and reversible.</span>
      </header>
      <div className="agents">
        {agents.map((a) => (
          <article key={a.id} className={`card agent ${a.killed ? 'killed' : ''}`}>
            <div className="row">
              <strong>{a.name}</strong>
              <span className={`chip ${a.killed ? 'cs-blocked' : 'cs-cleared'}`}>{a.killed ? 'stopped' : 'running'}</span>
            </div>
            <p className="small">{a.description}</p>
            <div className="small muted">
              Confidence threshold {a.confidenceThreshold} · outbound {a.outboundMode} · {a.actionsToday}/{a.dailyActionCap} actions today
            </div>
            {canControl && (
              <button className={a.killed ? '' : 'danger'} onClick={() => act(`/v1/agents/${a.id}/${a.killed ? 'resume' : 'kill'}`)}>
                {a.killed ? 'Resume' : 'Kill switch'}
              </button>
            )}
          </article>
        ))}
      </div>
      {msg && <div className="notice">{msg}</div>}
      <h3>Audit trail</h3>
      <table className="list">
        <thead>
          <tr>
            <th>When</th>
            <th>Agent</th>
            <th>Action</th>
            <th>Decision</th>
            <th>Why</th>
            <th>Model</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {actions.map((x) => (
            <tr key={x.id}>
              <td className="small">{when(x.created_at)}</td>
              <td>{x.agent_id}</td>
              <td>
                {x.payload?.summary ?? x.action_type}
                <div className="small muted">
                  {x.action_type} · {x.reversibility} · conf {Number(x.confidence ?? 0).toFixed(2)}
                </div>
              </td>
              <td>
                <span className={`chip d-${x.decision}`}>{x.decision}</span>
              </td>
              <td className="small">{x.reason}</td>
              <td className="small muted">
                {x.model} {x.prompt_version}
              </td>
              <td>{x.decision === 'executed' && <button className="small-btn" onClick={() => act(`/v1/agents/actions/${x.id}/rollback`)}>Roll back</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
