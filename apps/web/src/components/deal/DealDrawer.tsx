import { useState } from 'react';
import { Building2, Cpu, Lightbulb, Quote, Sparkles, Users } from 'lucide-react';
import { api, date, label, money, when, type Json } from '@/api';
import { useSession } from '@/lib/session';
import { RiskMeter, CHANNEL_LABEL } from '@/components/charts';
import { Badge, Button, Card, Drawer, ErrorNote, Field, KeyValue, Spinner, Tabs, useAction, useData } from '@/components/ui';
import type { Stage } from '@/pages/Pipeline';
import { QuoteTab } from './QuoteTab';
import { ComplianceTab } from './ComplianceTab';
import { PlanTab } from './PlanTab';

type Tab = 'overview' | 'quote' | 'compliance' | 'plan' | 'history';

const FIELDS: { key: string; label: string; type: 'text' | 'number' | 'enum' | 'date'; options?: string[] }[] = [
  { key: 'workload', label: 'Workload', type: 'enum', options: ['training', 'fine_tuning', 'inference', 'hpc', 'mixed', 'unknown'] },
  { key: 'gpu_model', label: 'GPU model', type: 'text' },
  { key: 'gpu_count', label: 'GPUs', type: 'number' },
  { key: 'node_count', label: 'Nodes', type: 'number' },
  { key: 'oem', label: 'OEM', type: 'text' },
  { key: 'deployment_location', label: 'Deploys at', type: 'enum', options: ['customer_site', 'colocation', 'uvation_hosted', 'unknown'] },
  { key: 'cooling', label: 'Cooling', type: 'enum', options: ['air', 'liquid', 'rear_door', 'unknown'] },
  { key: 'kw_per_rack', label: 'kW per rack', type: 'number' },
  { key: 'destination_country', label: 'Ship to', type: 'text' },
  { key: 'end_user', label: 'End user', type: 'text' },
  { key: 'expected_ship_date', label: 'Ship date', type: 'date' },
];

export function DealDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  return (
    <Drawer open={!!id} onClose={onClose} wide>
      {id && <DealBody key={id} id={id} />}
    </Drawer>
  );
}

