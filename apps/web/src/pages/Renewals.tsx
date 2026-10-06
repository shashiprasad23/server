import { CalendarClock, Play } from 'lucide-react';
import { api, compactMoney, date, label, type Json } from '@/api';
import { useSession } from '@/lib/session';
import { Badge, Button, Card, ErrorNote, PageHeader, Spinner, useAction, useData } from '@/components/ui';
import { cn } from '@/lib/utils';

const daysTo = (d?: string | null) => (d ? Math.ceil((new Date(d).getTime() - Date.now()) / 864e5) : null);

export function Renewals() {
  const { version, has, openDeal, touch } = useSession();
  const data = useData(() => Promise.all([api<Json[]>('/v1/installed-base'), api<Json>('/v1/insights/leaks')]), [version]);
  const act = useAction();
  if (!data.data) return data.error ? <ErrorNote error={data.error} /> : <Spinner />;
  const [assets, leaks] = data.data;

  return (
    <>
      <PageHeader
        title="Renewals & revenue leaks"
        subtitle="Installed base from won deals, with support and licence end dates. The renewal agent opens renewals 120 days out and flags ageing GPUs for refresh."
        actions={
          has('sales_leader') && (
            <Button
              busy={act.busy === 'run'}
              onClick={() =>
                act.run('run', async () => {
                  await api('/v1/agents/renewal_agent/run', { body: {} });
                  await data.reload();
                  touch();
                })
              }
            >
              <Play className="h-3.5 w-3.5" /> Run renewal agent now
            </Button>
          )
        }
      />
      <ErrorNote error={act.error} />
      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="overflow-x-auto xl:col-span-2" title="Installed base">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-1.5 font-medium">Account</th>
                <th className="font-medium">Asset</th>
                <th className="text-right font-medium">Qty</th>
                <th className="pl-3 font-medium">Delivered</th>
                <th className="font-medium">Ends</th>
                <th className="font-medium">Renewal</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {assets.map((a) => {
                const end = a.support_end ?? a.licence_end;
                const d = daysTo(end);
                return (
                  <tr key={a.id}>
                    <td className="py-1.5 pr-2">{a.account_name}</td>
                    <td className="pr-2">
                      {a.description}
                      <div className="text-xs text-muted-foreground">
                        {a.sku} · {label(a.category)}
                      </div>
                    </td>
                    <td className="text-right tabular-nums">{a.qty}</td>
                    <td className="pl-3 text-xs">{date(a.delivered_at)}</td>
                    <td className="text-xs">
                      {end ? (
                        <span className={cn('inline-flex items-center gap-1', d != null && d <= 120 && 'font-medium text-bad')}>
                          <CalendarClock className="h-3 w-3" />
                          {a.support_end ? 'support' : 'licences'} {date(end)} ({d} d)
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="text-xs">
                      {a.renewal_opportunity_id ? (
                        <button className="text-primary hover:underline" onClick={() => openDeal(a.renewal_opportunity_id)}>
                          {a.renewal_name ?? 'Open renewal'}
                        </button>
                      ) : (
                        <Badge tone={d != null && d <= 120 ? 'warn' : 'neutral'}>{d != null && d <= 120 ? 'not started' : 'not due'}</Badge>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!assets.length && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-muted-foreground">
                    Nothing delivered yet. Assets are created from the accepted quote when a deal closes won.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
        <Card title={`Revenue leaks · ${compactMoney(leaks.total)}`}>
          <ul className="space-y-3 text-sm">
            {leaks.items.map((l: Json, i: number) => (
              <li key={i} className="border-l-2 border-warn pl-3">
                <div className="flex justify-between gap-2">
                  <span className="font-medium">{l.title}</span>
                  <span className="shrink-0 tabular-nums">{compactMoney(l.value)}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {label(l.kind)} · {l.action}
                </div>
                {l.record?.object === 'opportunities' && (
                  <button className="text-xs text-primary hover:underline" onClick={() => openDeal(l.record.id)}>
                    Open deal →
                  </button>
                )}
              </li>
            ))}
            {!leaks.items.length && <li className="text-muted-foreground">No leaks found.</li>}
          </ul>
        </Card>
      </div>
    </>
  );
}
