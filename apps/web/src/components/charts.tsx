import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Single-series horizontal bars: categories read top to bottom, values in text ink at the bar end. */
export function HBarChart({
  data,
  format,
  color = 'var(--series-1)',
  onSelect,
  empty = 'No data yet',
}: {
  data: { label: string; value: number; hint?: ReactNode }[];
  format: (v: number) => string;
  color?: string;
  onSelect?: (label: string) => void;
  empty?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  if (!data.length) return <p className="py-6 text-center text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="space-y-1.5" role="list">
      {data.map((d, i) => (
        <div
          key={d.label}
          role="listitem"
          className={cn('group relative grid grid-cols-[minmax(84px,36%)_1fr] items-center gap-2 rounded px-1 py-0.5 text-xs', onSelect && 'cursor-pointer', hover === i && 'bg-muted')}
          onMouseEnter={() => setHover(i)}
          onMouseLeave={() => setHover(null)}
          onClick={() => onSelect?.(d.label)}
          title={`${d.label}: ${format(d.value)}`}
        >
          <span className="truncate text-muted-foreground">{d.label}</span>
          <div className="flex items-center gap-2">
            <div className="h-3 rounded-r-[4px]" style={{ width: `${Math.max(1.5, (d.value / max) * 82)}%`, background: color, opacity: hover == null || hover === i ? 1 : 0.55 }} />
            <span className="whitespace-nowrap tabular-nums">{format(d.value)}</span>
          </div>
          {hover === i && d.hint && (
            <div className="pointer-events-none absolute top-full left-1/3 z-20 mt-1 rounded-md border border-border bg-card px-2 py-1 text-xs shadow-lg">{d.hint}</div>
          )}
        </div>
      ))}
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string; kind?: 'bar' | 'range' | 'line' }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          {i.kind === 'range' ? (
            <span className="inline-block h-3 w-[2px]" style={{ background: i.color }} />
          ) : i.kind === 'line' ? (
            <span className="inline-block h-[2px] w-4" style={{ background: i.color }} />
          ) : (
            <span className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: i.color }} />
          )}
          {i.label}
        </span>
      ))}
    </div>
  );
}

export interface ForecastPeriod {
  period: string;
  ai_forecast: number;
  low: number;
  high: number;
  commit: number;
  best_case: number;
  won_crm: number;
  rep_call: number | null;
  variance_to_call?: number | null;
  deals: number;
}

