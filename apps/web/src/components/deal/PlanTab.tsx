import { useState } from 'react';
import { CheckCircle2, CircleDashed, CircleHelp, ListPlus, TriangleAlert } from 'lucide-react';
import { api, date, label, type Json } from '@/api';
import { Badge, Button, Card, Empty, ErrorNote, Field, useAction, useData } from '@/components/ui';

const input = 'h-8 rounded-md border border-border bg-background px-2 text-sm';

export function PlanTab({ opp }: { opp: Json }) {
  const data = useData(() => Promise.all([api<Json>(`/v1/opportunities/${opp.id}/readiness`), api<Json[]>(`/v1/opportunities/${opp.id}/milestones`)]), [opp.id, opp.version]);
  const act = useAction();
  const [m, setM] = useState({ title: '', owner_side: 'customer', due_date: '' });
  const [msg, setMsg] = useState<string | null>(null);
  const [readiness, milestones] = data.data ?? [null, []];
  const run = (key: string, fn: () => Promise<unknown>) =>
    act.run(key, async () => {
      await fn();
      await data.reload();
    });

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card
        title="Datacentre readiness"
        action={
          readiness?.gaps > 0 && (
            <Button
              size="sm"
              variant="secondary"
              busy={act.busy === 'tasks'}
              onClick={() =>
                run('tasks', async () => {
                  const r = await api<Json>(`/v1/opportunities/${opp.id}/readiness/tasks`, { body: {} });
                  setMsg(`Created ${r.created ?? r.length ?? 'the'} presales tasks for open items.`);
                })
              }
            >
              <ListPlus className="h-3.5 w-3.5" /> Tasks for gaps
            </Button>
          )
        }
      >
        {readiness ? (
          <>
            <ul className="space-y-2 text-sm">
              {readiness.items.map((i: Json, n: number) => (
                <li key={n} className="flex gap-2">
                  {i.status === 'ok' ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-good" aria-label="ok" />
                  ) : i.status === 'gap' ? (
                    <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-bad" aria-label="gap" />
                  ) : (
                    <CircleHelp className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-label="unknown" />
                  )}
                  <div>
                    <div className="font-medium">
                      {i.item} <span className="text-xs font-normal text-muted-foreground">{i.status}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">{i.detail}</div>
                  </div>
                </li>
              ))}
            </ul>
            {readiness.hostingOffer && <div className="mt-3 rounded-md bg-accent p-2 text-sm text-primary">{readiness.hostingOffer}: the site cannot take this configuration as specified.</div>}
            {msg && <p className="mt-2 text-xs text-good">{msg}</p>}
          </>
        ) : (
          <ErrorNote error={data.error} />
        )}
      </Card>

      <Card
        title="Mutual action plan"
        action={
          milestones.length === 0 && (
            <Button size="sm" variant="secondary" busy={act.busy === 'def'} onClick={() => run('def', () => api(`/v1/opportunities/${opp.id}/milestones/default`, { body: {} }))}>
              Use standard plan
            </Button>
          )
        }
      >
        {milestones.length === 0 && <Empty>No plan yet. The standard plan covers technical validation through delivery and acceptance.</Empty>}
        <ol className="space-y-1.5">
          {milestones.map((x) => (
            <li key={x.id} className="flex items-center gap-2 text-sm">
              <button
                aria-label={x.status === 'done' ? 'Reopen' : 'Mark done'}
                onClick={() => run(`m-${x.id}`, () => api(`/v1/milestones/${x.id}`, { method: 'PATCH', body: { status: x.status === 'done' ? 'open' : 'done' } }))}
              >
                {x.status === 'done' ? <CheckCircle2 className="h-4 w-4 text-good" /> : <CircleDashed className="h-4 w-4 text-muted-foreground" />}
              </button>
              <span className={x.status === 'done' ? 'flex-1 text-muted-foreground line-through' : 'flex-1'}>{x.title}</span>
              <Badge tone={x.owner_side === 'customer' ? 'info' : 'neutral'}>{x.owner_side}</Badge>
              <span className="w-24 text-right text-xs text-muted-foreground">{x.due_date ? date(x.due_date) : '—'}</span>
              {x.status === 'at_risk' && <Badge tone="bad">{label(x.status)}</Badge>}
            </li>
          ))}
        </ol>
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <div className="min-w-48 flex-1">
          <Field label="Add milestone">
            <input className={input} value={m.title} onChange={(e) => setM({ ...m, title: e.target.value })} placeholder="e.g. Customer confirms floor loading" />
          </Field>
          </div>
          <Field label="Owner">
            <select className={input} value={m.owner_side} onChange={(e) => setM({ ...m, owner_side: e.target.value })}>
              <option value="customer">customer</option>
              <option value="uvation">uvation</option>
            </select>
          </Field>
          <Field label="Due">
            <input type="date" className={input} value={m.due_date} onChange={(e) => setM({ ...m, due_date: e.target.value })} />
          </Field>
          <Button
            size="sm"
            disabled={!m.title}
            busy={act.busy === 'add'}
            onClick={() =>
              run('add', async () => {
                await api(`/v1/opportunities/${opp.id}/milestones`, { body: { title: m.title, owner_side: m.owner_side, due_date: m.due_date || undefined } });
                setM({ title: '', owner_side: 'customer', due_date: '' });
              })
            }
          >
            Add
          </Button>
        </div>
        <ErrorNote error={act.error} />
      </Card>
    </div>
  );
}
