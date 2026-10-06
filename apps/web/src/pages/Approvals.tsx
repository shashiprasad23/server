import { Bot, FileText } from 'lucide-react';
import { api, label, when, type Json } from '@/api';
import { useSession } from '@/lib/session';
import { QuoteCard } from '@/components/deal/QuoteTab';
import { Badge, Button, Card, Empty, ErrorNote, PageHeader, Spinner, useAction, useData } from '@/components/ui';

export function Approvals() {
  const { version, touch, openDeal } = useSession();
  const data = useData(() => Promise.all([api<Json[]>('/v1/approvals'), api<Json[]>('/v1/quotes?status=pending_approval')]), [version], 15000);
  const act = useAction();
  if (!data.data) return data.error ? <ErrorNote error={data.error} /> : <Spinner />;
  const [agentItems, quotes] = data.data;
  const after = async () => {
    await data.reload();
    touch();
  };
  const decide = (id: string, verb: 'approve' | 'reject') =>
    act.run(id, async () => {
      await api(`/v1/approvals/${id}/${verb}`, { body: verb === 'reject' ? { note: prompt('Reason for rejecting?') ?? undefined } : {} });
      await after();
    });

  return (
    <>
      <PageHeader title="Approvals" subtitle="Agent actions and quotes waiting on a person. Nothing here is approved automatically, and agent items expire if nobody decides." />
      <ErrorNote error={act.error} />
      <div className="grid gap-6 xl:grid-cols-2">
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Bot className="h-4 w-4" /> Agent actions ({agentItems.length})
          </h2>
          {!agentItems.length && <Empty>Nothing from the agents is waiting for you.</Empty>}
          <div className="space-y-3">
            {agentItems.map((a) => (
              <Card key={a.id}>
                <div className="flex flex-wrap items-center gap-2">
                  <strong className="text-sm">{a.summary}</strong>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge tone="info">{a.agent_id}</Badge>
                  <Badge>{a.action_type}</Badge>
                  confidence {Number(a.confidence ?? 0).toFixed(2)} · expires {when(a.expires_at)}
                </div>
                <p className="mt-2 text-xs">Why it is waiting: {a.reason}</p>
                {a.action_type === 'send_email' && (
                  <pre className="mt-2 rounded-md bg-muted p-3 font-sans text-xs whitespace-pre-wrap">
                    To: {a.payload.to}
                    {'\n'}Subject: {a.payload.subject}
                    {'\n\n'}
                    {a.payload.body}
                  </pre>
                )}
                {a.action_type === 'update_fields' && (
                  <div className="mt-2 rounded-md bg-muted p-2 text-xs">
                    {Object.entries(a.payload.fields ?? {}).map(([k, v]) => (
                      <div key={k}>
                        <b>{label(k)}</b> → {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                      </div>
                    ))}
                  </div>
                )}
                {!!a.evidence?.length && (
                  <details className="mt-2 text-xs">
                    <summary className="cursor-pointer text-muted-foreground">Evidence ({a.evidence.length})</summary>
                    {a.evidence.map((e: Json, i: number) => (
                      <div key={i} className="mt-1 italic">
                        {label(e.field)}: “{e.quote}”
                      </div>
                    ))}
                  </details>
                )}
                <div className="mt-3 flex gap-2">
                  <Button size="sm" busy={act.busy === a.id} onClick={() => decide(a.id, 'approve')}>
                    Approve
                  </Button>
                  <Button size="sm" variant="secondary" disabled={act.busy === a.id} onClick={() => decide(a.id, 'reject')}>
                    Reject
                  </Button>
                  {a.target_object === 'opportunities' && a.target_id && (
                    <Button size="sm" variant="ghost" onClick={() => openDeal(a.target_id)}>
                      Open deal
                    </Button>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </section>
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <FileText className="h-4 w-4" /> Quotes outside policy ({quotes.length})
          </h2>
          {!quotes.length && <Empty>No quotes waiting for approval.</Empty>}
          <div className="space-y-3">
            {quotes.map((q) => (
              <QuoteCard key={q.id} q={q} showDeal onChanged={after} />
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
