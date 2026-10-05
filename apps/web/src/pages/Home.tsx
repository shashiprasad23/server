import {
  Activity,
  AlertTriangle,
  BadgeCheck,
  Bot,
  Boxes,
  Gauge,
  Inbox,
  KanbanSquare,
  LineChart,
  Radio,
  ScrollText,
  Sparkles,
} from 'lucide-react';
import { api, compactMoney, ago } from '@/api';
import { useSession } from '@/lib/session';
import { BentoCard, BentoGrid } from '@/components/magicui/bento-grid';
import { NumberTicker } from '@/components/magicui/number-ticker';
import { BorderBeam } from '@/components/magicui/border-beam';
import { DotPattern } from '@/components/magicui/dot-pattern';
import { AnimatedList } from '@/components/magicui/animated-list';
import { Marquee } from '@/components/magicui/marquee';
import { ShimmerButton } from '@/components/magicui/shimmer-button';
import { CHANNEL_COLORS, CHANNEL_LABEL, HBarChart, RiskMeter, ShareBar } from '@/components/charts';
import { Badge, ErrorNote, PageHeader, Spinner, useAction, useData } from '@/components/ui';
import { cn } from '@/lib/utils';

interface Dashboard {
  kpis: Record<string, number>;
  byStage: { key: string; label: string; count: number; value: number }[];
  channels: { channel: string; count: number }[];
  feed: { kind: string; who: string; what: string; status: string; at: string }[];
  showMargin: boolean;
}

