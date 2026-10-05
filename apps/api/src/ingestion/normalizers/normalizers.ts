import { z } from 'zod';
import { validate } from '../../common/validate';
import { stripTransactionData } from '../../records/transaction-guardrail';
import { EventKind, NormalizedEvent, Participant, Source } from '../normalized-event';

/*
 * Event contracts per source. Marketplace and USP post these shapes from their webhooks
 * (agreed with the portal owners in Sprint 0). Outlook and Teams events are posted by the
 * Microsoft Graph connector, which turns Graph change notifications into these flattened shapes.
 */

const customer = z
  .object({
    email: z.string().email().optional(),
    name: z.string().optional(),
    company: z.string().optional(),
    phone: z.string().optional(),
    user_id: z.string().optional(),
  })
  .partial();

const marketplaceEvent = z.object({
  event_id: z.string().min(1),
  type: z.enum(['signup', 'rfq', 'custom_configuration', 'cart_abandoned', 'order_placed', 'web_chat', 'product_view']),
  occurred_at: z.string().datetime({ offset: true }),
  customer,
  data: z.record(z.string(), z.unknown()).default({}),
});

const uspEvent = z.object({
  event_id: z.string().min(1),
  type: z.enum(['signup', 'service_request', 'ticket', 'rma', 'contract_expiring', 'web_chat']),
  occurred_at: z.string().datetime({ offset: true }),
  customer,
  data: z.record(z.string(), z.unknown()).default({}),
});

const graphAddress = z.object({ emailAddress: z.object({ address: z.string().email(), name: z.string().optional() }) });

const outlookMessage = z.object({
  kind: z.literal('message'),
  id: z.string().min(1),
  conversationId: z.string().optional(),
  mailbox: z.string().email(),
  subject: z.string().optional().default(''),
  body: z.object({ contentType: z.enum(['text', 'html']).default('text'), content: z.string() }),
  from: graphAddress,
  toRecipients: z.array(graphAddress).default([]),
  ccRecipients: z.array(graphAddress).default([]),
  sentDateTime: z.string().datetime({ offset: true }),
  sensitivity: z.enum(['normal', 'personal', 'private', 'confidential']).default('normal'),
});

const outlookEvent = z.object({
  kind: z.literal('event'),
  id: z.string().min(1),
  mailbox: z.string().email(),
  subject: z.string().optional().default(''),
  body: z.object({ contentType: z.enum(['text', 'html']).default('text'), content: z.string() }).optional(),
  organizer: graphAddress,
  attendees: z.array(graphAddress).default([]),
  start: z.object({ dateTime: z.string() }),
  sensitivity: z.enum(['normal', 'personal', 'private', 'confidential']).default('normal'),
});

const teamsEvent = z.object({
  kind: z.enum(['chat_message', 'meeting_transcript', 'call_record']),
  id: z.string().min(1),
  threadId: z.string().optional(),
  chatType: z.enum(['external', 'internal', 'shared_channel']).default('external'),
  subject: z.string().optional(),
  from: z.object({ email: z.string().email(), name: z.string().optional() }),
  participants: z.array(z.object({ email: z.string().email(), name: z.string().optional() })).default([]),
  body: z.string(),
  createdDateTime: z.string().datetime({ offset: true }),
});

const whatsappEvent = z.object({
  id: z.string().min(1),
  from: z.string().min(5),
  name: z.string().optional(),
  email: z.string().email().optional(),
  text: z.string(),
  timestamp: z.string().datetime({ offset: true }),
  to_business_number: z.string().optional(),
});

const htmlToText = (html: string) =>
  html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const portalKind: Record<string, EventKind> = {
  signup: 'signup',
  rfq: 'rfq',
  custom_configuration: 'rfq',
  cart_abandoned: 'cart',
  order_placed: 'order',
  product_view: 'behaviour',
  service_request: 'service_request',
  ticket: 'ticket',
  rma: 'ticket',
  contract_expiring: 'contract_expiring',
  web_chat: 'communication',
};

