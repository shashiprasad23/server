import { ShieldAlert } from 'lucide-react';
import { api, label, when, type Json } from '@/api';
import { useSession } from '@/lib/session';
import { Badge, Card, Empty, ErrorNote, PageHeader, Spinner, useData } from '@/components/ui';

export function Compliance() {
  const { openDeal, version, has } = useSession();
  const q = useData(() => api<Json[]>('/v1/compliance/queue'), [version], 20000);
  return (
    <>
      <PageHeader
        title="Compliance queue"
        subtitle={
          <>
            Export-control screening for every AI-server deal: restricted parties, destinations, classifications, red flags and end-user statements.
            {!has('trade_compliance') && ' Only Trade Compliance can clear or block; you can screen and request statements.'}
          </>
        }
      />
      <ErrorNote error={q.error} />
      {!q.data && <Spinner />}
      {q.data && !q.data.length && <Empty>Nothing waiting for Trade Compliance.</Empty>}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {q.data?.map((o) => (
          <Card key={o.id} className="flex flex-col">
            <div className="flex items-start justify-between gap-2">
              <button className="text-left font-medium hover:text-primary" onClick={() => openDeal(o.id)}>
                {o.name}
              </button>
              <Badge>{o.compliance_status}</Badge>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {o.account_name} · {o.gpu_count ? `${o.gpu_count} × ${o.gpu_model}` : (o.gpu_model ?? 'GPU tbd')} · to {o.destination_country ?? 'unknown destination'}
            </div>
            <div className="mt-3 flex-1 space-y-1.5 text-sm">
              {o.last_screening ? (
                <>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Last screening</span>
                    <Badge>{o.last_screening.result}</Badge>
                    <span className="text-xs text-muted-foreground">{when(o.last_screening.created_at)}</span>
                  </div>
                  <p className="text-xs">{o.last_screening.licence_determination}</p>
                  {o.last_screening.matches?.map((m: Json, i: number) => (
                    <div key={i} className="flex items-start gap-1.5 text-xs text-bad">
                      <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {m.party} matches {m.listed} on {m.list} (score {Number(m.score).toFixed(2)})
                    </div>
                  ))}
                </>
              ) : (
                <p className="text-xs text-muted-foreground">Not screened yet.</p>
              )}
              {o.red_flags > 0 && <p className="text-xs text-bad">{o.red_flags} red-flag message{o.red_flags === 1 ? '' : 's'} in customer correspondence</p>}
            </div>
            <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
              <span>End-user statement: {label(o.eus_status)}</span>
              <button className="text-primary hover:underline" onClick={() => openDeal(o.id)}>
                Review →
              </button>
            </div>
          </Card>
        ))}
      </div>
      <p className="mt-6 text-xs text-muted-foreground">
        Restricted-party list and rules here are illustrative demo data. Trade Compliance must load the real lists and confirm destination and classification rules before go-live.
      </p>
    </>
  );
}