export function Home() {
  const { go, has, openDeal, version, touch } = useSession();
  const all = useData(
    () =>
      Promise.all([
        api<Dashboard>('/v1/insights/dashboard'),
        api<{ summary: string; bullets: string[] }>('/v1/insights/weekly-summary'),
        api<{ periods: { period: string; ai_forecast: number; low: number; high: number; rep_call: number | null }[] }>('/v1/insights/forecast?months=3'),
        api<{ total: number; items: { kind: string; title: string; value: number; action: string; record: { object: string; id: string } }[] }>('/v1/insights/leaks'),
        api<{ id: string; name: string; owner: string; stage: string; value: number; risk: number; probability: number; commentary: string }[]>('/v1/insights/inspection'),
        api<{ gpu_model: string; available_gpus: number; min_lead_time_weeks: number; shortfall: number }[]>('/v1/insights/supply-demand'),
      ]),
    [version],
    30000,
  );
  const demo = useAction();

  if (!all.data) return all.error ? <ErrorNote error={all.error} /> : <Spinner />;
  const [d, summary, fc, leaks, inspect, supply] = all.data;
  const k = d.kpis;
  const thisMonth = fc.periods[0];
  const empty = k.open_deals === 0;

  return (
    <>
      <PageHeader
        title="Good to see you"
        subtitle="Your AI-server pipeline across the Uvation Marketplace, the Service Portal and rep-sourced deals. Agents keep it current; you make the calls."
        actions={
          empty &&
          has('sales_leader') && (
            <ShimmerButton
              className="h-9 px-4 text-sm"
              onClick={() =>
                demo.run('demo', async () => {
                  await api('/v1/dev/demo-data', { body: {} });
                  touch();
                })
              }
            >
              {demo.busy ? 'Loading demo pipeline…' : 'Load demo pipeline'}
            </ShimmerButton>
          )
        }
      />
      <ErrorNote error={demo.error} />

      {supply.length > 0 && (
        <div className="relative mb-4 overflow-hidden rounded-xl border border-border bg-card">
          <Marquee pauseOnHover className="[--duration:40s] [--gap:2rem] py-2">
            {supply.map((s) => (
              <button key={s.gpu_model} className="flex items-center gap-2 text-xs whitespace-nowrap" onClick={() => go('supply')}>
                <Boxes className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="font-medium">{s.gpu_model}</span>
                <span className="text-muted-foreground">{s.available_gpus} GPUs free</span>
                <span className="text-muted-foreground">· lead {s.min_lead_time_weeks} wk</span>
                {s.shortfall > 0 ? <Badge tone="bad">{`short ${s.shortfall}`}</Badge> : <Badge tone="good">covered</Badge>}
              </button>
            ))}
          </Marquee>
          <div className="pointer-events-none absolute inset-y-0 left-0 w-12 bg-gradient-to-r from-card" />
          <div className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-card" />
        </div>
      )}

      <BentoGrid>
        <BentoCard
          name="Open pipeline"
          Icon={KanbanSquare}
          className="md:col-span-2"
          cta="Open the board"
          onClick={() => go('pipeline')}
          background={<DotPattern className="text-primary/30 [mask-image:radial-gradient(320px_circle_at_top_right,white,transparent)]" />}
        >
          <BorderBeam size={90} duration={9} colorFrom="#2a78d6" colorTo="#eb6834" />
          <div className="flex h-full flex-col justify-end">
            <div className="text-4xl font-semibold tracking-tight tabular-nums md:text-5xl">
              $<NumberTicker value={Math.round(k.open_pipeline / 1e5) / 10} decimalPlaces={1} />M
            </div>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
              <span>
                <b className="text-foreground tabular-nums">{compactMoney(k.weighted_pipeline)}</b> weighted
              </span>
              <span>
                <b className="text-foreground tabular-nums">{k.open_deals}</b> open deals
              </span>
              <span>
                <b className="text-foreground tabular-nums">{k.win_rate}%</b> win rate
              </span>
              <span>
                <b className="text-foreground tabular-nums">{k.at_risk_deals}</b> at risk
              </span>
              <span title="Expected value of closed-won deals; settlement lives in NetSuite">
                <b className="text-foreground tabular-nums">{compactMoney(k.won_value)}</b> won (CRM)
              </span>
            </div>
          </div>
        </BentoCard>

        <BentoCard name="This month: AI forecast vs rep call" Icon={LineChart} className="md:col-span-1 xl:col-span-2" cta="Forecast" onClick={() => go('forecast')}>
          {thisMonth ? (
            <div className="grid h-full grid-cols-2 content-end gap-4">
              <Stat label="AI forecast" value={compactMoney(thisMonth.ai_forecast)} sub={`range ${compactMoney(thisMonth.low)} to ${compactMoney(thisMonth.high)}`} dot="var(--series-1)" />
              <Stat
                label="Rep call"
                value={thisMonth.rep_call == null ? '—' : compactMoney(thisMonth.rep_call)}
                sub={thisMonth.rep_call == null ? 'not submitted' : `${thisMonth.rep_call > thisMonth.ai_forecast ? 'above' : 'at or below'} the AI view`}
                dot="var(--series-2)"
              />
              <div className="col-span-2 text-xs text-muted-foreground">Bookings and revenue come from NetSuite once connected; the CRM forecasts from expected value only.</div>
            </div>
          ) : (
            <Spinner />
          )}
        </BentoCard>

        <BentoCard name="Agent activity" Icon={Bot} className="row-span-2" cta="Audit trail" onClick={() => go('agents')} description="Live: what the agents did, and what waits on you.">
          <div className="relative h-[calc(100%-1rem)] overflow-hidden">
            <AnimatedList delay={700}>
              {[...d.feed].reverse().map((f, i) => (
                <div key={i} className="rounded-lg border border-border bg-background p-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{f.who.replace(/_/g, ' ')}</span>
                    <Badge>{f.status}</Badge>
                  </div>
                  <div className="mt-0.5 line-clamp-2 text-muted-foreground">{f.what}</div>
                  <div className="mt-0.5 text-[10px] text-muted-foreground">{ago(f.at)}</div>
                </div>
              ))}
            </AnimatedList>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-card" />
          </div>
        </BentoCard>

        <BentoCard name="Pipeline by stage" Icon={Gauge} className="md:col-span-2" cta="Pipeline" onClick={() => go('pipeline')}>
          <div className="h-full overflow-y-auto pr-1">
            <HBarChart
              data={d.byStage.filter((s) => s.count > 0).map((s) => ({ label: s.label, value: s.value, hint: `${s.count} deal${s.count === 1 ? '' : 's'}` }))}
              format={compactMoney}
            />
          </div>
        </BentoCard>

        <BentoCard name="Revenue at risk from process gaps" Icon={AlertTriangle} cta="Renewals and leaks" onClick={() => go('renewals')}>
          <div className="text-2xl font-semibold tabular-nums">{compactMoney(leaks.total)}</div>
          <ul className="mt-2 space-y-1.5 text-xs">
            {leaks.items.slice(0, 3).map((l, i) => (
              <li key={i} className="flex gap-1.5">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-warn" />
                <span className="line-clamp-2">
                  {l.title} <span className="text-muted-foreground">({compactMoney(l.value)})</span>
                </span>
              </li>
            ))}
          </ul>
        </BentoCard>

        <BentoCard name="Waiting on people" Icon={Inbox}>
          <div className="grid h-full grid-cols-2 content-center gap-2">
            <Tile label="Approvals" value={k.pending_approvals} onClick={() => go('approvals')} tone={k.pending_approvals ? 'warn' : undefined} />
            <Tile label="Compliance" value={k.compliance_queue} onClick={() => go('compliance')} tone={k.compliance_queue ? 'warn' : undefined} />
            <Tile label="Open tasks" value={k.open_tasks} onClick={() => go('tasks')} />
            <Tile label="Renewals due" value={k.renewals_due} onClick={() => go('renewals')} />
          </div>
        </BentoCard>

        <BentoCard name="Deals to inspect" Icon={Activity} className="md:col-span-2 xl:col-span-2" description="Ranked by risk × value. Reasons come from the deal coach." cta="Forecast inspection" onClick={() => go('forecast')}>
          <ul className="h-full space-y-1 overflow-y-auto pr-1">
            {inspect.slice(0, 4).map((x) => (
              <li key={x.id}>
                <button className="flex w-full items-center gap-3 rounded-md px-1.5 py-1 text-left hover:bg-muted" onClick={() => openDeal(x.id)}>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{x.name}</div>
                    <div className="truncate text-xs text-muted-foreground">{x.commentary}</div>
                  </div>
                  <div className="text-right text-xs">
                    <div className="tabular-nums">{compactMoney(x.value)}</div>
                    <RiskMeter value={x.risk} />
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </BentoCard>

        <BentoCard name="Weekly summary" Icon={ScrollText} className="md:col-span-2" description="Written from live data every time you open it.">
          <ul className="h-full space-y-1 overflow-y-auto pr-1 text-xs leading-relaxed">
            {summary.bullets.map((b, i) => (
              <li key={i} className="flex gap-1.5">
                <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
                {b}
              </li>
            ))}
          </ul>
        </BentoCard>

        <BentoCard name="Lead sources" Icon={Radio} cta="Simulate a channel event" onClick={() => go('simulator')}>
          <div className="flex h-full flex-col justify-between">
            <ShareBar data={d.channels.map((c) => ({ label: CHANNEL_LABEL[c.channel] ?? c.channel, value: c.count, color: CHANNEL_COLORS[c.channel] ?? 'var(--muted-foreground)' }))} />
            <div className="grid grid-cols-2 gap-2 text-xs">
              <Stat label="Speed to lead" value={`${k.speed_to_lead_minutes} min`} sub="median first reply" />
              <Stat label="Qualified by AI" value={`${k.leads_qualified_by_ai_pct}%`} sub={`${k.leads_30d} leads in 30 days`} />
            </div>
          </div>
        </BentoCard>

        <BentoCard name="Agent trust" Icon={BadgeCheck} cta="Agents" onClick={() => go('agents')}>
          <div className="grid h-full grid-cols-2 content-center gap-3">
            <Stat label="Actions (30d)" value={String(k.agent_actions_30d)} />
            <Stat label="Accepted" value={`${k.agent_acceptance_pct}%`} />
            <Stat label="Rolled back" value={String(k.agent_rollbacks_30d)} />
            <Stat label="Blocked by policy" value={String(k.agent_blocked_30d)} />
          </div>
        </BentoCard>

      </BentoGrid>
    </>
  );
}

function Stat({ label, value, sub, dot }: { label: string; value: string; sub?: string; dot?: string }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {dot && <span className="h-2 w-2 rounded-[2px]" style={{ background: dot }} />}
        {label}
      </div>
      <div className="text-xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function Tile({ label, value, onClick, tone }: { label: string; value: number; onClick: () => void; tone?: 'warn' }) {
  return (
    <button onClick={onClick} className={cn('rounded-lg border border-border bg-background p-2 text-left transition hover:border-primary', tone && 'border-warn/50')}>
      <div className="text-xl font-semibold tabular-nums">{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </button>
  );
}
