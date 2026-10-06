import { useState } from 'react';
import { Activity, Bot, Briefcase, HeartPulse, Search, Server } from 'lucide-react';
import { api, compactMoney, date, label, when, type Json } from '@/api';
import { useSession } from '@/lib/session';
import { CHANNEL_LABEL } from '@/components/charts';
import { Badge, Card, Empty, ErrorNote, PageHeader, Spinner, useData } from '@/components/ui';
import { cn } from '@/lib/utils';

export function Accounts() {
  const { version } = useSession();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const list = useData(() => api<{ items: Json[] }>(`/v1/records/accounts?limit=200${q ? `&q=${encodeURIComponent(q)}` : ''}`), [q, version]);

  return (
    <>
      <PageHeader
        title="Accounts"
        subtitle="One timeline per customer across the Marketplace, the Service Portal, Outlook, Teams and agent actions."
        actions={
          <div className="relative">
            <Search className="absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input className="h-8 w-56 rounded-md border border-border bg-card pr-2 pl-7 text-sm" placeholder="Search name or domain" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        }
      />
      <ErrorNote error={list.error} />
      <div className="grid gap-4 lg:grid-cols-[minmax(280px,360px)_1fr]">
        <Card className="p-2">
          {!list.data && <Spinner />}
          <ul>
            {list.data?.items.map((a) => (
              <li key={a.id}>
                <button
                  className={cn('flex w-full items-center justify-between gap-2 rounded-md px-2 py-2 text-left hover:bg-muted', open === a.id && 'bg-accent')}
                  onClick={() => setOpen(a.id)}
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{a.name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {a.domain} · {CHANNEL_LABEL[a.channel_first_seen] ?? 'rep'}
                    </div>
                  </div>
                  {a.health_score != null && <Health score={a.health_score} />}
                </button>
              </li>
            ))}
          </ul>
        </Card>
        {open ? <AccountView key={open} id={open} /> : <Empty>Select an account to see its timeline, buying committee, installed base and health.</Empty>}
      </div>
    </>
  );
}

function Health({ score }: { score: number }) {
  const tone = score >= 70 ? 'good' : score >= 40 ? 'warn' : 'bad';
  return <Badge tone={tone}>{`health ${score}`}</Badge>;
}

function AccountView({ id }: { id: string }) {
  const { openDeal } = useSession();
  const data = useData(
    () =>
      Promise.all([
        api<Json>(`/v1/timeline/accounts/${id}`),
        api<Json[]>(`/v1/accounts/${id}/committee`),
        api<Json[]>(`/v1/installed-base?accountId=${id}`),
        api<{ items: Json[] }>(`/v1/records/opportunities?account_id=${id}&limit=50`),
      ]),
    [id],
  );
  if (!data.data) return data.error ? <ErrorNote error={data.error} /> : <Spinner />;
  const [tl, committee, assets, opps] = data.data;
  const a = tl.account;
  const deals = opps.items.filter((o) => o.account_id === id);

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">{a.name}</h2>
            <div className="text-sm text-muted-foreground">
              {[a.domain, label(a.segment), a.hq_country].filter(Boolean).join(' · ')}
              {a.netsuite_customer_id && ` · NetSuite ${a.netsuite_customer_id}`}
            </div>
          </div>
          {a.health_score != null && <Health score={a.health_score} />}
        </div>
        {a.health_reasons?.length > 0 && (
          <div className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
            <HeartPulse className="mt-0.5 h-3.5 w-3.5" />
            {a.health_reasons.map((r: Json) => r.reason ?? r).join(' · ')}
          </div>
        )}
      </Card>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Opportunities">
          <ul className="space-y-1.5 text-sm">
            {deals.map((o) => (
              <li key={o.id}>
                <button className="w-full text-left hover:text-primary" onClick={() => openDeal(o.id)}>
                  <div className="truncate">{o.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {label(o.stage_key)} · {compactMoney(o.expected_value)}
                  </div>
                </button>
              </li>
            ))}
            {!deals.length && <li className="text-muted-foreground">None</li>}
          </ul>
        </Card>
        <Card title="Buying committee">
          <ul className="space-y-1.5 text-sm">
            {committee.map((c) => (
              <li key={c.id} className="flex justify-between gap-2">
                <span className="truncate">
                  {c.name} <span className="text-xs text-muted-foreground">{c.title}</span>
                </span>
                <Badge tone={c.committee_role ? 'info' : 'neutral'}>{c.committee_role ?? 'unassigned'}</Badge>
              </li>
            ))}
          </ul>
          {!committee.some((c) => c.committee_role === 'economic_buyer') && <p className="mt-2 text-xs text-warn">No economic buyer identified.</p>}
        </Card>
        <Card title="Installed base">
          <ul className="space-y-1.5 text-sm">
            {assets.map((x) => (
              <li key={x.id}>
                <div className="flex items-center gap-1.5">
                  <Server className="h-3.5 w-3.5 text-muted-foreground" /> {x.qty} × {x.description}
                </div>
                <div className="pl-5 text-xs text-muted-foreground">
                  delivered {date(x.delivered_at)}
                  {x.support_end && ` · support to ${date(x.support_end)}`}
                  {x.licence_end && ` · licences to ${date(x.licence_end)}`}
                </div>
              </li>
            ))}
            {!assets.length && <li className="text-muted-foreground">Nothing delivered yet</li>}
          </ul>
        </Card>
      </div>

      <Card title="Timeline">
        <ol className="relative space-y-3 border-l border-border pl-5">
          {tl.items.map((i: Json) => {
            const Icon = i.kind === 'agent_action' ? Bot : i.kind === 'opportunity' ? Briefcase : Activity;
            return (
              <li key={`${i.kind}-${i.id}`} className="text-sm">
                <span className="absolute -left-[9px] flex h-[18px] w-[18px] items-center justify-center rounded-full border border-border bg-card">
                  <Icon className="h-2.5 w-2.5 text-muted-foreground" />
                </span>
                <div className="text-xs text-muted-foreground">
                  {when(i.at)} ·{' '}
                  {i.kind === 'activity'
                    ? `${label(i.source)} ${label(i.subtype)}${i.direction ? ` (${i.direction})` : ''}`
                    : i.kind === 'agent_action'
                      ? `${label(i.source)} · ${label(i.direction)}`
                      : `opportunity · ${label(i.direction)}`}
                </div>
                <div>{i.title ?? label(i.subtype)}</div>
                {i.kind === 'activity' && i.meta?.summary && <div className="text-xs">AI summary: {i.meta.summary}</div>}
                {i.kind === 'activity' && i.detail && <div className="line-clamp-2 text-xs text-muted-foreground">{i.detail}</div>}
              </li>
            );
          })}
        </ol>
      </Card>
    </div>
  );
}
