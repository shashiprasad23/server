/**
 * Contract-stub of the Uvation Marketplace quote service.
 *
 * It implements the API contract in config/endpoints.ts and the business rules from the test plan so the
 * automation pipeline can be verified end-to-end in CI without a deployed environment (TEST_ENV=mock).
 * It is NOT the product: real-environment runs point BASE_URL/API_BASE_URL at QA/staging instead.
 */
import http from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { URL } from 'node:url';
import {
  CatalogItem,
  defaultCatalog,
  discountCodes,
  gpus,
  negotiatedPrices,
  optionPrices,
  policy,
  serverRules,
  shippingRates,
  taxRates,
} from './catalog';
import { renderQuotePdf } from './pdf';
import { renderPage } from './ui';

type Role = 'admin' | 'sales' | 'approver' | 'finance' | 'customer';
interface User {
  email: string;
  role: Role;
  companyId?: string;
}
interface Ctx {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  url: URL;
  user?: User;
  body: any;
  correlationId: string;
}

const PORT = Number(process.env.MOCK_PORT ?? 4010);
const users: Record<string, User> = {
  'admin@uvation.test': { email: 'admin@uvation.test', role: 'admin' },
  'sales@uvation.test': { email: 'sales@uvation.test', role: 'sales' },
  'approver@uvation.test': { email: 'approver@uvation.test', role: 'approver' },
  'finance@uvation.test': { email: 'finance@uvation.test', role: 'finance' },
  'buyer@acme-ai.test': { email: 'buyer@acme-ai.test', role: 'customer', companyId: 'C-ACME' },
  'buyer@globex.test': { email: 'buyer@globex.test', role: 'customer', companyId: 'C-GLOBEX' },
};
const staff: Role[] = ['admin', 'sales', 'approver', 'finance'];

// ---------------------------------------------------------------- state
let state = freshState();
function freshState() {
  return {
    catalog: defaultCatalog(),
    priceListVersion: 1,
    customers: new Map<string, any>([
      [
        'buyer@acme-ai.test',
        {
          id: 'CU-ACME-1',
          companyId: 'C-ACME',
          companyName: 'Acme AI Labs',
          contactName: 'Jordan Lee',
          email: 'buyer@acme-ai.test',
          phone: '+14155550101',
        },
      ],
      [
        'buyer@globex.test',
        {
          id: 'CU-GLOBEX-1',
          companyId: 'C-GLOBEX',
          companyName: 'Globex Compute',
          contactName: 'Sam Ortiz',
          email: 'buyer@globex.test',
          phone: '+12125550199',
        },
      ],
    ]),
    quotes: new Map<string, any>(),
    revisions: new Map<string, any[]>(),
    audit: new Map<string, any[]>(),
    emails: new Map<string, any[]>(),
    orders: new Map<string, any>(),
    idempotency: new Map<string, { status: number; body: any }>(),
    mail: [] as any[],
    logs: [] as any[],
    seq: 0,
  };
}
const tokens = new Map<string, User>();
let faults: { emailFailure?: boolean; pricingLatencyMs?: number; crashDuringCreate?: boolean } = {};

// ---------------------------------------------------------------- helpers
class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: Record<string, unknown>,
  ) {
    super(String(body.error ?? status));
  }
}
const fail = (status: number, error: string, extra: Record<string, unknown> = {}) => {
  throw new HttpError(status, { error, ...extra });
};
const invalid = (errors: Record<string, string>) => fail(422, 'Validation failed', { errors });
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const now = () => new Date().toISOString();
const EMAIL_RE = /^[^\s@<>()]+@[^\s@<>()]+\.[A-Za-z]{2,}$/;
const PHONE_RE = /^\+?[0-9][0-9 ()-]{6,19}$/;

function log(ctx: Ctx | { correlationId: string }, level: string, message: string) {
  state.logs.push({ at: now(), level, message, correlationId: ctx.correlationId });
}
function audit(quoteId: string, action: string, actor: string, details?: Record<string, unknown>) {
  const list = state.audit.get(quoteId) ?? [];
  list.push({ action, actor, at: now(), details });
  state.audit.set(quoteId, list);
}
function requireRole(ctx: Ctx, ...roles: Role[]): User {
  if (!ctx.user) fail(401, 'Authentication required');
  if (!roles.includes(ctx.user!.role))
    fail(403, `Role ${ctx.user!.role} is not allowed to perform this action`);
  return ctx.user!;
}
function loadQuote(ctx: Ctx, id: string) {
  const q = state.quotes.get(id);
  if (!ctx.user) fail(401, 'Authentication required');
  // Customers only see their own company's quotes; others get 404 so quote IDs are not enumerable.
  if (!q || (ctx.user!.role === 'customer' && q.customer.companyId !== ctx.user!.companyId))
    fail(404, 'Quote not found');
  return q;
}
function expireIfNeeded(q: any) {
  if (['Sent', 'Approved'].includes(q.status) && new Date(q.terms.validUntil) < new Date())
    q.status = 'Expired';
}
function assertStatus(q: any, allowed: string[], action: string) {
  expireIfNeeded(q);
  if (!allowed.includes(q.status))
    fail(409, `Cannot ${action} a quote in status ${q.status}`, {
      status: q.status,
      code: 'INVALID_TRANSITION',
    });
}

