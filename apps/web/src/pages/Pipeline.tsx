import { useCallback, useEffect, useState } from 'react';
import { ApiError, Json, api, money, when } from '../api';

interface Stage {
  key: string;
  label: string;
  is_closed: boolean;
  entry_rules: string[];
}

const SIGNAL_FIELDS: [string, string][] = [
  ['workload', 'Workload'],
  ['gpu_model', 'GPU model'],
  ['gpu_count', 'GPUs'],
  ['node_count', 'Nodes'],
  ['oem', 'OEM'],
  ['deployment_location', 'Deploys at'],
  ['cooling', 'Cooling'],
  ['kw_per_rack', 'kW per rack'],
  ['destination_country', 'Ship to'],
  ['end_user', 'End user'],
];

export function Pipeline({ roles }: { roles: string[] }) {
  const [stages, setStages] = useState<Stage[]>([]);
  const [opps, setOpps] = useState<Json[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    const [s, o] = await Promise.all([api<Stage[]>('/v1/metadata/stages'), api<{ items: Json[] }>(`/v1/records/opportunities?limit=200${q ? `&q=${encodeURIComponent(q)}` : ''}`)]);
    setStages(s);
    setOpps(o.items);
  }, [q]);

  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load]);

  const total = opps.filter((o) => !stages.find((s) => s.key === o.stage_key)?.is_closed).reduce((a, o) => a + Number(o.expected_value ?? 0), 0);

  return (
    <>
      <header>
        <h2>Pipeline</h2>
        <span className="muted">
          {opps.length} opportunities · open value {money(total)}
        </span>
        <input placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
      </header>
      <div className="board">
        {stages.map((s) => {
          const items = opps.filter((o) => o.stage_key === s.key);
          return (
            <section key={s.key} className="column">
              <h3>
                {s.label} <span className="muted">{items.length}</span>
              </h3>
              {items.map((o) => (
                <article key={o.id} className="card" onClick={() => setOpen(o.id)}>
                  <strong>{o.name}</strong>
                  <div className="muted small">
                    {[o.gpu_count && `${o.gpu_count} x`, o.gpu_model].filter(Boolean).join(' ') || 'Requirements not captured yet'}
                  </div>
                  <div className="row small">
                    <span className={`chip ch-${o.channel}`}>{o.channel}</span>
                    <span>{money(o.expected_value, o.currency)}</span>
                  </div>
                  {o.compliance_status !== 'not_screened' && <div className={`small cs-${o.compliance_status}`}>Compliance: {o.compliance_status}</div>}
                </article>
              ))}
            </section>
          );
        })}
      </div>
      {open && <OpportunityDrawer id={open} stages={stages} roles={roles} onClose={() => setOpen(null)} onChanged={load} />}
    </>
  );
}

function OpportunityDrawer({ id, stages, roles, onClose, onChanged }: { id: string; stages: Stage[]; roles: string[]; onClose: () => void; onChanged: () => void }) {
  const [opp, setOpp] = useState<Json | null>(null);
  const [history, setHistory] = useState<Json[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Json>({});

  const load = useCallback(async () => {
    const [o, h] = await Promise.all([api(`/v1/records/opportunities/${id}`), api<Json[]>(`/v1/records/opportunities/${id}/history`)]);
    setOpp(o);
    setHistory(h);
    setDraft({});
  }, [id]);
  useEffect(() => {
    load();
  }, [load]);

  const save = async (patch: Json) => {
    setError(null);
    try {
      await api(`/v1/records/opportunities/${id}`, { method: 'PATCH', body: patch, headers: { 'if-match': String(opp?.version) } });
      await load();
      onChanged();
    } catch (e) {
      const err = e as ApiError;
      const details = Array.isArray(err.details) ? ' ' + (err.details as Json[]).map((d) => d.message).join('; ') : '';
      setError(err.message + details);
    }
  };

  if (!opp) return null;
  const sourceOf = (field: string) => history.find((h) => h.field === field);

  return (
    <aside className="drawer">
      <button className="close" onClick={onClose}>
        ×
      </button>
      <h2>{opp.name}</h2>
      <div className="row">
        <select value={opp.stage_key} onChange={(e) => save({ stage_key: e.target.value })}>
          {stages.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
        <span className={`chip ch-${opp.channel}`}>{opp.channel}</span>
        <span className="muted small">v{opp.version}</span>
      </div>
      {error && <div className="error">{error}</div>}

      <h4>Requirements</h4>
      <table className="fields">
        <tbody>
          {SIGNAL_FIELDS.map(([f, label]) => {
            const src = sourceOf(f);
            return (
              <tr key={f}>
                <th>{label}</th>
                <td>
                  <input
                    value={draft[f] ?? opp[f] ?? ''}
                    placeholder="insufficient evidence"
                    onChange={(e) => setDraft({ ...draft, [f]: e.target.value })}
                    onBlur={() => {
                      if (draft[f] === undefined || draft[f] === (opp[f] ?? '')) return;
                      const v = draft[f] === '' ? null : ['gpu_count', 'node_count'].includes(f) || f === 'kw_per_rack' ? Number(draft[f]) : draft[f];
                      save({ [f]: v });
                    }}
                  />
                </td>
                <td className="small muted" title={src?.evidence?.[0]?.quote ?? ''}>
                  {src ? `${src.source === 'agent' ? `AI (${src.actor_id})` : src.source}${src.confidence ? ` · ${Number(src.confidence).toFixed(2)}` : ''}` : ''}
                  {src?.evidence?.[0]?.quote && <div className="quote">“{src.evidence[0].quote}”</div>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h4>Commercial</h4>
      <table className="fields">
        <tbody>
          <tr>
            <th>Expected value</th>
            <td>{money(opp.expected_value, opp.currency)}</td>
          </tr>
          {'est_margin' in opp && (
            <tr>
              <th>Est. margin</th>
              <td>{money(opp.est_margin, opp.currency)}</td>
            </tr>
          )}
          <tr>
            <th>Compliance</th>
            <td>
              {opp.compliance_status}
              {(roles.includes('trade_compliance') || roles.includes('admin')) && opp.compliance_status !== 'cleared' && (
                <button className="small-btn" onClick={() => save({ compliance_status: 'cleared' })}>
                  Clear
                </button>
              )}
            </td>
          </tr>
          <tr>
            <th>NetSuite sales order</th>
            <td>{opp.netsuite_sales_order_id ?? opp.order_reference ?? '—'}</td>
          </tr>
        </tbody>
      </table>
      <p className="muted small">Orders, invoices and payments live in NetSuite; ATLAS-I keeps only the reference.</p>

      <h4>Field history</h4>
      <ul className="history">
        {history.slice(0, 25).map((h, i) => (
          <li key={i}>
            <span className="small muted">{when(h.created_at)}</span> <b>{h.field}</b> → {JSON.stringify(h.new_value)}{' '}
            <span className="small muted">({h.source === 'agent' ? h.actor_id : h.source})</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}
