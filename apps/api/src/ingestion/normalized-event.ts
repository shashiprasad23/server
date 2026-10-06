export const SOURCES = ['marketplace', 'usp', 'outlook', 'teams', 'whatsapp'] as const;
export type Source = (typeof SOURCES)[number];

export interface Participant {
  email?: string;
  phone?: string;
  name?: string;
  role: 'from' | 'to' | 'cc' | 'attendee';
}

export interface CustomerRef {
  email?: string;
  name?: string;
  company?: string;
  phone?: string;
  marketplaceUserId?: string;
  uspUserId?: string;
}

export type EventKind =
  | 'communication'
  | 'signup'
  | 'rfq'
  | 'cart'
  | 'order'
  | 'service_request'
  | 'ticket'
  | 'contract_expiring'
  | 'behaviour';

/** Every source is mapped onto this one shape before identity matching and record mapping. */
export interface NormalizedEvent {
  source: Source;
  type: string;
  externalId: string;
  occurredAt: string;
  kind: EventKind;
  communication?: {
    channel: 'email' | 'meeting' | 'call' | 'chat';
    subject?: string;
    body: string;
    threadId?: string;
    mailbox?: string;
    private?: boolean;
    /** Teams: internal-only chats are excluded unless someone tags a record. */
    internalOnly?: boolean;
    participants: Participant[];
  };
  customer?: CustomerRef;
  data: Record<string, unknown>;
}