// ---------------------------------------------------------------- configuration rules
function validateConfiguration(cfg: any) {
  const errors: { field: string; message: string }[] = [];
  const adjustments: { component: string; from?: string; to: string; reason: string }[] = [];
  const alternatives: string[] = [];
  const rules = (serverRules as any)[cfg?.model];
  if (!rules)
    return {
      valid: false,
      errors: [{ field: 'model', message: `Unknown server model ${cfg?.model}` }],
      adjustments,
      alternatives,
    };
  if (cfg.cpu && !rules.cpus.includes(cfg.cpu))
    errors.push({ field: 'cpu', message: `CPU ${cfg.cpu} is not compatible with ${cfg.model}` });
  if (cfg.motherboard && !rules.motherboards.includes(cfg.motherboard))
    errors.push({
      field: 'motherboard',
      message: `Motherboard ${cfg.motherboard} is not compatible with ${cfg.model}`,
    });
  if (cfg.gpu) {
    const gpu = gpus[cfg.gpu.model];
    if (!gpu) errors.push({ field: 'gpu.model', message: `Unknown GPU ${cfg.gpu.model}` });
    else {
      if (!rules.gpuCounts.includes(cfg.gpu.count))
        errors.push({ field: 'gpu.count', message: `Supported GPU counts: ${rules.gpuCounts.join(', ')}` });
      if (gpu.watts * cfg.gpu.count > rules.psuWatts) {
        errors.push({
          field: 'gpu',
          message: `${cfg.gpu.count}x ${cfg.gpu.model} needs ${gpu.watts * cfg.gpu.count}W; chassis supports ${rules.psuWatts}W`,
        });
        alternatives.push('H200');
      }
      if (gpu.requiresPsu && cfg.psu !== gpu.requiresPsu)
        adjustments.push({
          component: 'psu',
          from: cfg.psu ?? rules.defaultPsu,
          to: gpu.requiresPsu,
          reason: `${cfg.gpu.model} requires ${gpu.requiresPsu}`,
        });
    }
  }
  if (cfg.ramGb !== undefined && (cfg.ramGb <= 0 || cfg.ramGb > rules.maxRamGb))
    errors.push({ field: 'ramGb', message: `RAM must be between 1 and ${rules.maxRamGb} GB` });
  if (cfg.storageTb !== undefined && (cfg.storageTb <= 0 || cfg.storageTb > rules.maxStorageTb))
    errors.push({ field: 'storageTb', message: `Storage must be between 1 and ${rules.maxStorageTb} TB` });
  if (cfg.nic && !rules.nics.includes(cfg.nic))
    errors.push({
      field: 'nic',
      message: `NIC ${cfg.nic} is not supported; choose ${rules.nics.join(', ')}`,
    });
  return { valid: errors.length === 0, errors, adjustments, alternatives };
}

// ---------------------------------------------------------------- pricing
function priceLine(input: any, companyId: string | undefined, locked?: any) {
  const p: CatalogItem | undefined = state.catalog[input.sku];
  if (!p) invalid({ items: `Unknown product ${input.sku}` });
  if (p!.availability !== 'available')
    fail(422, `${p!.sku} is ${p!.availability}`, {
      errors: { items: `${p!.sku} is ${p!.availability}; consider ${p!.alternatives?.join(', ')}` },
      alternatives: p!.alternatives ?? [],
    });
  if (!Number.isInteger(input.quantity) || input.quantity < 1)
    invalid({ quantity: 'Quantity must be a whole number ≥ 1' });
  let configuration = input.configuration;
  let leadTimeDays = p!.leadTimeDays;
  const availability: any = { status: 'available' };
  let base = locked?.basePrice ?? negotiatedPrices[companyId ?? '']?.[p!.sku] ?? p!.basePrice;
  if (base <= 0) invalid({ unitPrice: 'Price must be greater than zero' });
  let options = 0;
  if (configuration) {
    const v = validateConfiguration(configuration);
    if (!v.valid)
      fail(422, 'Invalid configuration', {
        errors: { configuration: v.errors.map((e) => e.message).join('; ') },
        alternatives: v.alternatives,
      });
    configuration = { ...configuration };
    for (const a of v.adjustments) configuration[a.component] = a.to;
    if (configuration.gpu) {
      const g = gpus[configuration.gpu.model];
      options += g.price * configuration.gpu.count;
      const needed = configuration.gpu.count * input.quantity;
      if (needed > g.stock) {
        availability.status = 'constrained';
        availability.message = `Only ${g.stock} ${configuration.gpu.model} GPUs available; ${needed} requested. Lead time 45 days.`;
        availability.alternatives = ['H200'];
        leadTimeDays = 45;
      }
    }
    options +=
      (configuration.ramGb ?? 0) * optionPrices.ramPerGb +
      (configuration.storageTb ?? 0) * optionPrices.storagePerTb;
    options += optionPrices.cpu[configuration.cpu] ?? 0;
  }
  const tier = p!.type === 'product' ? (input.quantity >= 50 ? 0.9 : input.quantity >= 10 ? 0.95 : 1) : 1;
  const unitPrice = locked?.overridePrice ?? r2((base + options) * tier);
  const line: any = {
    lineId: locked?.lineId ?? `L-${randomBytes(3).toString('hex')}`,
    sku: p!.sku,
    name: p!.name,
    description: input.description ?? p!.description,
    type: p!.type,
    quantity: input.quantity,
    unitPrice,
    taxable: p!.taxable,
    configuration,
    specVersion: locked?.specVersion ?? p!.specVersion,
    leadTimeDays,
    availability,
    _basePrice: base,
    _optionsCost: options * 0.8,
    _override: locked?.overridePrice !== undefined,
  };
  if (p!.lease) {
    const deposit = unitPrice * p!.lease.depositMonths;
    line.recurring = {
      period: 'month',
      termMonths: p!.lease.termMonths,
      deposit,
      recurringTotal: r2(unitPrice * p!.lease.termMonths * input.quantity),
    };
    line.lineTotal = r2((deposit + unitPrice) * input.quantity);
  } else line.lineTotal = r2(unitPrice * input.quantity);
  return line;
}

