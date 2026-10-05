import { useState } from 'react';
import { Upload } from 'lucide-react';
import { api, date, label, money, type Json } from '@/api';
import { useSession } from '@/lib/session';
import { Badge, Button, Card, ErrorNote, PageHeader, Spinner, Tabs, useAction, useData } from '@/components/ui';
import { cn } from '@/lib/utils';

type Tab = 'demand' | 'catalog' | 'holds';

export function Supply() {
  const { version } = useSession();
  const [tab, setTab] = useState<Tab>('demand');
  return (
    <>
      <PageHeader title="Supply" subtitle="GPU demand from the weighted pipeline against stock and lead times, the price book, and stock held for live deals." />
      <Tabs<Tab>
        tabs={[
          ['demand', 'Supply vs demand'],
          ['catalog', 'Catalogue & price book'],
          ['holds', 'Holds'],
        ]}
        value={tab}
        onChange={setTab}
      />
      <div className="mt-4">
        {tab === 'demand' && <Demand key={version} />}
        {tab === 'catalog' && <Catalog key={version} />}
        {tab === 'holds' && <Holds key={version} />}
      </div>
    </>
  );
}

function Demand() {
  const { openDeal } = useSession();
  const d = useData(() => api<Json[]>('/v1/insights/supply-demand'), []);
  if (!d.data) return d.error ? <ErrorNote error={d.error} /> : <Spinner />;
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {d.data.map((g) => {
        const demand = g.quarters.reduce((a: number, q: Json) => a + q.weighted_gpus, 0);
        const max = Math.max(1, g.available_gpus, ...g.quarters.map((q: Json) => q.total_gpus));
        return (
          <Card key={g.gpu_model} title={g.gpu_model} action={g.shortfall > 0 ? <Badge tone="bad">{`short ${g.shortfall} GPUs`}</Badge> : <Badge tone="good">covered</Badge>}>
            <div className="mb-3 flex gap-4 text-sm">
              <div>
                <div className="text-xs text-muted-foreground">Free stock</div>
                <div className="font-semibold tabular-nums">{g.available_gpus} GPUs</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Weighted demand</div>
                <div className="font-semibold tabular-nums">{demand} GPUs</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Best lead time</div>
                <div className="font-semibold tabular-nums">{g.min_lead_time_weeks} wk</div>
              </div>
            </div>
            <div className="space-y-1.5">
              {g.quarters.map((q: Json) => (
                <div key={q.quarter} className="grid grid-cols-[64px_1fr_auto] items-center gap-2 text-xs" title={`${q.deals} deals, ${q.total_gpus} GPUs in total, ${q.weighted_gpus} weighted`}>
                  <span className="text-muted-foreground">{q.quarter}</span>
                  <div className="relative h-3">
                    <div className="absolute inset-y-0 left-0 rounded-r-[4px] bg-series-1/30" style={{ width: `${(q.total_gpus / max) * 100}%` }} />
                    <div className="absolute inset-y-0 left-0 rounded-r-[4px] bg-series-1" style={{ width: `${(q.weighted_gpus / max) * 100}%` }} />
                  </div>
                  <span className="tabular-nums">
                    {q.weighted_gpus} / {q.total_gpus}
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">Dark bar: weighted GPUs. Light bar: total GPUs in open deals.</p>
            {g.cannot_ship_in_time?.length > 0 && (
              <div className="mt-2 text-xs text-bad">
                Cannot ship in time:{' '}
                {g.cannot_ship_in_time.map((c: Json) => (
                  <button key={c.id} className="mr-2 underline" onClick={() => openDeal(c.id)}>
                    {c.name}
                  </button>
                ))}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

function Catalog() {
  const { has } = useSession();
  const d = useData(() => api<Json[]>('/v1/catalog'), []);
  const act = useAction();
  const [csv, setCsv] = useState('');
  const [result, setResult] = useState<string | null>(null);
  if (!d.data) return d.error ? <ErrorNote error={d.error} /> : <Spinner />;
  const showCost = d.data.some((p) => p.cost != null);
  return (
    <div className="space-y-4">
      {has('procurement', 'deal_desk') && (
        <Card title="Import a price list">
          <p className="mb-2 text-xs text-muted-foreground">CSV with a header row: sku, list_price, cost, stock, lead_time_weeks (any subset). Unknown SKUs need name and category.</p>
          <textarea className="h-24 w-full rounded-md border border-border bg-background p-2 font-mono text-xs" value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={'sku,list_price,stock\nSMC-HGX-H200-8G,295000,12'} />
          <ErrorNote error={act.error} />
          <Button
            size="sm"
            className="mt-2"
            disabled={!csv.trim()}
            busy={act.busy === 'imp'}
            onClick={() =>
              act.run('imp', async () => {
                const [head, ...rows] = csv.trim().split(/\r?\n/);
                const cols = head.split(',').map((c) => c.trim());
                const items = rows.map((r) => Object.fromEntries(r.split(',').map((v, i) => [cols[i], ['sku', 'name', 'category'].includes(cols[i]) ? v.trim() : Number(v)])));
                const r = await api<Json>('/v1/catalog/import', { body: items });
                setResult(`Updated ${r.updated ?? 0}, created ${r.created ?? 0}.`);
                await d.reload();
              })
            }
          >
            <Upload className="h-3.5 w-3.5" /> Import
          </Button>
          {result && <p className="mt-1 text-xs text-good">{result}</p>}
        </Card>
      )}
      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">SKU</th>
              <th className="font-medium">Product</th>
              <th className="font-medium">Category</th>
              <th className="text-right font-medium">List</th>
              {showCost && <th className="text-right font-medium">Cost</th>}
              <th className="text-right font-medium">Free</th>
              <th className="text-right font-medium">Held</th>
              <th className="px-3 text-right font-medium">Lead</th>
              <th className="pr-3 font-medium">Export</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {d.data.map((p) => (
              <tr key={p.id}>
                <td className="px-3 py-1.5 font-mono text-xs">{p.sku}</td>
                <td>
                  {p.name}
                  {p.power_kw > 0 && <span className="ml-1 text-xs text-muted-foreground">{p.power_kw} kW · {p.cooling}</span>}
                </td>
                <td className="text-xs">{label(p.category)}</td>
                <td className="text-right tabular-nums">{money(p.list_price)}</td>
                {showCost && <td className="text-right tabular-nums">{money(p.cost)}</td>}
                <td className={cn('text-right tabular-nums', p.available === 0 && 'text-bad')}>{p.available}</td>
                <td className="text-right tabular-nums">{p.held}</td>
                <td className="px-3 text-right tabular-nums">{p.lead_time_weeks} wk</td>
                <td className="pr-3 text-xs">{p.export_class ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <p className="text-xs text-muted-foreground">Catalogue prices are illustrative seed data. Procurement maintains the real price book by import.</p>
    </div>
  );
}

function Holds() {
  const { openDeal } = useSession();
  const d = useData(() => api<Json[]>('/v1/supply/holds'), []);
  const act = useAction();
  if (!d.data) return d.error ? <ErrorNote error={d.error} /> : <Spinner />;
  return (
    <Card className="overflow-x-auto p-0">
      <ErrorNote error={act.error} />
      <table className="w-full text-sm">
        <thead className="bg-muted text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">Deal</th>
            <th className="font-medium">Product</th>
            <th className="text-right font-medium">Qty</th>
            <th className="font-medium">Status</th>
            <th className="font-medium">Expires</th>
            <th />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {d.data.map((h) => (
            <tr key={h.id}>
              <td className="px-3 py-1.5">
                <button className="text-primary hover:underline" onClick={() => openDeal(h.opportunity_id)}>
                  {h.opportunity_name}
                </button>
              </td>
              <td>{h.name}</td>
              <td className="text-right tabular-nums">{h.qty}</td>
              <td>
                <Badge>{h.status}</Badge>
              </td>
              <td className="text-xs">{date(h.expires_at)}</td>
              <td className="pr-3 text-right">
                {h.status === 'active' && (
                  <Button
                    size="sm"
                    variant="ghost"
                    busy={act.busy === h.id}
                    onClick={() =>
                      act.run(h.id, async () => {
                        await api(`/v1/supply/holds/${h.id}`, { method: 'DELETE' });
                        await d.reload();
                      })
                    }
                  >
                    Release
                  </Button>
                )}
              </td>
            </tr>
          ))}
          {!d.data.length && (
            <tr>
              <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                No holds. Hold stock from a deal's Configure & quote tab.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </Card>
  );
}
