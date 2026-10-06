import { useState } from 'react';
import { AlertTriangle, CheckCircle2, FileDown, Lock, PackageCheck, Wand2 } from 'lucide-react';
import { api, date, label, money, openHtml, type Json } from '@/api';
import { useSession } from '@/lib/session';
import { Badge, Button, Card, Empty, ErrorNote, Field, Spinner, useAction, useData } from '@/components/ui';
import { cn } from '@/lib/utils';

const input = 'h-8 rounded-md border border-border bg-background px-2 text-sm';

export function QuoteTab({ opp, onChanged }: { opp: Json; onChanged: () => void }) {
  const { has } = useSession();
  const [config, setConfig] = useState<Json | null>(null);
  const act = useAction();
  const side = useData(
    () =>
      Promise.all([
        api<Json[]>(`/v1/quotes?opportunityId=${opp.id}`),
        api<Json[]>(`/v1/supply/holds?opportunityId=${opp.id}`),
        api<Json[]>(`/v1/deal-registrations?opportunityId=${opp.id}`),
      ]),
    [opp.id, opp.version],
  );
  const [quotes, holds, regs] = side.data ?? [[], [], []];
  const after = async () => {
    await side.reload();
    onChanged();
  };

  return (
    <div className="space-y-4">
      <ErrorNote error={act.error} />
      <Card
        title="Configuration from the requirement sheet"
        action={
          <Button size="sm" variant="secondary" busy={act.busy === 'cfg'} onClick={() => act.run('cfg', async () => setConfig(await api<Json>(`/v1/opportunities/${opp.id}/configure`, { body: {} })))}>
            <Wand2 className="h-3.5 w-3.5" /> {config ? 'Re-run' : 'Configure'}
          </Button>
        }
      >
        {!config && <p className="text-sm text-muted-foreground">Builds a valid bill of materials (servers, fabric, optics, storage, racks, power, software, services) from the GPUs, cooling and power on the sheet, and checks stock net of other deals' holds.</p>}
        {config && (
          <>
            {config.errors.length > 0 && (
              <div className="mb-3 rounded-md border border-bad/30 bg-bad/10 p-3 text-sm text-bad">
                {config.errors.map((e: string) => (
                  <div key={e} className="flex gap-1.5">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {e}
                  </div>
                ))}
              </div>
            )}
            {config.warnings.length > 0 && (
              <ul className="mb-3 space-y-0.5 text-xs text-muted-foreground">
                {config.warnings.map((w: string) => (
                  <li key={w}>• {w}</li>
                ))}
              </ul>
            )}
            {config.valid && (
              <>
                <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Mini k="Systems" v={`${config.summary.units} × ${config.summary.gpus / Math.max(1, config.summary.units)} GPU`} />
                  <Mini k="Racks" v={config.summary.racks} />
                  <Mini k="Power" v={`${config.summary.power_kw_total} kW`} />
                  <Mini k="Needs per rack" v={`${config.summary.kw_per_rack_needed} kW, ${config.summary.cooling}`} />
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs text-muted-foreground">
                      <tr>
                        <th className="py-1.5 pr-2 font-medium">Item</th>
                        <th className="pr-2 text-right font-medium">Qty</th>
                        <th className="pr-2 text-right font-medium">Unit</th>
                        <th className="pr-2 font-medium">Supply</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {config.lines.map((l: Json) => (
                        <tr key={l.sku}>
                          <td className="py-1.5 pr-2">
                            <div>{l.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {l.sku} · {l.reason}
                            </div>
                          </td>
                          <td className="pr-2 text-right tabular-nums">{l.qty}</td>
                          <td className="pr-2 text-right tabular-nums">{money(l.unit_price)}</td>
                          <td className="pr-2">
                            {l.supply && (
                              <div className="text-xs">
                                <Badge>{l.supply.status}</Badge>
                                <div className="mt-0.5 text-muted-foreground">
                                  {l.supply.available} free{l.supply.lead_time_weeks ? ` · ${l.supply.lead_time_weeks} wk` : ''}
                                </div>
                                {l.supply.alternatives?.length > 0 && <div className="text-muted-foreground">Alt: {l.supply.alternatives.map((a: Json) => a.sku ?? a).join(', ')}</div>}
                              </div>
                            )}
                          </td>
                          <td className="text-right">
                            {['gpu_server', 'rack_system'].includes(l.category) && has('rep', 'deal_desk', 'procurement', 'sales_leader') && (
                              <Button
                                size="sm"
                                variant="ghost"
                                busy={act.busy === `hold-${l.sku}`}
                                onClick={() =>
                                  act.run(`hold-${l.sku}`, async () => {
                                    await api(`/v1/opportunities/${opp.id}/holds`, { body: { sku: l.sku, qty: l.qty } });
                                    await after();
                                  })
                                }
                              >
                                <Lock className="h-3 w-3" /> Hold
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        )}
      </Card>

      <NewQuote oppId={opp.id} onCreated={after} />

      {side.loading && !side.data && <Spinner />}
      {quotes.map((q) => (
        <QuoteCard key={q.id} q={q} onChanged={after} />
      ))}

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Stock holds">
          {holds.length ? (
            <ul className="space-y-2 text-sm">
              {holds.map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-2">
                  <div>
                    <div>
                      {h.qty} × {h.name}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      <Badge>{h.status}</Badge> {h.status === 'active' && `expires ${date(h.expires_at)}`}
                    </div>
                  </div>
                  {h.status === 'active' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      busy={act.busy === `rel-${h.id}`}
                      onClick={() =>
                        act.run(`rel-${h.id}`, async () => {
                          await api(`/v1/supply/holds/${h.id}`, { method: 'DELETE' });
                          await after();
                        })
                      }
                    >
                      Release
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No stock held. Configure, then hold scarce GPU systems while the customer decides.</p>
          )}
        </Card>
        <DealRegs opp={opp} regs={regs} onChanged={after} />
      </div>
    </div>
  );
}

function Mini({ k, v }: { k: string; v: unknown }) {
  return (
    <div className="rounded-lg bg-muted p-2">
      <div className="text-[11px] text-muted-foreground">{k}</div>
      <div className="text-sm font-medium tabular-nums">{String(v)}</div>
    </div>
  );
}

function NewQuote({ oppId, onCreated }: { oppId: string; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ discount_pct: '0', payment_terms: 'Net 30', validity_days: '14', notes: '' });
  const act = useAction();
  if (!open)
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        New quote version
      </Button>
    );
  return (
    <Card title="New quote version">
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Discount %">
          <input className={input} type="number" min={0} max={60} value={f.discount_pct} onChange={(e) => setF({ ...f, discount_pct: e.target.value })} />
        </Field>
        <Field label="Payment terms">
          <select className={input} value={f.payment_terms} onChange={(e) => setF({ ...f, payment_terms: e.target.value })}>
            {['Net 30', 'Net 45', 'Net 60', '50% advance, 50% on delivery', '100% advance'].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </Field>
        <Field label="Valid for (days)">
          <input className={input} type="number" min={1} max={90} value={f.validity_days} onChange={(e) => setF({ ...f, validity_days: e.target.value })} />
        </Field>
        <Field label="Notes">
          <input className={input} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        </Field>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Lines come from the configurator. Approval follows the matrix: rep up to 5%, deal desk to 15%, sales leader beyond, or below the margin floor.</p>
      <ErrorNote error={act.error} />
      <div className="mt-3 flex gap-2">
        <Button
          busy={act.busy === 'new'}
          onClick={() =>
            act.run('new', async () => {
              await api(`/v1/opportunities/${oppId}/quotes`, {
                body: { discount_pct: Number(f.discount_pct), payment_terms: f.payment_terms, validity_days: Number(f.validity_days), notes: f.notes || undefined },
              });
              setOpen(false);
              onCreated();
            })
          }
        >
          Create draft
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}

export function QuoteCard({ q, onChanged, showDeal }: { q: Json; onChanged: () => void; showDeal?: boolean }) {
  const { has, openDeal } = useSession();
  const act = useAction();
  const [lines, setLines] = useState<Json[] | null>(null);
  const [channel, setChannel] = useState('email');
  const run = (key: string, path: string, body: Json = {}) =>
    act.run(key, async () => {
      await api(path, { body });
      onChanged();
    });
  const canApprove = q.status === 'pending_approval' && (has(q.approval_role) || (q.approval_role === 'deal_desk' && has('sales_leader')));
  const dim = ['superseded', 'withdrawn', 'expired', 'rejected'].includes(q.status);
  return (
    <Card className={cn(dim && 'opacity-70')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">
              {q.number} v{q.version}
            </span>
            <Badge>{q.status}</Badge>
            {q.created_by?.startsWith('agent:') && <Badge tone="info">drafted by AI</Badge>}
          </div>
          {showDeal && (
            <button className="text-left text-sm text-primary hover:underline" onClick={() => openDeal(q.opportunity_id)}>
              {q.opportunity_name}
            </button>
          )}
          <div className="mt-1 text-xs text-muted-foreground">
            {q.discount_pct}% discount · {q.payment_terms} · valid to {date(q.valid_until)} · {q.racks} racks · {q.power_kw_total} kW · {q.cooling}
          </div>
        </div>
        <div className="ml-auto text-right">
          <div className="text-lg font-semibold tabular-nums">{money(q.total, q.currency)}</div>
          {'margin_pct' in q && (
            <div className={cn('text-xs tabular-nums', Number(q.margin_pct) < 8 ? 'text-bad' : 'text-muted-foreground')}>
              margin {money(q.margin)} ({q.margin_pct}%)
            </div>
          )}
        </div>
      </div>
      {q.approval_reasons?.length > 0 &&
        (['draft', 'pending_approval'].includes(q.status) ? (
          <div className="mt-2 rounded-md bg-warn/10 p-2 text-xs">
            <b>Needs {label(q.approval_role)} approval:</b> {q.approval_reasons.join('; ')}
          </div>
        ) : (
          <div className="mt-2 text-xs text-muted-foreground">
            Outside standard policy ({label(q.approval_role)} sign-off): {q.approval_reasons.join('; ')}
          </div>
        ))}
      {q.revalidation?.length > 0 && <div className="mt-2 rounded-md bg-bad/10 p-2 text-xs text-bad">Price or supply moved: {q.revalidation.map((r: Json) => `${r.sku === "*" ? "" : `${r.sku}: `}${r.detail}`).join('; ')}</div>}
      {q.config_warnings?.length > 0 && <div className="mt-2 text-xs text-muted-foreground">{q.config_warnings.join(' · ')}</div>}
      {q.approved_by && (
        <div className="mt-2 flex items-center gap-1 text-xs text-good">
          <CheckCircle2 className="h-3.5 w-3.5" /> Approved by {q.approved_by === 'policy' ? 'policy (within limits)' : 'a reviewer'}
        </div>
      )}
      <ErrorNote error={act.error} />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {q.status === 'draft' && (
          <Button size="sm" busy={act.busy === 'submit'} onClick={() => run('submit', `/v1/quotes/${q.id}/submit`)}>
            Submit
          </Button>
        )}
        {canApprove && (
          <>
            <Button size="sm" busy={act.busy === 'approve'} onClick={() => run('approve', `/v1/quotes/${q.id}/approve`)}>
              Approve
            </Button>
            <Button size="sm" variant="secondary" busy={act.busy === 'reject'} onClick={() => run('reject', `/v1/quotes/${q.id}/reject`, { note: prompt('Reason?') ?? undefined })}>
              Reject
            </Button>
          </>
        )}
        {q.status === 'approved' && has('rep', 'sales_leader') && (
          <>
            <select className="h-7 rounded-md border border-border bg-background px-1.5 text-xs" value={channel} onChange={(e) => setChannel(e.target.value)} aria-label="Publish channel">
              <option value="email">Email</option>
              <option value="marketplace">Marketplace</option>
              <option value="usp">Service Portal</option>
            </select>
            <Button size="sm" busy={act.busy === 'pub'} onClick={() => run('pub', `/v1/quotes/${q.id}/publish`, { channel })}>
              Send to customer
            </Button>
          </>
        )}
        {q.status === 'sent' && has('rep', 'sales_leader') && (
          <Button size="sm" busy={act.busy === 'acc'} onClick={() => run('acc', `/v1/quotes/${q.id}/accept`)}>
            <PackageCheck className="h-3.5 w-3.5" /> Customer accepted
          </Button>
        )}
        {['approved', 'sent'].includes(q.status) && (
          <Button size="sm" variant="secondary" busy={act.busy === 'reval'} onClick={() => run('reval', `/v1/quotes/${q.id}/revalidate`)}>
            Revalidate price & supply
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => act.run('pdf', () => openHtml(`/v1/quotes/${q.id}/proposal`))}>
          <FileDown className="h-3.5 w-3.5" /> Proposal
        </Button>
        <Button size="sm" variant="ghost" onClick={async () => setLines(lines ? null : ((await api<Json>(`/v1/quotes/${q.id}`)).lines as Json[]))}>
          {lines ? 'Hide lines' : 'Lines'}
        </Button>
      </div>
      {lines && (
        <table className="mt-3 w-full text-xs">
          <tbody className="divide-y divide-border">
            {lines.map((l) => (
              <tr key={l.id}>
                <td className="py-1 pr-2">
                  {l.description} <span className="text-muted-foreground">{l.sku}</span>
                </td>
                <td className="pr-2 text-right tabular-nums">{l.qty}</td>
                <td className="pr-2 text-right tabular-nums">{money(l.extended_price)}</td>
                <td>
                  <Badge>{l.supply_status ?? 'n/a'}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function DealRegs({ opp, regs, onChanged }: { opp: Json; regs: Json[]; onChanged: () => void }) {
  const { has } = useSession();
  const act = useAction();
  const [oem, setOem] = useState(opp.oem ?? '');
  const run = (key: string, fn: () => Promise<unknown>) =>
    act.run(key, async () => {
      await fn();
      onChanged();
    });
  return (
    <Card title="OEM deal registrations">
      {regs.length === 0 && <Empty>No registration yet. Registering protects pricing with the OEM.</Empty>}
      <ul className="space-y-2 text-sm">
        {regs.map((r) => (
          <li key={r.id}>
            <div className="flex items-center justify-between gap-2">
              <span>
                {r.oem} {r.portal_reference && <span className="text-xs text-muted-foreground">{r.portal_reference}</span>}
              </span>
              <Badge>{r.status}</Badge>
            </div>
            {r.status === 'approved' && (
              <div className="text-xs text-muted-foreground">
                {r.protected_discount_pct != null ? `${r.protected_discount_pct}% protected · ` : ''}expires {date(r.expires_at)}
              </div>
            )}
            <div className="mt-1 flex gap-2">
              {r.status === 'draft' && (
                <Button size="sm" variant="secondary" busy={act.busy === `s-${r.id}`} onClick={() => run(`s-${r.id}`, () => api(`/v1/deal-registrations/${r.id}/submit`, { body: {} }))}>
                  Mark submitted in OEM portal
                </Button>
              )}
              {r.status === 'submitted' && has('deal_desk', 'procurement', 'sales_leader', 'rep') && (
                <>
                  <Button
                    size="sm"
                    busy={act.busy === `a-${r.id}`}
                    onClick={() => {
                      const exp = prompt('Registration expiry date (YYYY-MM-DD)', new Date(Date.now() + 90 * 864e5).toISOString().slice(0, 10));
                      if (!exp) return;
                      const pct = prompt('Protected discount % (optional)', '');
                      run(`a-${r.id}`, () => api(`/v1/deal-registrations/${r.id}/approve`, { body: { expires_at: exp, protected_discount_pct: pct ? Number(pct) : undefined } }));
                    }}
                  >
                    OEM approved
                  </Button>
                  <Button size="sm" variant="ghost" busy={act.busy === `r-${r.id}`} onClick={() => run(`r-${r.id}`, () => api(`/v1/deal-registrations/${r.id}/reject`, { body: {} }))}>
                    Rejected
                  </Button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
      <ErrorNote error={act.error} />
      {has('rep', 'deal_desk', 'procurement', 'sales_leader') && (
        <div className="mt-3 flex items-end gap-2">
          <Field label="OEM">
            <input className={input} value={oem} onChange={(e) => setOem(e.target.value)} placeholder="Dell, Supermicro, HPE…" />
          </Field>
          <Button size="sm" variant="secondary" disabled={!oem} busy={act.busy === 'new'} onClick={() => run('new', () => api(`/v1/opportunities/${opp.id}/deal-registrations`, { body: { oem } }))}>
            Draft registration
          </Button>
        </div>
      )}
    </Card>
  );
}