function resolveDiscount(code: string | undefined, email: string) {
  if (!code) return null;
  const d = discountCodes[code.toUpperCase()];
  if (!d) invalid({ discountCode: 'Discount code is invalid' });
  if (d!.expired) invalid({ discountCode: 'Discount code has expired' });
  if (d!.emailDomain && !email.endsWith(d!.emailDomain))
    invalid({ discountCode: 'Discount code is not eligible for this customer' });
  return { code: code.toUpperCase(), percent: d!.percent };
}

function computeTotals(q: any) {
  const pct = q.discount?.percent ?? 0;
  q.subtotal = r2(q.items.reduce((s: number, l: any) => s + l.lineTotal, 0));
  q.discountTotal = r2((q.subtotal * pct) / 100);
  if (q.discount) q.discount.amount = q.discountTotal;
  q.taxableBase = r2(
    q.items.filter((l: any) => l.taxable).reduce((s: number, l: any) => s + l.lineTotal, 0) * (1 - pct / 100),
  );
  const rate = q.shipping ? (taxRates[q.shipping.destination] ?? 0) : 0;
  q.taxTotal = r2((q.taxableBase * rate) / 100);
  q.shippingTotal = q.shipping && q.items.length ? (shippingRates[q.shipping.method] ?? 0) : 0;
  q.grandTotal = r2(q.subtotal - q.discountTotal + q.taxTotal + q.shippingTotal);
  const leadTimes = q.items.filter((l: any) => l.leadTimeDays > 0);
  q.terms.deliveryEstimate = leadTimes.length
    ? leadTimes.map((l: any) => `${l.sku}: ${l.leadTimeDays} days`).join('; ')
    : 'To be confirmed';
  const skus = q.items.map((l: any) => l.sku);
  q.terms.warranty = [
    skus.includes('SVC-WARRANTY-3Y') ? '3-year extended warranty' : 'Standard 1-year manufacturer warranty',
    skus.includes('SVC-SLA-GOLD') ? 'Gold SLA: 4-hour on-site response' : null,
  ]
    .filter(Boolean)
    .join('; ');
}

function buildItems(
  inputs: any[],
  companyId: string | undefined,
  previous: any[] = [],
  reprice = false,
  actor = '',
  quoteId = '',
) {
  return inputs.map((i) => {
    const prev = previous.find((l) => (i.lineId ? l.lineId === i.lineId : l.sku === i.sku));
    const locked =
      prev && !reprice
        ? {
            basePrice: prev._basePrice,
            lineId: prev.lineId,
            specVersion: prev.specVersion,
            overridePrice: prev._override ? prev.unitPrice : undefined,
          }
        : prev
          ? { lineId: prev.lineId }
          : undefined;
    const line = priceLine(
      { ...prev, ...i, configuration: i.configuration ?? prev?.configuration },
      companyId,
      locked,
    );
    if (prev && reprice && prev.unitPrice !== line.unitPrice)
      audit(quoteId, 'repriced', actor, {
        lineId: line.lineId,
        from: prev.unitPrice,
        to: line.unitPrice,
        priceListVersion: state.priceListVersion,
      });
    return line;
  });
}

function publicQuote(q: any) {
  const { lastRecipients, ...rest } = q;
  return { ...rest, items: q.items.map(({ _basePrice, _optionsCost, _override, ...l }: any) => l) };
}

