import { useState } from 'react';
import { api, compactMoney, label, money, type Json } from '@/api';
import { useSession } from '@/lib/session';
import { CHANNEL_LABEL, ForecastChart, HBarChart, RiskMeter, type ForecastPeriod } from '@/components/charts';
import { Button, Card, ErrorNote, Field, PageHeader, Spinner, useAction, useData } from '@/components/ui';

interface ForecastData {
  periods: ForecastPeriod[];
  byRep: { key: string; weighted: number }[];
  byGpu: { key: string; weighted: number }[];
  byChannel: { key: string; weighted: number }[];
  estimatedDeals: number;
  note: string;
}

export function Forecast() {
  const { version, has, openDeal, touch } = useSession();
  const [months, setMonths] = useState(6);
  const data = useData(
    () => Promise.all([api<ForecastData>(`/v1/insights/forecast?months=${months}`), api<Json[]>('/v1/insights/inspection'), api<Json>('/v1/insights/weekly-summary')]),
    [months, version],
  );
  const act = useAction();
  const [call, setCall] = useState({ period: new Date().toISOString().slice(0, 7), amount: '', note: '' });

  if (!data.data) return data.error ? <ErrorNote error={data.error} /> : <Spinner />;
  const [f, inspection, summary] = data.data;
  const total = f.periods.reduce((a, p) => a + p.ai_forecast, 0);

  return (
    <>
      <PageHeader
        title="Forecast"
        subtitle="An AI forecast from stage, risk and timing on every open deal, side by side with the rep call. Hover a month for the detail."
        actions={
          <select className="h-8 rounded-md border border-border bg-card px-2 text-sm" value={months} onChange={(e) => setMonths(Number(e.target.value))} aria-label="Horizon">
            {[3, 6, 12].map((m) => (
              <option key={m} value={m}>
                Next {m} months
              </option>
            ))}
          </select>
        }
      />
      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2" title={`AI forecast vs rep call · ${compactMoney(total)} over ${months} months`}>
          <ForecastChart periods={f.periods} format={compactMoney} />
          <details className="mt-3 text-xs">
            <summary className="cursor-pointer text-muted-foreground">Table view</summary>
            <table className="mt-2 w-full">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-1 font-medium">Month</th>
                  <th className="text-right font-medium">AI</th>
                  <th className="text-right font-medium">Low</th>
                  <th className="text-right font-medium">High</th>
                  <th className="text-right font-medium">Commit</th>
                  <th className="text-right font-medium">Rep call</th>
                  <th className="text-right font-medium">Deals</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border tabular-nums">
                {f.periods.map((p) => (
                  <tr key={p.period}>
                    <td className="py-1">{p.period}</td>
                    <td className="text-right">{money(p.ai_forecast)}</td>
                    <td className="text-right">{money(p.low)}</td>
                    <td className="text-right">{money(p.high)}</td>
                    <td className="text-right">{money(p.commit)}</td>
                    <td className="text-right">{p.rep_call == null ? '—' : money(p.rep_call)}</td>
                    <td className="text-right">{p.deals}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
          <p className="mt-2 text-xs text-muted-foreground">
            {f.note} {f.estimatedDeals > 0 && `${f.estimatedDeals} deals have no expected value yet and are estimated from GPU count.`}
          </p>
        </Card>

        <div className="space-y-4">
          {has('rep', 'sales_leader') && (
            <Card title="Submit your call">
              <div className="grid grid-cols-2 gap-2">
                <Field label="Month">
                  <input type="month" className="h-8 rounded-md border border-border bg-background px-2 text-sm" value={call.period} onChange={(e) => setCall({ ...call, period: e.target.value })} />
                </Field>
                <Field label="Amount (USD)">
                  <input type="number" className="h-8 rounded-md border border-border bg-background px-2 text-sm" value={call.amount} onChange={(e) => setCall({ ...call, amount: e.target.value })} />
                </Field>
              </div>
              <Field label="Note">
                <input className="mt-1 h-8 rounded-md border border-border bg-background px-2 text-sm" value={call.note} onChange={(e) => setCall({ ...call, note: e.target.value })} />
              </Field>
              <ErrorNote error={act.error} />
              <Button
                size="sm"
                className="mt-2"
                disabled={!call.amount}
                busy={act.busy === 'call'}
                onClick={() =>
                  act.run('call', async () => {
                    await api('/v1/insights/forecast/calls', { body: { period: call.period, amount: Number(call.amount), note: call.note || undefined } });
                    await data.reload();
                    touch();
                  })
                }
              >
                Save call
              </Button>
            </Card>
          )}
          <Card title="Weekly summary">
            <ul className="space-y-1.5 text-xs leading-relaxed">
              {(summary.bullets as string[]).map((b) => (
                <li key={b}>• {b}</li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <Card title="Weighted by rep">
          <HBarChart data={f.byRep.map((r) => ({ label: r.key, value: r.weighted }))} format={compactMoney} />
        </Card>
        <Card title="Weighted by GPU">
          <HBarChart data={f.byGpu.map((r) => ({ label: r.key, value: r.weighted }))} format={compactMoney} />
        </Card>
        <Card title="Weighted by channel">
          <HBarChart data={f.byChannel.map((r) => ({ label: CHANNEL_LABEL[r.key] ?? label(r.key), value: r.weighted }))} format={compactMoney} />
        </Card>
      </div>

      <Card className="mt-4 overflow-x-auto" title="Deal inspection">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="py-1.5 font-medium">Deal</th>
              <th className="font-medium">Owner</th>
              <th className="font-medium">Stage</th>
              <th className="font-medium">Ships</th>
              <th className="text-right font-medium">Value</th>
              <th className="pl-3 font-medium">Risk</th>
              <th className="text-right font-medium">Win %</th>
              <th className="pl-3 font-medium">Commentary</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {inspection.map((x) => (
              <tr key={x.id} className="cursor-pointer hover:bg-muted" onClick={() => openDeal(x.id)}>
                <td className="py-1.5 pr-2 text-primary">{x.name}</td>
                <td className="pr-2 text-xs whitespace-nowrap">{x.owner}</td>
                <td className="pr-2 text-xs whitespace-nowrap">{label(x.stage)}</td>
                <td className="pr-2 text-xs whitespace-nowrap">{x.ship_month ?? '—'}</td>
                <td className="text-right tabular-nums">
                  {compactMoney(x.value)}
                  {x.estimated && <span className="text-muted-foreground">*</span>}
                </td>
                <td className="pl-3">
                  <RiskMeter value={x.risk} />
                </td>
                <td className="text-right tabular-nums">{x.probability}%</td>
                <td className="max-w-md pl-3 text-xs text-muted-foreground">{x.commentary}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-muted-foreground">* value estimated from GPU count.</p>
      </Card>
    </>
  );
}
