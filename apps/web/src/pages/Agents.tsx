import { useState } from 'react';
import { Bot, Play, Power, RotateCcw } from 'lucide-react';
import { api, label, when, type Json } from '@/api';
import { useSession } from '@/lib/session';
import { BorderBeam } from '@/components/magicui/border-beam';
import { Badge, Button, Card, ErrorNote, PageHeader, Spinner, useAction, useData } from '@/components/ui';
import { cn } from '@/lib/utils';

export function Agents() {
  const { has, version, touch, openDeal } = useSession();
  const data = useData(() => Promise.all([api<Json[]>('/v1/agents'), api<Json[]>('/v1/agents/actions')]), [version], 10000);
  const act = useAction();
  const [msg, setMsg] = useState<string | null>(null);
  const [agentFilter, setAgentFilter] = useState('all');
  const canControl = has('sales_leader');

  const run = (key: string, path: string) =>
    act.run(key, async () => {
      setMsg(null);
      const r = await api<Json>(path, { body: {} });
      if (r?.reverted) setMsg(`Reverted: ${r.reverted.join(', ') || 'nothing'}${r.skipped?.length ? ` · Left alone: ${r.skipped.join('; ')}` : ''}`);
      else if (r?.rescored != null) setMsg(`Deal coach rescored ${r.rescored} deals.`);
      await data.reload();
      touch();
    });

  if (!data.data) return data.error ? <ErrorNote error={data.error} /> : <Spinner />;
  const [agents, actions] = data.data;
  const shown = actions.filter((a) => agentFilter === 'all' || a.agent_id === agentFilter);

  return (
    <>
      <PageHeader
        title="Agents"
        subtitle="Each agent has a scope, a confidence threshold, a daily cap and a kill switch. Every action is classified by reversibility, logged with its evidence, and can be rolled back."
        actions={
          canControl && (
            <Button variant="secondary" busy={act.busy === 'coach'} onClick={() => run('coach', '/v1/agents/deal_coach/run')}>
              <Play className="h-3.5 w-3.5" /> Rescore all deals
            </Button>
          )
        }
      />
      <ErrorNote error={act.error} />
      {msg && <div className="mb-3 rounded-md bg-accent p-2 text-sm text-primary">{msg}</div>}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {agents.map((a) => (
          <Card key={a.id} className={cn('relative overflow-hidden', a.killed && 'opacity-75')}>
            {!a.killed && <BorderBeam size={60} duration={10} colorFrom="#2a78d6" colorTo="#1baf7a" />}
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 font-medium">
                <Bot className="h-4 w-4 text-primary" /> {a.name}
              </span>
              <Badge>{a.killed ? 'stopped' : 'running'}</Badge>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{a.description}</p>
            <div className="mt-3 flex flex-wrap gap-1">
              {a.allowedActions?.map((x: string) => (
                <Badge key={x} tone="info">
                  {x}
                </Badge>
              ))}
            </div>
            <div className="mt-3 text-xs text-muted-foreground">
              Threshold {a.confidenceThreshold} · outbound {label(a.outboundMode)} · reviewer {label(a.reviewerRole)}
            </div>
            <div className="mt-2 flex items-center gap-2 text-xs">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, (a.actionsToday / Math.max(1, a.dailyActionCap)) * 100)}%` }} />
              </div>
              <span className="tabular-nums">
                {a.actionsToday}/{a.dailyActionCap} today
              </span>
            </div>
            {canControl && (
              <Button size="sm" className="mt-3" variant={a.killed ? 'primary' : 'danger'} busy={act.busy === a.id} onClick={() => run(a.id, `/v1/agents/${a.id}/${a.killed ? 'resume' : 'kill'}`)}>
                <Power className="h-3.5 w-3.5" /> {a.killed ? 'Resume' : 'Kill switch'}
              </Button>
            )}
          </Card>
        ))}
      </div>

      <Card
        className="mt-6 overflow-x-auto"
        title="Audit trail"
        action={
          <select className="h-7 rounded-md border border-border bg-background px-2 text-xs" value={agentFilter} onChange={(e) => setAgentFilter(e.target.value)} aria-label="Agent">
            <option value="all">All agents</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        }
      >
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="py-1.5 font-medium">When</th>
              <th className="font-medium">Agent</th>
              <th className="font-medium">Action</th>
              <th className="font-medium">Decision</th>
              <th className="font-medium">Why</th>
              <th className="font-medium">Model</th>
              <th />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {shown.map((x) => (
              <tr key={x.id} className="align-top">
                <td className="py-1.5 pr-2 text-xs whitespace-nowrap">{when(x.created_at)}</td>
                <td className="pr-2 text-xs">{label(x.agent_id)}</td>
                <td className="pr-2">
                  {x.target_object === 'opportunities' ? (
                    <button className="text-left hover:text-primary" onClick={() => openDeal(x.target_id)}>
                      {x.payload?.summary ?? x.action_type}
                    </button>
                  ) : (
                    (x.payload?.summary ?? x.action_type)
                  )}
                  <div className="text-xs text-muted-foreground">
                    {x.action_type} · {x.reversibility} · conf {Number(x.confidence ?? 0).toFixed(2)}
                  </div>
                </td>
                <td className="pr-2">
                  <Badge>{x.rolled_back_at ? 'rolled_back' : x.decision}</Badge>
                </td>
                <td className="max-w-xs pr-2 text-xs">{x.reason}</td>
                <td className="pr-2 text-xs text-muted-foreground">
                  {x.model} {x.prompt_version}
                </td>
                <td>
                  {x.decision === 'executed' && !x.rolled_back_at && canControl && (
                    <Button size="sm" variant="ghost" busy={act.busy === x.id} onClick={() => run(x.id, `/v1/agents/actions/${x.id}/rollback`)}>
                      <RotateCcw className="h-3 w-3" /> Roll back
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