// ---------------------------------------------------------------- handlers
async function createQuote(ctx: Ctx) {
  const b = ctx.body ?? {};
  const actor = ctx.user;
  if (actor && !['admin', 'sales', 'customer'].includes(actor.role))
    fail(403, `Role ${actor.role} cannot create quotes`);
  const idemKey = ctx.req.headers['idempotency-key'] as string | undefined;
  const idemScope = idemKey ? `${actor?.email ?? 'guest'}:${idemKey}` : undefined;
  if (idemScope && state.idempotency.has(idemScope)) {
    const prior = state.idempotency.get(idemScope)!;
    ctx.res.setHeader('Idempotent-Replay', 'true');
    return [prior.status, prior.body] as const;
  }

  const c = b.customer ?? {};
  const errors: Record<string, string> = {};
  if (!c.email) errors.email = 'Email required';
  else if (!EMAIL_RE.test(c.email)) errors.email = 'Invalid email address';
  if (c.phone && (!PHONE_RE.test(c.phone) || c.phone.replace(/\D/g, '').length < 7))
    errors.phone = 'Invalid phone number';
  if (!actor && !c.contactName) errors.contactName = 'Contact name required for guest requests';
  const inquiryType = b.inquiryType ?? 'product';
  if ((!b.items || b.items.length === 0) && inquiryType !== 'general')
    errors.items = 'Select a product or submit a general inquiry';
  const currency = b.currency ?? 'USD';
  if (!policy.supportedCurrencies.includes(currency))
    errors.currency = `Currency ${currency} is not supported`;
  if (
    b.manualDiscountPercent !== undefined &&
    (b.manualDiscountPercent < 0 || b.manualDiscountPercent > policy.maxDiscountPercent)
  )
    errors.manualDiscountPercent = `Discount must be between 0 and ${policy.maxDiscountPercent}%`;
  if (Object.keys(errors).length) invalid(errors);

  if (faults.pricingLatencyMs) {
    await new Promise((r) => setTimeout(r, Math.min(faults.pricingLatencyMs!, policy.pricingTimeoutMs)));
    if (faults.pricingLatencyMs >= policy.pricingTimeoutMs) {
      log(ctx, 'error', 'Pricing service timeout while creating quote');
      fail(503, 'Pricing service timeout; please retry', {
        correlationId: ctx.correlationId,
        retryable: true,
      });
    }
  }

  // Customer resolution: registered customers are linked; new staff-entered customers are registered; anonymous = guest.
  let customer = state.customers.get(c.email.toLowerCase());
  if (actor?.role === 'customer') customer = state.customers.get(actor.email);
  const guest = !actor && !customer;
  if (!customer) {
    customer = {
      id: `CU-${randomBytes(4).toString('hex')}`,
      companyId: `C-${randomBytes(4).toString('hex')}`,
      companyName: c.companyName,
      contactName: c.contactName,
      email: c.email.toLowerCase(),
      phone: c.phone,
    };
  }
  const discountFromCode = resolveDiscount(b.discountCode, customer.email);
  const items = buildItems(b.items ?? [], customer.companyId);
  if (faults.crashDuringCreate) {
    log(ctx, 'error', 'Quote service crashed during creation (transaction rolled back)');
    fail(500, 'Internal error; no quote was created', { correlationId: ctx.correlationId, retryable: true });
  }

  const id = randomUUID();
  const created = now();
  const q: any = {
    id,
    number: `UQ-${new Date().getFullYear()}-${String(++state.seq).padStart(6, '0')}`,
    status: 'Draft',
    revision: 1,
    version: 1,
    currency,
    inquiryType,
    customer: {
      ...customer,
      guest,
      guestReference: guest ? `GUEST-${randomBytes(4).toString('hex').toUpperCase()}` : undefined,
    },
    items,
    discount: discountFromCode ?? (b.manualDiscountPercent ? { percent: b.manualDiscountPercent } : null),
    shipping: b.shipping,
    terms: {
      paymentTerms: 'Net 30',
      deliveryEstimate: '',
      warranty: '',
      validUntil: new Date(Date.now() + policy.validityDays * 86400_000).toISOString(),
      exclusions: 'Excludes import duties, site preparation and power infrastructure.',
    },
    approval: { required: false, reasons: [], approvals: [] },
    review: b.customSpec ? { technical: true, commercial: true } : undefined,
    customSpec: b.customSpec,
    notes: b.notes,
    priceLock: { priceListVersion: state.priceListVersion, lockedUntil: '' },
    createdBy: actor?.email ?? 'guest',
    createdAt: created,
    updatedAt: created,
  };
  q.priceLock.lockedUntil = q.terms.validUntil;
  computeTotals(q);
  if (!guest) state.customers.set(customer.email, customer);
  state.quotes.set(id, q);
  audit(id, 'created', q.createdBy);
  const result = [201, publicQuote(q)] as const;
  if (idemScope) state.idempotency.set(idemScope, { status: 201, body: result[1] });
  return result;
}

function updateQuote(ctx: Ctx, q: any) {
  const u = requireRole(ctx, 'admin', 'sales');
  const ifMatch = ctx.req.headers['if-match'];
  if (ifMatch !== undefined && Number(ifMatch) !== q.version)
    fail(409, 'Quote was modified by another user; reload and retry', {
      code: 'VERSION_CONFLICT',
      currentVersion: q.version,
    });
  assertStatus(q, ['Draft', 'PendingApproval', 'Approved', 'Rejected', 'Sent'], 'edit');
  const b = ctx.body ?? {};
  if (q.status === 'Sent') {
    const revs = state.revisions.get(q.id) ?? [];
    revs.push(JSON.parse(JSON.stringify(publicQuote(q))));
    state.revisions.set(q.id, revs);
    q.revision += 1;
    audit(q.id, 'revised', u.email, { revision: q.revision });
  }
  if (b.items) q.items = buildItems(b.items, q.customer.companyId, q.items, !!b.reprice, u.email, q.id);
  else if (b.reprice)
    q.items = buildItems(
      q.items.map((l: any) => ({ lineId: l.lineId, sku: l.sku, quantity: l.quantity })),
      q.customer.companyId,
      q.items,
      true,
      u.email,
      q.id,
    );
  if (b.reprice) q.priceLock.priceListVersion = state.priceListVersion;
  if ('discountCode' in b) q.discount = resolveDiscount(b.discountCode, q.customer.email);
  if (b.manualDiscountPercent !== undefined) {
    if (b.manualDiscountPercent < 0 || b.manualDiscountPercent > policy.maxDiscountPercent)
      invalid({ manualDiscountPercent: `Discount must be between 0 and ${policy.maxDiscountPercent}%` });
    q.discount = { percent: b.manualDiscountPercent };
  }
  if (b.shipping) q.shipping = b.shipping;
  if (b.customer) {
    // Only contact fields are editable; identity/ownership fields are never mass-assigned.
    for (const k of ['companyName', 'contactName', 'phone'])
      if (k in b.customer) q.customer[k] = b.customer[k];
  }
  if ('notes' in b) q.notes = b.notes;
  computeTotals(q);
  q.status = 'Draft';
  q.approval = { required: false, reasons: [], approvals: [] };
  q.version += 1;
  q.updatedAt = now();
  audit(q.id, 'updated', u.email, { fields: Object.keys(b) });
  return publicQuote(q);
}

