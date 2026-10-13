import { APIRequestContext, APIResponse, request } from '@playwright/test';
import { env, Role } from '../../config/env';
import { endpoints } from '../../config/endpoints';
import type {
  AuditEntry,
  ConfigValidation,
  CreateQuoteInput,
  EmailRecord,
  Quote,
  ServerConfiguration,
} from './types';

/** Thin, typed client for the marketplace quote API. Every method returns the raw response for negative tests. */
export class QuoteApi {
  constructor(
    readonly ctx: APIRequestContext,
    readonly role: Role | 'anonymous',
  ) {}

  static async create(role: Role | 'anonymous'): Promise<QuoteApi> {
    const base = await request.newContext({ baseURL: env.apiBaseUrl });
    if (role === 'anonymous') return new QuoteApi(base, role);
    const creds = env.credentials[role];
    const res = await base.post(endpoints.login, { data: creds });
    if (!res.ok())
      throw new Error(`Login failed for ${role} (${creds.email}): ${res.status()} ${await res.text()}`);
    const { token } = await res.json();
    await base.dispose();
    const ctx = await request.newContext({
      baseURL: env.apiBaseUrl,
      extraHTTPHeaders: { Authorization: `Bearer ${token}` },
    });
    return new QuoteApi(ctx, role);
  }

  dispose() {
    return this.ctx.dispose();
  }

  lookupCustomer(email: string) {
    return this.ctx.get(endpoints.customerLookup(email));
  }

  getProduct(sku: string) {
    return this.ctx.get(endpoints.product(sku));
  }

  validateConfiguration(config: ServerConfiguration) {
    return this.ctx.post(endpoints.validateConfiguration, { data: config });
  }

  async validateConfigurationOk(config: ServerConfiguration): Promise<ConfigValidation> {
    return json(await this.validateConfiguration(config));
  }

  validateDiscount(code: string, customerEmail?: string) {
    return this.ctx.post(endpoints.validateDiscount, { data: { code, customerEmail } });
  }

  createQuote(input: CreateQuoteInput, idempotencyKey?: string) {
    return this.ctx.post(endpoints.quotes, {
      data: input,
      headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
    });
  }

  async createQuoteOk(input: CreateQuoteInput, idempotencyKey?: string): Promise<Quote> {
    return json(await this.createQuote(input, idempotencyKey), 201);
  }

  listQuotes(query: Record<string, string> = {}) {
    return this.ctx.get(endpoints.quotes, { params: query });
  }

  getQuote(id: string) {
    return this.ctx.get(endpoints.quote(id));
  }

  async getQuoteOk(id: string): Promise<Quote> {
    return json(await this.getQuote(id));
  }

  updateQuote(id: string, patch: Partial<CreateQuoteInput> & { reprice?: boolean }, version?: number) {
    return this.ctx.patch(endpoints.quote(id), {
      data: patch,
      headers: version !== undefined ? { 'If-Match': String(version) } : undefined,
    });
  }

  async updateQuoteOk(
    id: string,
    patch: Parameters<QuoteApi['updateQuote']>[1],
    version?: number,
  ): Promise<Quote> {
    return json(await this.updateQuote(id, patch, version));
  }

  action(id: string, action: string, data: Record<string, unknown> = {}) {
    return this.ctx.post(endpoints.quoteAction(id, action), { data });
  }

  async actionOk<T = Quote>(id: string, action: string, data: Record<string, unknown> = {}): Promise<T> {
    return json(await this.action(id, action, data));
  }

  submit = (id: string) => this.actionOk(id, 'submit');
  approve = (id: string, comment = 'Approved by automation') => this.actionOk(id, 'approve', { comment });
  reject = (id: string, comment: string) => this.actionOk(id, 'reject', { comment });
  send = (id: string, recipients: string[]) => this.action(id, 'send', { recipients });
  resend = (id: string) => this.action(id, 'resend');
  accept = (id: string) => this.action(id, 'accept');
  convert = (id: string) => this.action(id, 'convert');
  cancel = (id: string, reason: string) => this.action(id, 'cancel', { reason });
  overridePrice = (id: string, lineId: string, unitPrice: number, reason?: string) =>
    this.action(id, 'price-override', { lineId, unitPrice, reason });

  revisions(id: string) {
    return this.ctx.get(endpoints.quoteAction(id, 'revisions'));
  }

  pdf(id: string) {
    return this.ctx.get(endpoints.quotePdf(id));
  }

  async audit(id: string): Promise<AuditEntry[]> {
    return json(await this.ctx.get(endpoints.quoteAudit(id)));
  }

  async emails(id: string): Promise<EmailRecord[]> {
    return json(await this.ctx.get(endpoints.quoteEmails(id)));
  }

  ordersForQuote(id: string) {
    return this.ctx.get(endpoints.ordersForQuote(id));
  }

  sharedQuote(token: string) {
    return this.ctx.get(endpoints.sharedQuote(token));
  }

  /** Customer acceptance through the secure quote link sent by email. */
  acceptViaLink(token: string) {
    return this.ctx.post(`${endpoints.sharedQuote(token)}/accept`);
  }
}

export async function json<T = any>(res: APIResponse, expectedStatus?: number): Promise<T> {
  const ok = expectedStatus ? res.status() === expectedStatus : res.ok();
  if (!ok) {
    throw new Error(
      `Unexpected ${res.status()} from ${res.url()} (expected ${expectedStatus ?? '2xx'}): ${await res.text()}`,
    );
  }
  return (await res.json()) as T;
}
