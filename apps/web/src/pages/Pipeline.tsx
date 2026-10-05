import { useMemo, useState } from 'react';
import { Cpu, Search, ShieldAlert, Snowflake, Wind } from 'lucide-react';
import { api, compactMoney, date, label, type Json } from '@/api';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';
import { MagicCard } from '@/components/magicui/magic-card';
import { CHANNEL_COLORS, CHANNEL_LABEL, RiskMeter } from '@/components/charts';
import { Badge, ErrorNote, PageHeader, Spinner, useData } from '@/components/ui';
import { cn } from '@/lib/utils';

export interface Stage {
  key: string;
  label: string;
  is_closed: boolean;
  is_won: boolean;
  entry_rules: string[];
}

export function Pipeline() {
  const { openDeal, version, me } = useSession();
  const { resolved } = useTheme();
  const [q, setQ] = useState('');
  const [channel, setChannel] = useState('all');
  const [mine, setMine] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  const { data, error } = useData(
    () => Promise.all([api<Stage[]>('/v1/metadata/stages'), api<{ items: Json[] }>(`/v1/records/opportunities?limit=200${q ? `&q=${encodeURIComponent(q)}` : ''}`)]),
    [q, version],
    15000,
  );

  const [stages, opps] = data ?? [[], { items: [] }];
  const visible = useMemo(
    () => opps.items.filter((o) => (channel === 'all' || o.channel === channel) && (!mine || o.owner_id === me.actorId)),
    [opps, channel, mine, me.actorId],
  );
  const open = visible.filter((o) => !stages.find((s) => s.key === o.stage_key)?.is_closed);
  const total = open.reduce((a, o) => a + Number(o.expected_value ?? 0), 0);
  const columns = stages.filter((s) => showClosed || !s.is_closed);

  return (
    <>
      <PageHeader
        title="Pipeline"
        subtitle={
          <>
            {open.length} open deals · {compactMoney(total)} open value. Stage gates are enforced; agents fill requirements from email, Teams and the portals.
          </>
        }
        actions={
          <>
            <div className="relative">
              <Search className="absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input className="h-8 w-48 rounded-md border border-border bg-card pr-2 pl-7 text-sm" placeholder="Search deals" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <select className="h-8 rounded-md border border-border bg-card px-2 text-sm" value={channel} onChange={(e) => setChannel(e.target.value)} aria-label="Channel">
              <option value="all">All channels</option>
              {Object.entries(CHANNEL_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Mine
            </label>
            <label className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> Closed
            </label>
          </>
        }
      />
      <ErrorNote error={error} />
      {!data && <Spinner />}
      <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-4 md:-mx-6 md:px-6">
        {columns.map((s) => {
          const items = visible.filter((o) => o.stage_key === s.key);
          const sum = items.reduce((a, o) => a + Number(o.expected_value ?? 0), 0);
          return (
            <section key={s.key} className="flex w-72 shrink-0 flex-col rounded-xl bg-muted/60 p-2">
              <header className="mb-2 flex items-baseline justify-between px-1.5">
                <h3 className="text-sm font-medium">{s.label}</h3>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {items.length} · {compactMoney(sum)}
                </span>
              </header>
              {s.entry_rules.length > 0 && <p className="mb-2 px-1.5 text-[11px] text-muted-foreground">Needs: {s.entry_rules.map(label).join(', ')}</p>}
              <div className="flex flex-col gap-2">
                {items.map((o) => (
                  <MagicCard
                    key={o.id}
                    className="cursor-pointer rounded-lg"
                    gradientColor={resolved === 'dark' ? '#262a33' : '#e7eefb'}
                    gradientFrom="#2a78d6"
                    gradientTo="#eb6834"
                    gradientSize={160}
                  >
                    <button className="relative z-30 block w-full p-3 text-left" onClick={() => openDeal(o.id)}>
                      <div className="flex items-start justify-between gap-2">
                        <strong className="text-sm leading-snug">{o.name}</strong>
                        <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full" title={CHANNEL_LABEL[o.channel] ?? o.channel} style={{ background: CHANNEL_COLORS[o.channel] ?? 'var(--muted-foreground)' }} />
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <Cpu className="h-3 w-3" />
                          {[o.gpu_count && `${o.gpu_count} ×`, o.gpu_model].filter(Boolean).join(' ') || 'requirements pending'}
                        </span>
                        {o.cooling && (
                          <span className="inline-flex items-center gap-1">
                            {o.cooling === 'liquid' ? <Snowflake className="h-3 w-3" /> : <Wind className="h-3 w-3" />}
                            {o.cooling}
                          </span>
                        )}
                        {o.expected_ship_date && <span>ships {date(o.expected_ship_date)}</span>}
                      </div>
                      <div className="mt-2 flex items-center justify-between">
                        <span className="text-sm font-medium tabular-nums">{compactMoney(o.expected_value)}</span>
                        {!s.is_closed && <RiskMeter value={o.risk_score} />}
                      </div>
                      {['flagged', 'blocked', 'screening'].includes(o.compliance_status) && (
                        <div className={cn('mt-2 flex items-center gap-1 text-xs', o.compliance_status === 'screening' ? 'text-muted-foreground' : 'text-bad')}>
                          <ShieldAlert className="h-3 w-3" />
                          Compliance: <Badge>{o.compliance_status}</Badge>
                        </div>
                      )}
                    </button>
                  </MagicCard>
                ))}
                {!items.length && <div className="rounded-lg border border-dashed border-border p-3 text-center text-xs text-muted-foreground">No deals</div>}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