function submitQuote(ctx: Ctx, q: any) {
  const u = requireRole(ctx, 'admin', 'sales');
  assertStatus(q, ['Draft', 'Rejected'], 'submit');
  if (!q.items.length) fail(409, 'A general inquiry must be configured before it can be submitted');
  const reasons: string[] = [];
  const pct = q.discount?.percent ?? 0;
  if (pct > policy.salesRepDiscountAuthorityPercent) reasons.push('discount-exceeds-authority');
  if (q.grandTotal > policy.highValueThreshold) reasons.push('high-value');
  const revenue = q.subtotal - q.discountTotal;
  // Margin uses the *current* supplier cost so cost changes before approval are re-evaluated (SQ-072).
  const cost = q.items.reduce(
    (s: number, l: any) => s + ((state.catalog[l.sku]?.cost ?? 0) + l._optionsCost) * l.quantity,
    0,
  );
  if (revenue > 0 && ((revenue - cost) / revenue) * 100 < policy.minMarginPercent)
    reasons.push('margin-below-threshold');
  if (q.items.some((l: any) => l._override)) reasons.push('price-override');
  if (q.customSpec) reasons.push('technical-review', 'commercial-review');
  q.approval = { required: reasons.length > 0, reasons, approvals: [] };
  q.status = reasons.length ? 'PendingApproval' : 'Approved';
  q.version += 1;
  audit(q.id, 'submitted', u.email, { reasons });
  return publicQuote(q);
}

function requiredApprovers(q: any) {
  const roles = new Set<string>();
  for (const r of q.approval.reasons) roles.add(r === 'high-value' ? 'finance' : 'approver');
  return roles;
}

function approveQuote(ctx: Ctx, q: any) {
  const u = requireRole(ctx, 'admin', 'approver', 'finance');
  assertStatus(q, ['PendingApproval'], 'approve');
  const needed = requiredApprovers(q);
  const role =
    u.role === 'admin'
      ? ([...needed].find((r) => !q.approval.approvals.some((a: any) => a.role === r)) ?? 'approver')
      : u.role;
  if (!needed.has(role))
    fail(403, `Approval by ${role} is not required for this quote`, { required: [...needed] });
  q.approval.approvals.push({ role, by: u.email, at: now() });
  if ([...needed].every((r) => q.approval.approvals.some((a: any) => a.role === r))) q.status = 'Approved';
  q.version += 1;
  audit(q.id, 'approved', u.email, { role, comment: ctx.body?.comment });
  return publicQuote(q);
}

function rejectQuote(ctx: Ctx, q: any) {
  const u = requireRole(ctx, 'admin', 'approver', 'finance');
  assertStatus(q, ['PendingApproval'], 'reject');
  if (!ctx.body?.comment) invalid({ comment: 'A rejection reason is required' });
  q.status = 'Rejected';
  q.approval.rejectionReason = ctx.body.comment;
  q.version += 1;
  audit(q.id, 'rejected', u.email, { comment: ctx.body.comment });
  return publicQuote(q);
}

async function deliver(ctx: Ctx, q: any, recipients: string[], type: 'send' | 'resend') {
  const records = state.emails.get(q.id) ?? [];
  if (faults.emailFailure) {
    for (const to of recipients)
      records.push({
        id: randomUUID(),
        to: [to],
        status: 'failed',
        revision: q.revision,
        type,
        error: 'SMTP 554 provider unavailable',
        at: now(),
      });
    state.emails.set(q.id, records);
    audit(q.id, 'email-failed', ctx.user!.email, { recipients, correlationId: ctx.correlationId });
    log(ctx, 'error', `Email delivery failed for quote ${q.number}`);
    fail(502, 'Email delivery failed; the quote was not sent and can be retried', {
      correlationId: ctx.correlationId,
      emailStatus: 'failed',
    });
  }
  q.shareToken ??= randomBytes(24).toString('hex');
  const pdf = await renderQuotePdf(publicQuote(q));
  const link = `${process.env.MOCK_PUBLIC_URL ?? `http://localhost:${PORT}`}/q/${q.shareToken}`;
  // One message per recipient: recipients never see each other's addresses.
  for (const to of recipients) {
    const subject = `Uvation quote ${q.number} (revision ${q.revision})`;
    const text = `Hello,\n\nPlease find attached quote ${q.number} revision ${q.revision} for ${q.customer.companyName ?? q.customer.email}.\nTotal: ${q.currency} ${q.grandTotal.toFixed(2)}\nView securely: ${link}\n\nUvation Marketplace`;
    state.mail.push({
      ID: randomUUID(),
      Subject: subject,
      From: { Address: 'quotes@uvation.com' },
      To: [{ Address: to }],
      Cc: [],
      Bcc: [],
      Text: text,
      HTML: `<p>${text.replace(/\n/g, '<br>')}</p>`,
      attachment: {
        PartID: '2',
        FileName: `${q.number}-r${q.revision}.pdf`,
        ContentType: 'application/pdf',
        data: pdf,
      },
    });
    records.push({ id: randomUUID(), to: [to], status: 'sent', revision: q.revision, type, at: now() });
  }
  state.emails.set(q.id, records);
  q.lastRecipients = recipients;
  audit(q.id, type === 'send' ? 'sent' : 'resent', ctx.user!.email, { recipients, revision: q.revision });
}

