import { useState } from 'react';
import { CheckCircle2, Circle } from 'lucide-react';
import { api, ago, label, type Json } from '@/api';
import { useSession } from '@/lib/session';
import { Badge, Card, Empty, ErrorNote, PageHeader, Spinner, Tabs, useAction, useData } from '@/components/ui';

export function Tasks() {
  const { version, touch, openDeal } = useSession();
  const [status, setStatus] = useState<'open' | 'done'>('open');
  const tasks = useData(() => api<Json[]>(`/v1/timeline/tasks?status=${status}`), [status, version]);
  const act = useAction();
  return (
    <>
      <PageHeader title="Tasks" subtitle="Work the agents and rules created for people: compliance reviews, presales site checks, NetSuite entry, renewals and follow-ups." />
      <Tabs<'open' | 'done'>
        tabs={[
          ['open', 'Open'],
          ['done', 'Done'],
        ]}
        value={status}
        onChange={setStatus}
      />
      <ErrorNote error={tasks.error ?? act.error} />
      <Card className="mt-4 p-2">
        {!tasks.data && <Spinner />}
        {tasks.data && !tasks.data.length && <Empty>No {status} tasks for you.</Empty>}
        <ul className="divide-y divide-border">
          {tasks.data?.map((t) => (
            <li key={t.id} className="flex items-start gap-3 px-2 py-2.5">
              <button
                aria-label="Complete"
                disabled={t.status === 'done' || act.busy === t.id}
                onClick={() =>
                  act.run(t.id, async () => {
                    await api(`/v1/tasks/${t.id}/complete`, { body: {} });
                    await tasks.reload();
                    touch();
                  })
                }
              >
                {t.status === 'done' ? <CheckCircle2 className="h-5 w-5 text-good" /> : <Circle className="h-5 w-5 text-muted-foreground hover:text-primary" />}
              </button>
              <div className="min-w-0 flex-1">
                <div className="text-sm">{t.title}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {t.assignee_role && <Badge tone="info">{t.assignee_role}</Badge>}
                  <span>from {label(t.created_by.startsWith('00000000') ? 'a person' : t.created_by)}</span>
                  <span>· {ago(t.created_at)}</span>
                  {t.object === 'opportunities' && t.record_id && (
                    <button className="text-primary hover:underline" onClick={() => openDeal(t.record_id)}>
                      Open deal
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