const monthLabel = (p: string) => new Date(`${p}-01T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', year: '2-digit', timeZone: 'UTC' });

/** AI forecast (with its low-high range) against the rep call, one group per month. */
export function ForecastChart({ periods, format }: { periods: ForecastPeriod[]; format: (v: number) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640;
  const H = 220;
  const pad = { l: 56, r: 8, t: 10, b: 26 };
  const max = Math.max(1, ...periods.flatMap((p) => [p.high, p.ai_forecast, p.rep_call ?? 0])) * 1.08;
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const band = (W - pad.l - pad.r) / Math.max(1, periods.length);
  const bw = Math.min(26, band / 3.2);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const h = hover != null ? periods[hover] : null;
  return (
    <div className="relative">
      <Legend
        items={[
          { label: 'AI forecast', color: 'var(--series-1)' },
          { label: 'Rep call', color: 'var(--series-2)' },
          { label: 'AI range (low to high)', color: 'var(--foreground)', kind: 'range' },
        ]}
      />
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 w-full" role="img" aria-label="AI forecast against rep call by month">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} />
            <text x={pad.l - 6} y={y(t) + 3} textAnchor="end" className="fill-muted-foreground text-[10px]">
              {format(t)}
            </text>
          </g>
        ))}
        {periods.map((p, i) => {
          const cx = pad.l + band * i + band / 2;
          const x1 = cx - bw - 1;
          const x2 = cx + 1;
          const base = y(0);
          return (
            <g key={p.period} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={pad.l + band * i} y={pad.t} width={band} height={H - pad.t - pad.b} fill={hover === i ? 'var(--muted)' : 'transparent'} />
              <path d={roundTop(x1, y(p.ai_forecast), bw, base - y(p.ai_forecast))} fill="var(--series-1)" />
              {p.rep_call != null && <path d={roundTop(x2, y(p.rep_call), bw, base - y(p.rep_call))} fill="var(--series-2)" />}
              {p.high > p.low && (
                <g stroke="var(--foreground)" strokeWidth={1.5} opacity={0.7}>
                  <line x1={x1 + bw / 2} x2={x1 + bw / 2} y1={y(p.high)} y2={y(p.low)} />
                  <line x1={x1 + bw / 2 - 4} x2={x1 + bw / 2 + 4} y1={y(p.high)} y2={y(p.high)} />
                  <line x1={x1 + bw / 2 - 4} x2={x1 + bw / 2 + 4} y1={y(p.low)} y2={y(p.low)} />
                </g>
              )}
              <text x={cx} y={H - 8} textAnchor="middle" className="fill-muted-foreground text-[10px]">
                {monthLabel(p.period)}
              </text>
            </g>
          );
        })}
      </svg>
      {h && (
        <div className="pointer-events-none absolute top-8 right-2 z-10 min-w-48 rounded-lg border border-border bg-card p-2.5 text-xs shadow-lg">
          <div className="mb-1 font-medium">{monthLabel(h.period)}</div>
          <Row k="AI forecast" v={format(h.ai_forecast)} c="var(--series-1)" />
          <Row k="Range" v={`${format(h.low)} to ${format(h.high)}`} />
          <Row k="Rep call" v={h.rep_call == null ? 'not submitted' : format(h.rep_call)} c="var(--series-2)" />
          <Row k="Commit" v={format(h.commit)} />
          <Row k="Best case" v={format(h.best_case)} />
          <Row k="Won (CRM)" v={format(h.won_crm)} />
          <Row k="Open deals" v={String(h.deals)} />
        </div>
      )}
    </div>
  );
}

function Row({ k, v, c }: { k: string; v: string; c?: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        {c && <span className="h-2 w-2 rounded-[2px]" style={{ background: c }} />}
        {k}
      </span>
      <span className="tabular-nums">{v}</span>
    </div>
  );
}

/** Bar path with 4px rounded data-end and a square baseline. */
function roundTop(x: number, y: number, w: number, h: number) {
  if (h <= 0) return '';
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}

/** Risk 0-100 as a short meter with a status label (never colour alone). */
export function RiskMeter({ value }: { value: number | null | undefined }) {
  if (value == null) return <span className="text-xs text-muted-foreground">not scored</span>;
  const tone = value >= 50 ? 'bad' : value >= 25 ? 'warn' : 'good';
  const word = value >= 50 ? 'High' : value >= 25 ? 'Watch' : 'Low';
  return (
    <span className="inline-flex items-center gap-1.5 text-xs whitespace-nowrap" title={`Risk ${value} of 100`}>
      <span className="relative h-1.5 w-14 overflow-hidden rounded-full bg-muted">
        <span className={cn('absolute inset-y-0 left-0 rounded-full', tone === 'bad' ? 'bg-bad' : tone === 'warn' ? 'bg-warn' : 'bg-good')} style={{ width: `${Math.max(4, value)}%` }} />
      </span>
      <span className="tabular-nums">
        {word} {value}
      </span>
    </span>
  );
}

/** Stacked share bar with 2px gaps; for channel mix. */
/** Colour is fixed per entity by the caller (CHANNEL_COLORS), never by rank. */
export function ShareBar({ data }: { data: { label: string; value: number; color: string }[] }) {
  const total = data.reduce((a, d) => a + d.value, 0) || 1;
  return (
    <div>
      <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded-[4px]">
        {data.map((d) => (
          <div key={d.label} title={`${d.label}: ${d.value}`} style={{ width: `${(d.value / total) * 100}%`, background: d.color }} />
        ))}
      </div>
      <Legend items={data.map((d) => ({ label: `${d.label} ${Math.round((d.value / total) * 100)}%`, color: d.color }))} />
    </div>
  );
}

export const CHANNEL_COLORS: Record<string, string> = { marketplace: 'var(--series-1)', usp: 'var(--series-2)', rep: 'var(--series-3)' };
export const CHANNEL_LABEL: Record<string, string> = { marketplace: 'Marketplace', usp: 'Service Portal (USP)', rep: 'Rep-sourced' };