async function sendQuote(ctx: Ctx, q: any) {
  requireRole(ctx, 'admin', 'sales');
  const recipients: string[] = ctx.body?.recipients ?? [];
  if (!recipients.length) invalid({ recipients: 'At least one recipient is required' });
  const bad = recipients.filter((r) => !EMAIL_RE.test(r));
  if (bad.length) invalid({ recipients: `Invalid email address: ${bad.join(', ')}` });
  if (q.status === 'Draft' || q.status === 'PendingApproval')
    fail(409, 'Quote must be approved before sending', { code: 'NOT_APPROVED' });
  assertStatus(q, ['Approved'], 'send');
  await deliver(ctx, q, recipients, 'send');
  q.status = 'Sent';
  q.version += 1;
  return { ...publicQuote(q), delivery: 'sent' };
}

async function resendQuote(ctx: Ctx, q: any) {
  requireRole(ctx, 'admin', 'sales');
  assertStatus(q, ['Sent'], 'resend');
  await deliver(ctx, q, q.lastRecipients, 'resend');
  return { ...publicQuote(q), delivery: 'sent' };
}

function acceptQuote(ctx: Ctx, q: any, actor: string) {
  assertStatus(q, ['Sent'], 'accept');
  if (new Date(q.terms.validUntil) < new Date()) {
    q.status = 'Expired';
    fail(409, 'Quote has expired; request a revalidated quote', { code: 'QUOTE_EXPIRED' });
  }
  q.status = 'Accepted';
  q.acceptedAt = now();
  q.acceptedRevision = q.revision;
  q.version += 1;
  audit(q.id, 'accepted', actor, { revision: q.revision });
  return publicQuote(q);
}

function convertQuote(ctx: Ctx, q: any) {
  const u = requireRole(ctx, 'admin', 'sales');
  if (q.status === 'Converted')
    fail(409, 'Quote already converted', { code: 'ALREADY_CONVERTED', orderId: q.orderId });
  assertStatus(q, ['Accepted'], 'convert');
  const blocked = q.items.filter((l: any) => state.catalog[l.sku]?.availability !== 'available');
  if (blocked.length) {
    audit(q.id, 'conversion-blocked', u.email, { skus: blocked.map((l: any) => l.sku) });
    fail(409, `Fulfillment exception: ${blocked.map((l: any) => l.sku).join(', ')} no longer available`, {
      code: 'FULFILLMENT_EXCEPTION',
    });
  }
  const order = {
    id: `SO-${randomBytes(4).toString('hex').toUpperCase()}`,
    quoteId: q.id,
    quoteNumber: q.number,
    quoteRevision: q.revision,
    customer: q.customer,
    currency: q.currency,
    items: publicQuote(q).items,
    subtotal: q.subtotal,
    discountTotal: q.discountTotal,
    taxTotal: q.taxTotal,
    shippingTotal: q.shippingTotal,
    grandTotal: q.grandTotal,
    terms: q.terms,
    createdAt: now(),
  };
  state.orders.set(order.id, order);
  q.status = 'Converted';
  q.orderId = order.id;
  q.version += 1;
  audit(q.id, 'converted', u.email, { orderId: order.id });
  return order;
}

function cancelQuote(ctx: Ctx, q: any) {
  const u = requireRole(ctx, 'admin', 'sales');
  if (!ctx.body?.reason) invalid({ reason: 'A cancellation reason is required' });
  assertStatus(q, ['Draft', 'PendingApproval', 'Approved', 'Rejected', 'Sent'], 'cancel');
  q.status = 'Cancelled';
  q.cancellationReason = ctx.body.reason;
  q.version += 1;
  audit(q.id, 'cancelled', u.email, { reason: ctx.body.reason });
  return publicQuote(q);
}

function overridePrice(ctx: Ctx, q: any) {
  const u = requireRole(ctx, 'admin', 'sales');
  assertStatus(q, ['Draft', 'Rejected'], 'override price on');
  const { lineId, unitPrice, reason } = ctx.body ?? {};
  const line = q.items.find((l: any) => l.lineId === lineId);
  if (!line) invalid({ lineId: 'Unknown line' });
  if (typeof unitPrice !== 'number' || unitPrice <= 0)
    invalid({ unitPrice: 'Unit price must be greater than zero' });
  if (!reason) invalid({ reason: 'An override reason is required' });
  const original = line.unitPrice;
  line.unitPrice = unitPrice;
  line.lineTotal = r2(unitPrice * line.quantity);
  line._override = true;
  computeTotals(q);
  q.version += 1;
  audit(q.id, 'price-override', u.email, { lineId, originalPrice: original, newPrice: unitPrice, reason });
  return publicQuote(q);
}

