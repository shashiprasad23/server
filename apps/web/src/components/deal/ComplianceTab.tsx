import { useState } from 'react';
import { FileSignature, ShieldCheck, ShieldX } from 'lucide-react';
import { api, label, when, type Json } from '@/api';
import { useSession } from '@/lib/session';
import { Badge, Button, Card, Empty, ErrorNote, Field, KeyValue, useAction, useData } from '@/components/ui';

const input = 'h-8 rounded-md border border-border bg-background px-2 text-sm';

export function ComplianceTab({ opp, onChanged }: { opp: Json; onChanged: () => void }) {
  const { has } = useSession();
  const checks = useData(() => api<Json[]>(`/v1/compliance/opportunities/${opp.id}`), [opp.id, opp.version]);
  const act = useAction();
  const [eusRef, setEusRef] = useState('');
  const [decision, setDecision] = useState({ notes: '', licence_reference: '' });
  const run = (key: string, fn: () => Promise<unknown>) =>
    act.run(key, async () => {
      await fn();
      await checks.reload();
      onChanged();
    });
  const isTc = has('trade_compliance');

  return (
    <div className="space-y-4">
      <Card title="Status">
        <KeyValue
          items={[
            ['Compliance', <Badge key="c">{opp.compliance_status}</Badge>],
            ['End-user statement', <Badge key="e">{opp.eus_status ?? 'not_requested'}</Badge>],
            ['Ship to', opp.destination_country ?? '—'],
            ['End user', opp.end_user ?? '—'],
          ]}
        />
        <p className="mt-3 text-xs text-muted-foreground">
          Screening runs automatically when the deal, end user or destination changes, and customer messages are scanned for red flags. Only Trade Compliance can clear or block a deal; nothing ships to NetSuite until it is cleared.
        </p>
        <ErrorNote error={act.error} />
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" busy={act.busy === 'screen'} onClick={() => run('screen', () => api(`/v1/compliance/opportunities/${opp.id}/screen`, { body: {} }))}>
            <ShieldCheck className="h-3.5 w-3.5" /> Screen now
          </Button>
          {opp.eus_status !== 'received' && opp.eus_status !== 'requested' && (
            <Button size="sm" variant="secondary" busy={act.busy === 'eusr'} onClick={() => run('eusr', () => api(`/v1/compliance/opportunities/${opp.id}/eus/request`, { body: {} }))}>
              <FileSignature className="h-3.5 w-3.5" /> Request end-user statement
            </Button>
          )}
        </div>
        {opp.eus_status === 'requested' && (
          <div className="mt-3 flex items-end gap-2">
            <Field label="Signed statement reference">
              <input className={input} value={eusRef} onChange={(e) => setEusRef(e.target.value)} placeholder="DocuSign envelope ID" />
            </Field>
            <Button size="sm" busy={act.busy === 'eusv'} onClick={() => run('eusv', () => api(`/v1/compliance/opportunities/${opp.id}/eus/receive`, { body: { reference: eusRef || undefined } }))}>
              Mark received
            </Button>
          </div>
        )}
      </Card>

      {isTc && (
        <Card title="Trade Compliance decision">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Licence reference (if a licence is required)">
              <input className={input} value={decision.licence_reference} onChange={(e) => setDecision({ ...decision, licence_reference: e.target.value })} />
            </Field>
            <Field label="Notes">
              <input className={input} value={decision.notes} onChange={(e) => setDecision({ ...decision, notes: e.target.value })} />
            </Field>
          </div>
          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              busy={act.busy === 'clear'}
              onClick={() =>
                run('clear', () =>
                  api(`/v1/compliance/opportunities/${opp.id}/decision`, {
                    body: { decision: 'cleared', notes: decision.notes || undefined, licence_reference: decision.licence_reference || undefined },
                  }),
                )
              }
            >
              <ShieldCheck className="h-3.5 w-3.5" /> Clear
            </Button>
            <Button size="sm" variant="danger" busy={act.busy === 'block'} onClick={() => run('block', () => api(`/v1/compliance/opportunities/${opp.id}/decision`, { body: { decision: 'blocked', notes: decision.notes || undefined } }))}>
              <ShieldX className="h-3.5 w-3.5" /> Block
            </Button>
          </div>
        </Card>
      )}

      <Card title="Checks">
        {!checks.data?.length && <Empty>No checks yet.</Empty>}
        <ol className="space-y-3">
          {(checks.data ?? []).map((c) => (
            <li key={c.id} className="rounded-lg border border-border p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{label(c.kind)}</span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Badge>{c.result}</Badge> {when(c.created_at)} · {label(c.decided_by)}
                </span>
              </div>
              {c.licence_determination && <p className="mt-1 text-xs">{c.licence_determination}</p>}
              {c.matches?.length > 0 && (
                <ul className="mt-1 space-y-0.5 text-xs text-bad">
                  {c.matches.map((m: Json, i: number) => (
                    <li key={i}>
                      {m.party ?? m.phrase} ↔ {m.listed ?? m.quote ?? ''} {m.list && `(${m.list}, score ${Number(m.score).toFixed(2)})`}
                    </li>
                  ))}
                </ul>
              )}
              {c.parties?.length > 0 && <p className="mt-1 text-xs text-muted-foreground">Parties: {c.parties.map((p: Json) => `${p.name} (${label(p.role)})`).join(', ')}</p>}
              {c.classification?.length > 0 && (
                <p className="mt-1 text-xs text-muted-foreground">Classification: {Array.from(new Set(c.classification.map((x: Json) => x.export_class))).join(', ')}</p>
              )}
              {c.notes && <p className="mt-1 text-xs">{c.notes}</p>}
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