function DealBody({ id }: { id: string }) {
  const { touch, version } = useSession();
  const [tab, setTab] = useState<Tab>('overview');
  const deal = useData(
    () =>
      Promise.all([
        api<Json>(`/v1/records/opportunities/${id}`),
        api<Stage[]>('/v1/metadata/stages'),
        api<Json[]>(`/v1/records/opportunities/${id}/history`),
        api<Json>(`/v1/opportunities/${id}/brief`),
      ]),
    [id, version],
  );
  const act = useAction();

  if (!deal.data) return <div className="p-6">{deal.error ? <ErrorNote error={deal.error} /> : <Spinner />}</div>;
  const [opp, stages, history, brief] = deal.data;

  const save = (patch: Json) =>
    act.run('save', async () => {
      await api(`/v1/records/opportunities/${id}`, { method: 'PATCH', body: patch, headers: { 'if-match': String(opp.version) } });
      await deal.reload();
      touch();
    });
  const refresh = async () => {
    await deal.reload();
    touch();
  };

  return (
    <div className="p-5 pt-6">
      <div className="pr-8">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Building2 className="h-3.5 w-3.5" /> {brief.account?.name ?? 'No account'}
          <span>·</span>
          {CHANNEL_LABEL[opp.channel] ?? opp.channel}
          <span>·</span>v{opp.version}
        </div>
        <h2 className="mt-1 text-xl font-semibold tracking-tight">{opp.name}</h2>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <select
            aria-label="Stage"
            className="h-8 rounded-md border border-border bg-card px-2 text-sm"
            value={opp.stage_key}
            onChange={(e) => save({ stage_key: e.target.value })}
            disabled={act.busy === 'save'}
          >
            {stages.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
          <span className="text-lg font-semibold tabular-nums">{money(opp.expected_value, opp.currency)}</span>
          {'est_margin' in opp && opp.est_margin != null && <span className="text-xs text-muted-foreground">est. margin {money(opp.est_margin)}</span>}
          <RiskMeter value={opp.risk_score} />
          {opp.ai_probability != null && <span className="text-xs text-muted-foreground">AI win probability {opp.ai_probability}%</span>}
          <Badge>{opp.compliance_status}</Badge>
        </div>
      </div>
      <ErrorNote error={act.error} />

      <div className="mt-4">
        <Tabs<Tab>
          tabs={[
            ['overview', 'Overview'],
            ['quote', 'Configure & quote'],
            ['compliance', 'Compliance'],
            ['plan', 'Site & plan'],
            ['history', 'History'],
          ]}
          value={tab}
          onChange={setTab}
        />
      </div>
      <div className="mt-4">
        {tab === 'overview' && <Overview opp={opp} brief={brief} history={history} save={save} busy={act.busy === 'save'} onChanged={refresh} />}
        {tab === 'quote' && <QuoteTab opp={opp} onChanged={refresh} />}
        {tab === 'compliance' && <ComplianceTab opp={opp} onChanged={refresh} />}
        {tab === 'plan' && <PlanTab opp={opp} />}
        {tab === 'history' && <History history={history} />}
      </div>
    </div>
  );
}

function Overview({ opp, brief, history, save, busy, onChanged }: { opp: Json; brief: Json; history: Json[]; save: (p: Json) => void; busy: boolean; onChanged: () => void }) {
  const [draft, setDraft] = useState<Json>({});
  const sourceOf = (field: string) => history.find((h) => h.field === field);
  const commit = (f: (typeof FIELDS)[number]) => {
    if (!(f.key in draft)) return;
    const raw = draft[f.key];
    const v = raw === '' ? null : f.type === 'number' ? Number(raw) : raw;
    setDraft((d) => {
      const n = { ...d };
      delete n[f.key];
      return n;
    });
    if (v !== (opp[f.key] ?? null)) save({ [f.key]: v });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <div className="space-y-4 lg:col-span-3">
        <Card
          title={
            <span className="inline-flex items-center gap-1.5">
              <Sparkles className="h-4 w-4 text-primary" /> Deal brief
            </span>
          }
        >
          <p className="text-sm">{brief.headline}</p>
          {brief.risks?.length > 0 && (
            <ul className="mt-2 space-y-1 text-sm">
              {brief.risks.map((r: Json, i: number) => (
                <li key={i} className="flex justify-between gap-2">
                  <span>{r.reason}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">+{r.points}</span>
                </li>
              ))}
            </ul>
          )}
          {brief.nextActions?.length > 0 && (
            <div className="mt-3 rounded-lg bg-accent p-3">
              <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-primary">
                <Lightbulb className="h-3.5 w-3.5" /> Next best actions
              </div>
              <ul className="list-disc space-y-0.5 pl-5 text-sm">
                {brief.nextActions.map((a: string) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </div>
          )}
        </Card>

        <Card
          title={
            <span className="inline-flex items-center gap-1.5">
              <Cpu className="h-4 w-4" /> Requirement sheet
            </span>
          }
          action={busy && <Spinner />}
        >
          <p className="mb-3 text-xs text-muted-foreground">Filled by the capture agent from customer messages, with the quote it relied on. Edit any value; your edit wins and is recorded.</p>
          <div className="divide-y divide-border">
            {FIELDS.map((f) => {
              const src = sourceOf(f.key);
              const value = f.key in draft ? draft[f.key] : (opp[f.key] ?? '');
              return (
                <div key={f.key} className="grid grid-cols-[110px_1fr] items-start gap-3 py-2 sm:grid-cols-[110px_180px_1fr]">
                  <span className="pt-1.5 text-xs text-muted-foreground">{f.label}</span>
                  {f.type === 'enum' ? (
                    <select
                      className="h-8 rounded-md border border-border bg-background px-2 text-sm"
                      value={value}
                      onChange={(e) => save({ [f.key]: e.target.value || null })}
                    >
                      <option value="">—</option>
                      {f.options!.map((o) => (
                        <option key={o} value={o}>
                          {label(o)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                      className="h-8 rounded-md border border-border bg-background px-2 text-sm"
                      value={f.type === 'date' && value ? String(value).slice(0, 10) : value}
                      placeholder="not captured"
                      onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                      onBlur={() => commit(f)}
                      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                    />
                  )}
                  <div className="col-span-2 text-xs text-muted-foreground sm:col-span-1">
                    {src && (
                      <>
                        <span>
                          {src.source === 'agent' ? `AI · ${label(src.actor_id)}` : label(src.source)}
                          {src.confidence ? ` · ${Number(src.confidence).toFixed(2)}` : ''}
                        </span>
                        {src.evidence?.[0]?.quote && (
                          <div className="mt-0.5 flex gap-1 italic">
                            <Quote className="h-3 w-3 shrink-0" />
                            <span className="line-clamp-2">{src.evidence[0].quote}</span>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      <div className="space-y-4 lg:col-span-2">
        <Card
          title={
            <span className="inline-flex items-center gap-1.5">
              <Users className="h-4 w-4" /> Buying committee
            </span>
          }
        >
          {brief.committee?.length ? (
            <ul className="space-y-1.5 text-sm">
              {brief.committee.map((c: Json) => (
                <li key={c.email} className="flex items-center justify-between gap-2">
                  <span>
                    {c.name} <span className="text-xs text-muted-foreground">{c.title}</span>
                  </span>
                  {c.committee_role ? <Badge tone="info">{c.committee_role}</Badge> : <Badge>unassigned</Badge>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No contacts yet.</p>
          )}
        </Card>

        <Card title="Recent conversation">
          <ul className="space-y-2 text-sm">
            {(brief.recent ?? []).map((r: Json, i: number) => (
              <li key={i}>
                <div className="text-xs text-muted-foreground">
                  {label(r.source)} {label(r.type)} · {when(r.occurred_at)}
                </div>
                <div className="font-medium">{r.subject}</div>
                {r.summary && <div className="line-clamp-2 text-xs text-muted-foreground">{r.summary}</div>}
              </li>
            ))}
            {!brief.recent?.length && <li className="text-muted-foreground">Nothing captured yet.</li>}
          </ul>
        </Card>

        <CloseCard opp={opp} brief={brief} onChanged={onChanged} />
      </div>
    </div>
  );
}

function CloseCard({ opp, brief, onChanged }: { opp: Json; brief: Json; onChanged: () => void }) {
  const { has } = useSession();
  const act = useAction();
  const [po, setPo] = useState('');
  const [so, setSo] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const closed = ['closed_won', 'closed_lost'].includes(opp.stage_key);
  return (
    <Card title="Order handoff to NetSuite">
      <KeyValue
        items={[
          ['Sales order', opp.netsuite_sales_order_id ?? opp.order_reference ?? '—'],
          ['Status', opp.netsuite_status ? label(opp.netsuite_status) : '—'],
          ['Quote', brief.quote ? `${brief.quote.number} v${brief.quote.version} · ${label(brief.quote.status)}` : '—'],
        ]}
      />
      <p className="mt-2 text-xs text-muted-foreground">Orders, invoices and payments stay in NetSuite. ATLAS-I keeps only the reference.</p>
      {!closed && has('rep', 'sales_leader') && (
        <div className="mt-3 flex items-end gap-2">
          <Field label="Customer PO reference">
            <input className="h-8 rounded-md border border-border bg-background px-2 text-sm" value={po} onChange={(e) => setPo(e.target.value)} />
          </Field>
          <Button
            size="sm"
            busy={act.busy === 'req'}
            disabled={!po || !brief.quote}
            onClick={() =>
              act.run('req', async () => {
                const quotes = await api<Json[]>(`/v1/quotes?opportunityId=${opp.id}`);
                const q = quotes.find((x) => x.status === 'accepted') ?? quotes[0];
                const r = await api<Json>(`/v1/opportunities/${opp.id}/close-request`, { body: { customer_po_reference: po, quote_id: q.id } });
                setMsg(r.mode === 'manual' ? 'Finance has a task to enter the sales order in NetSuite.' : 'Sales order created in NetSuite.');
                onChanged();
              })
            }
          >
            Request close
          </Button>
        </div>
      )}
      {!closed && has('finance') && (
        <div className="mt-3 flex items-end gap-2">
          <Field label="NetSuite sales order ID">
            <input className="h-8 rounded-md border border-border bg-background px-2 text-sm" value={so} onChange={(e) => setSo(e.target.value)} />
          </Field>
          <Button
            size="sm"
            busy={act.busy === 'conf'}
            disabled={!so}
            onClick={() =>
              act.run('conf', async () => {
                await api(`/v1/opportunities/${opp.id}/close-confirm`, { body: { netsuite_sales_order_id: so } });
                setMsg('Closed won.');
                onChanged();
              })
            }
          >
            Confirm close
          </Button>
        </div>
      )}
      {msg && <p className="mt-2 text-xs text-good">{msg}</p>}
      <ErrorNote error={act.error} />
      {opp.expected_ship_date && <p className="mt-2 text-xs text-muted-foreground">Target ship date {date(opp.expected_ship_date)}</p>}
    </Card>
  );
}

function History({ history }: { history: Json[] }) {
  return (
    <ol className="relative space-y-3 border-l border-border pl-4">
      {history.slice(0, 60).map((h, i) => (
        <li key={i} className="text-sm">
          <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full border-2 border-background bg-primary" />
          <div className="text-xs text-muted-foreground">
            {when(h.created_at)} · {h.source === 'agent' ? `AI · ${label(h.actor_id)}` : label(h.source)}
            {h.confidence ? ` · confidence ${Number(h.confidence).toFixed(2)}` : ''}
          </div>
          <div>
            <b>{label(h.field)}</b> → <span className="break-all">{fmt(h.new_value)}</span>
          </div>
          {h.evidence?.[0]?.quote && <div className="text-xs text-muted-foreground italic">“{h.evidence[0].quote}”</div>}
        </li>
      ))}
    </ol>
  );
}

const fmt = (v: unknown) => {
  if (v == null) return '—';
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'object' && x && 'reason' in x ? (x as Json).reason : JSON.stringify(x))).join('; ');
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
};
