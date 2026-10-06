import type { QuoteRow } from './cpq.service';

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const money = (n: unknown, cur = 'USD') => new Intl.NumberFormat('en-US', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(Number(n ?? 0));

export interface ProposalContext {
  quote: QuoteRow;
  opportunity: Record<string, unknown>;
  account?: Record<string, unknown>;
  contact?: Record<string, unknown>;
  milestones: { title: string; owner_side: string; due_date: string | Date | null }[];
}

/**
 * FR-CPQ-09: branded proposal assembled from the approved quote. Printable HTML (Save as PDF from
 * the browser). Never includes cost, margin or rebates.
 */
export function renderProposal({ quote: q, opportunity: o, account, contact, milestones }: ProposalContext): string {
  const lines = q.lines ?? [];
  const group = (cats: string[]) => lines.filter((l) => cats.includes(String(l.category)));
  const section = (title: string, rows: Record<string, unknown>[]) =>
    rows.length
      ? `<h3>${esc(title)}</h3><table><thead><tr><th>SKU</th><th>Description</th><th class="n">Qty</th><th class="n">Unit</th><th class="n">Extended</th><th>Availability</th></tr></thead><tbody>${rows
          .map(
            (l) =>
              `<tr><td>${esc(l.sku)}</td><td>${esc(l.description)}</td><td class="n">${esc(l.qty)}</td><td class="n">${money(l.unit_price, q.currency)}</td><td class="n">${money(l.extended_price, q.currency)}</td><td>${
                l.supply_status === 'in_stock' ? 'In stock' : `${esc(l.lead_time_weeks)} weeks`
              }</td></tr>`,
          )
          .join('')}</tbody></table>`
      : '';
  const server = lines.find((l) => l.category === 'gpu_server' || l.category === 'rack_system');
  const date = (d: unknown) => (d ? new Date(String(d)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'to be agreed');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Proposal ${esc(q.number)} v${esc(q.version)}</title>
<style>
 body{font-family:Inter,system-ui,sans-serif;color:#17202a;max-width:900px;margin:32px auto;padding:0 24px;line-height:1.45}
 header{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #2357d9;padding-bottom:12px;margin-bottom:24px}
 h1{margin:0;font-size:26px} h2{margin-top:28px;font-size:18px} h3{font-size:14px;margin:18px 0 6px;color:#2357d9}
 .muted{color:#5f6b7a} table{width:100%;border-collapse:collapse;font-size:13px} th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #e2e6eb}
 .n{text-align:right} .totals td{font-weight:600} .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
 .tile{border:1px solid #e2e6eb;border-radius:8px;padding:10px 12px} .tile b{display:block;font-size:20px}
 @media print{body{margin:0}}
</style></head><body>
<header><div><div class="muted">Uvation · AI infrastructure proposal</div><h1>${esc(o.name)}</h1></div>
<div class="muted">Proposal ${esc(q.number)} v${esc(q.version)}<br>Valid until ${date(q.valid_until)}</div></header>
<p>Prepared for ${esc(contact?.name ?? '')}${contact?.name ? ', ' : ''}${esc(account?.name ?? '')}.</p>

<h2>Solution summary</h2>
<div class="grid">
 <div class="tile"><span class="muted">Compute</span><b>${esc(server?.qty ?? '')} x ${esc(o.gpu_model ?? '')}</b><span class="muted">${esc(server?.description ?? '')}</span></div>
 <div class="tile"><span class="muted">Power</span><b>${esc(q.power_kw_total)} kW</b><span class="muted">${esc(q.racks)} rack(s), ${esc(q.cooling ?? 'air')} cooling</span></div>
 <div class="tile"><span class="muted">Investment</span><b>${money(q.total, q.currency)}</b><span class="muted">${esc(q.payment_terms)}</span></div>
</div>
<p>Workload: ${esc(o.workload ?? 'to be confirmed')}. Deployment: ${esc(String(o.deployment_location ?? 'to be confirmed').replace('_', ' '))}. Destination: ${esc(o.destination_country ?? 'to be confirmed')}.</p>

<h2>Datacentre requirements</h2>
<ul>
 <li>Total power about ${esc(q.power_kw_total)} kW across ${esc(q.racks)} rack(s); ${esc(q.cooling === 'liquid' ? 'direct liquid cooling with facility water loop' : 'air cooling, rear-door heat exchangers recommended above 30 kW per rack')}.</li>
 <li>Floor loading, loading-dock access and network uplinks to be confirmed during the site survey.</li>
 ${(q.config_warnings ?? []).map((w) => `<li>${esc(w)}</li>`).join('')}
</ul>

<h2>Bill of materials</h2>
${section('Compute', group(['gpu_server', 'rack_system']))}
${section('Networking', group(['networking', 'optics']))}
${section('Storage', group(['storage']))}
${section('Racks and power', group(['rack_infra']))}
${section('Software', group(['software']))}
${section('Services and support', group(['service', 'support']))}
<table class="totals"><tbody>
 <tr><td>Subtotal${q.discount_pct ? ` (includes ${esc(q.discount_pct)}% discount)` : ''}</td><td class="n">${money(q.subtotal, q.currency)}</td></tr>
 <tr><td>Freight and insurance</td><td class="n">${money(q.freight, q.currency)}</td></tr>
 <tr><td>Total (excluding taxes)</td><td class="n">${money(q.total, q.currency)}</td></tr>
</tbody></table>

<h2>Delivery plan</h2>
<table><thead><tr><th>Milestone</th><th>Owner</th><th>Target</th></tr></thead><tbody>
${milestones.map((m) => `<tr><td>${esc(m.title)}</td><td>${m.owner_side === 'customer' ? esc(account?.name ?? 'Customer') : 'Uvation'}</td><td>${date(m.due_date)}</td></tr>`).join('')}
</tbody></table>

<h2>Terms</h2>
<ul>
 <li>Prices valid until ${date(q.valid_until)}; GPU availability and lead times are confirmed at order.</li>
 <li>Orders are subject to export-control screening and an end-user statement.</li>
 <li>Payment terms: ${esc(q.payment_terms)}. Orders and invoicing are handled by Uvation Finance.</li>
</ul>
<p class="muted">Uvation · uvation.com</p>
</body></html>`;
}