function portal(source: 'marketplace' | 'usp', raw: unknown): NormalizedEvent {
  const e = source === 'marketplace' ? validate(marketplaceEvent, raw) : validate(uspEvent, raw);
  const data = stripTransactionData(e.data);
  const c = e.customer;
  const kind = portalKind[e.type];
  const message = typeof data.message === 'string' ? data.message : typeof data.description === 'string' ? data.description : '';
  return {
    source,
    type: e.type,
    externalId: e.event_id,
    occurredAt: e.occurred_at,
    kind,
    customer: {
      email: c.email,
      name: c.name,
      company: c.company,
      phone: c.phone,
      marketplaceUserId: source === 'marketplace' ? c.user_id : undefined,
      uspUserId: source === 'usp' ? c.user_id : undefined,
    },
    communication:
      kind === 'communication'
        ? {
            channel: 'chat',
            subject: `${source === 'marketplace' ? 'Marketplace' : 'USP'} web chat`,
            body: message,
            threadId: typeof data.session_id === 'string' ? data.session_id : undefined,
            participants: c.email ? [{ email: c.email, name: c.name, role: 'from' }] : [],
          }
        : undefined,
    data,
  };
}

function outlook(raw: unknown): NormalizedEvent {
  const kind = (raw as { kind?: string })?.kind;
  if (kind === 'event') {
    const e = validate(outlookEvent, raw);
    const participants: Participant[] = [
      { email: e.organizer.emailAddress.address, name: e.organizer.emailAddress.name, role: 'from' },
      ...e.attendees.map((a) => ({ email: a.emailAddress.address, name: a.emailAddress.name, role: 'attendee' as const })),
    ];
    return {
      source: 'outlook',
      type: 'calendar_event',
      externalId: e.id,
      occurredAt: new Date(e.start.dateTime).toISOString(),
      kind: 'communication',
      communication: {
        channel: 'meeting',
        subject: e.subject,
        body: e.body ? (e.body.contentType === 'html' ? htmlToText(e.body.content) : e.body.content) : '',
        mailbox: e.mailbox.toLowerCase(),
        private: e.sensitivity === 'private' || e.sensitivity === 'personal',
        participants,
      },
      data: {},
    };
  }
  const m = validate(outlookMessage, raw);
  const participants: Participant[] = [
    { email: m.from.emailAddress.address, name: m.from.emailAddress.name, role: 'from' },
    ...m.toRecipients.map((r) => ({ email: r.emailAddress.address, name: r.emailAddress.name, role: 'to' as const })),
    ...m.ccRecipients.map((r) => ({ email: r.emailAddress.address, name: r.emailAddress.name, role: 'cc' as const })),
  ];
  return {
    source: 'outlook',
    type: 'email',
    externalId: m.id,
    occurredAt: m.sentDateTime,
    kind: 'communication',
    communication: {
      channel: 'email',
      subject: m.subject,
      body: m.body.contentType === 'html' ? htmlToText(m.body.content) : m.body.content,
      threadId: m.conversationId,
      mailbox: m.mailbox.toLowerCase(),
      private: m.sensitivity === 'private' || m.sensitivity === 'personal',
      participants,
    },
    data: {},
  };
}

function teams(raw: unknown): NormalizedEvent {
  const t = validate(teamsEvent, raw);
  const channel = t.kind === 'meeting_transcript' ? 'meeting' : t.kind === 'call_record' ? 'call' : 'chat';
  return {
    source: 'teams',
    type: t.kind,
    externalId: t.id,
    occurredAt: t.createdDateTime,
    kind: 'communication',
    communication: {
      channel,
      subject: t.subject ?? (channel === 'chat' ? 'Teams chat' : channel === 'call' ? 'Teams call' : 'Teams meeting'),
      body: t.body,
      threadId: t.threadId,
      internalOnly: t.chatType === 'internal',
      participants: [
        { email: t.from.email, name: t.from.name, role: 'from' },
        ...t.participants.filter((p) => p.email !== t.from.email).map((p) => ({ email: p.email, name: p.name, role: 'to' as const })),
      ],
    },
    data: {},
  };
}

function whatsapp(raw: unknown): NormalizedEvent {
  const w = validate(whatsappEvent, raw);
  return {
    source: 'whatsapp',
    type: 'message',
    externalId: w.id,
    occurredAt: w.timestamp,
    kind: 'communication',
    customer: { phone: w.from, name: w.name, email: w.email },
    communication: {
      channel: 'chat',
      subject: 'WhatsApp message',
      body: w.text,
      participants: [{ phone: w.from, email: w.email, name: w.name, role: 'from' }],
    },
    data: {},
  };
}

export function normalize(source: Source, raw: unknown): NormalizedEvent {
  switch (source) {
    case 'marketplace':
    case 'usp':
      return portal(source, raw);
    case 'outlook':
      return outlook(raw);
    case 'teams':
      return teams(raw);
    case 'whatsapp':
      return whatsapp(raw);
  }
}