// ---------------------------------------------------------------- router
async function route(ctx: Ctx): Promise<readonly [number, any] | void> {
  const { req, url } = ctx;
  const m = req.method!;
  const p = url.pathname;
  let match: RegExpMatchArray | null;

  if (p === '/health') return [200, { status: 'ok' }];
  if (m === 'POST' && p === '/api/auth/login') {
    const user = users[(ctx.body?.email ?? '').toLowerCase()];
    if (!user || ctx.body?.password !== 'change-me') fail(401, 'Invalid credentials');
    const token = randomBytes(16).toString('hex');
    tokens.set(token, user!);
    return [200, { token, role: user!.role, companyId: user!.companyId }];
  }
  if (m === 'GET' && p === '/api/customers/lookup') {
    requireRole(ctx, ...staff);
    const c = state.customers.get((url.searchParams.get('email') ?? '').toLowerCase());
    return c ? [200, c] : [404, { error: 'No data found' }];
  }
  if (m === 'GET' && (match = p.match(/^\/api\/products\/([^/]+)$/))) {
    const prod = state.catalog[decodeURIComponent(match[1])];
    if (!prod) fail(404, 'Product not found');
    const { cost, ...pub } = prod!;
    return [200, pub];
  }
  if (m === 'GET' && p === '/api/products')
    return [200, Object.values(state.catalog).map(({ cost, ...pub }) => pub)];
  if (m === 'POST' && p === '/api/configurations/validate') return [200, validateConfiguration(ctx.body)];
  if (m === 'POST' && p === '/api/discounts/validate') {
    try {
      const d = resolveDiscount(ctx.body?.code, ctx.body?.customerEmail ?? '');
      return [200, { valid: true, percent: d!.percent }];
    } catch (e) {
      if (e instanceof HttpError)
        return [200, { valid: false, message: (e.body.errors as any).discountCode }];
      throw e;
    }
  }
  if (p === '/api/quotes' && m === 'POST') return createQuote(ctx);
  if (p === '/api/quotes' && m === 'GET') {
    requireRole(ctx, ...staff, 'customer');
    const email = url.searchParams.get('customerEmail')?.toLowerCase();
    const list = [...state.quotes.values()].filter(
      (q) =>
        (!email || q.customer.email === email) &&
        (ctx.user!.role !== 'customer' || q.customer.companyId === ctx.user!.companyId),
    );
    return [200, list.map(publicQuote)];
  }
  if ((match = p.match(/^\/api\/quotes\/([\w-]+)(?:\/([\w-]+))?$/))) {
    const [, id, action] = match;
    const q = loadQuote(ctx, id);
    const isStaff = staff.includes(ctx.user!.role);
    if (!action && m === 'GET') return [200, publicQuote(q)];
    if (!action && m === 'PATCH') return [200, updateQuote(ctx, q)];
    if (m === 'GET' && action === 'pdf') {
      const pdf = await renderQuotePdf(publicQuote(q));
      ctx.res.writeHead(200, {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${q.number}.pdf"`,
      });
      ctx.res.end(pdf);
      return;
    }
    if (m === 'GET' && action === 'audit')
      return requireRole(ctx, ...staff), [200, state.audit.get(id) ?? []];
    if (m === 'GET' && action === 'emails')
      return requireRole(ctx, ...staff), [200, state.emails.get(id) ?? []];
    if (m === 'GET' && action === 'revisions')
      return [200, [...(state.revisions.get(id) ?? []), publicQuote(q)]];
    if (m === 'POST') {
      switch (action) {
        case 'submit':
          return [200, submitQuote(ctx, q)];
        case 'approve':
          return [200, approveQuote(ctx, q)];
        case 'reject':
          return [200, rejectQuote(ctx, q)];
        case 'send':
          return [200, await sendQuote(ctx, q)];
        case 'resend':
          return [200, await resendQuote(ctx, q)];
        case 'accept':
          if (isStaff && ctx.user!.role !== 'admin') fail(403, 'Only the customer can accept a quote');
          return [200, acceptQuote(ctx, q, ctx.user!.email)];
        case 'convert':
          return [201, convertQuote(ctx, q)];
        case 'cancel':
          return [200, cancelQuote(ctx, q)];
        case 'price-override':
          return [200, overridePrice(ctx, q)];
      }
    }
  }
  if (m === 'GET' && p === '/api/orders') {
    requireRole(ctx, ...staff);
    return [200, [...state.orders.values()].filter((o) => o.quoteId === url.searchParams.get('quoteId'))];
  }
  if ((match = p.match(/^\/q\/([a-f0-9]{48})(\/accept)?$/))) {
    const q = [...state.quotes.values()].find((x) => x.shareToken === match![1]);
    if (!q) fail(404, 'Quote link is invalid or has expired');
    if (match[2] && m === 'POST') return [200, acceptQuote(ctx, q, `link:${q.customer.email}`)];
    const { items, number, revision, status, grandTotal, currency, terms, customer } = publicQuote(q);
    return [
      200,
      {
        number,
        revision,
        status,
        grandTotal,
        currency,
        terms,
        items,
        customer: { companyName: customer.companyName },
      },
    ];
  }
  if (p.startsWith('/q/')) fail(404, 'Quote link is invalid or has expired');

  // ---- Mailpit-compatible mail catcher
  if (m === 'GET' && p === '/mailpit/api/v1/search') {
    const terms = (url.searchParams.get('query') ?? '').split(/\s+/).filter(Boolean);
    const hit = (msg: any) =>
      terms.every((t) => {
        const [k, ...v] = t.split(':');
        const val = v.join(':').replace(/^"|"$/g, '').toLowerCase();
        if (k === 'to') return msg.To.some((a: any) => a.Address.toLowerCase() === val);
        if (k === 'subject') return msg.Subject.toLowerCase().includes(val);
        return (msg.Subject + msg.Text).toLowerCase().includes(t.toLowerCase());
      });
    const messages = state.mail
      .filter(hit)
      .map(({ Text, HTML, attachment, ...s }) => ({ ...s, Attachments: attachment ? 1 : 0 }));
    return [200, { total: messages.length, messages }];
  }
  if ((match = p.match(/^\/mailpit\/api\/v1\/message\/([\w-]+)(?:\/part\/(\w+))?$/))) {
    const msg = state.mail.find((x) => x.ID === match![1]);
    if (!msg) fail(404, 'Message not found');
    if (match[2]) {
      ctx.res.writeHead(200, { 'Content-Type': msg.attachment.ContentType });
      ctx.res.end(msg.attachment.data);
      return;
    }
    const { attachment, ...rest } = msg;
    return [
      200,
      {
        ...rest,
        Attachments: attachment
          ? [
              {
                PartID: attachment.PartID,
                FileName: attachment.FileName,
                ContentType: attachment.ContentType,
              },
            ]
          : [],
      },
    ];
  }

  // ---- Fault-injection / test hooks
  if (m === 'POST' && p === '/__test/fault') {
    const b = ctx.body ?? {};
    if (b.reset) {
      faults = {};
      state.catalog = defaultCatalog();
    }
    if ('emailFailure' in b) faults.emailFailure = b.emailFailure;
    if ('pricingLatencyMs' in b) faults.pricingLatencyMs = b.pricingLatencyMs;
    if ('crashDuringCreate' in b) faults.crashDuringCreate = b.crashDuringCreate;
    if (b.catalog) {
      const item = state.catalog[b.catalog.sku];
      if (!item) fail(404, 'Unknown sku');
      Object.assign(item, b.catalog);
      if (b.catalog.basePrice !== undefined) state.priceListVersion += 1;
    }
    if (b.expireQuote) {
      const q = state.quotes.get(b.expireQuote);
      if (!q) fail(404, 'Unknown quote');
      q.terms.validUntil = new Date(Date.now() - 86400_000).toISOString();
    }
    return [200, { faults, priceListVersion: state.priceListVersion }];
  }
  if (m === 'POST' && p === '/__test/restart') {
    // Simulates a process restart: in-flight state is dropped and the store is re-hydrated from its serialized form.
    const snapshot = JSON.stringify({
      ...state,
      quotes: [...state.quotes],
      idempotency: [...state.idempotency],
    });
    const restored = JSON.parse(snapshot);
    state.quotes = new Map(restored.quotes);
    state.idempotency = new Map(restored.idempotency);
    faults = {};
    return [200, { restarted: true }];
  }
  if (m === 'GET' && p === '/__test/logs')
    return [200, state.logs.filter((l) => l.correlationId === url.searchParams.get('correlationId'))];

  // ---- UI pages
  if (m === 'GET') {
    const page = renderPage(p);
    if (page) {
      ctx.res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      ctx.res.end(page);
      return;
    }
  }
  fail(404, 'Not found');
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url!, `http://${req.headers.host}`);
  const correlationId = (req.headers['x-correlation-id'] as string) ?? randomUUID();
  res.setHeader('X-Correlation-Id', correlationId);
  const ctx: Ctx = { req, res, url, correlationId, body: undefined };
  try {
    const chunks: Buffer[] = [];
    for await (const ch of req) chunks.push(ch as Buffer);
    const raw = Buffer.concat(chunks).toString();
    if (raw) {
      try {
        ctx.body = JSON.parse(raw);
      } catch {
        fail(400, 'Malformed JSON');
      }
    }
    const auth = req.headers.authorization?.replace(/^Bearer /, '');
    ctx.user = auth ? tokens.get(auth) : undefined;
    if (auth && !ctx.user) fail(401, 'Invalid or expired token');
    const out = await route(ctx);
    if (out && !res.headersSent) {
      res.writeHead(out[0], { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out[1]));
    }
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    const body = e instanceof HttpError ? e.body : { error: 'Internal error' };
    if (status >= 500) log(ctx, 'error', `${req.method} ${url.pathname} -> ${status}: ${body.error}`);
    if (!(e instanceof HttpError)) console.error(e);
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ...body, correlationId }));
  }
});

server.listen(PORT, () => console.log(`Uvation marketplace mock listening on http://localhost:${PORT}`));
