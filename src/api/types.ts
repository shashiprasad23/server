export type QuoteStatus =
  | 'Draft'
  | 'PendingApproval'
  | 'Approved'
  | 'Sent'
  | 'Accepted'
  | 'Rejected'
  | 'Expired'
  | 'Cancelled'
  | 'Converted';

export type ServerConfiguration = {
  model: string;
  cpu?: string;
  motherboard?: string;
  gpu?: { model: string; count: number };
  ramGb?: number;
  storageTb?: number;
  nic?: string;
  psu?: string;
};

export interface CustomerInput {
  companyName?: string;
  contactName?: string;
  email?: string;
  phone?: string;
}

export interface QuoteItemInput {
  sku: string;
  quantity: number;
  configuration?: ServerConfiguration;
  description?: string;
}

export interface CreateQuoteInput {
  customer: CustomerInput;
  inquiryType?: 'product' | 'general';
  items?: QuoteItemInput[];
  discountCode?: string;
  manualDiscountPercent?: number;
  currency?: string;
  shipping?: { destination: string; method: string };
  customSpec?: string;
  notes?: string;
}

export interface QuoteLine {
  lineId: string;
  sku: string;
  name: string;
  description: string;
  type: 'product' | 'service' | 'lease';
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  taxable: boolean;
  configuration?: ServerConfiguration;
  specVersion?: number;
  leadTimeDays: number;
  availability: {
    status: 'available' | 'constrained' | 'unavailable';
    message?: string;
    alternatives?: string[];
  };
  recurring?: { period: 'month'; termMonths: number; deposit: number; recurringTotal: number };
}

export interface Quote {
  id: string;
  number: string;
  status: QuoteStatus;
  revision: number;
  version: number;
  currency: string;
  inquiryType: 'product' | 'general';
  customer: {
    id: string;
    companyId: string;
    companyName?: string;
    contactName?: string;
    email: string;
    phone?: string;
    guest: boolean;
    guestReference?: string;
  };
  items: QuoteLine[];
  discount: { code?: string; percent: number; amount: number } | null;
  subtotal: number;
  discountTotal: number;
  taxableBase: number;
  taxTotal: number;
  shippingTotal: number;
  grandTotal: number;
  shipping?: { destination: string; method: string };
  terms: {
    paymentTerms: string;
    deliveryEstimate: string;
    warranty: string;
    validUntil: string;
    exclusions: string;
  };
  approval: {
    required: boolean;
    reasons: string[];
    approvals: { role: string; by: string; at: string }[];
    rejectionReason?: string;
  };
  review?: { technical: boolean; commercial: boolean };
  customSpec?: string;
  notes?: string;
  priceLock: { priceListVersion: number; lockedUntil: string };
  acceptedAt?: string;
  acceptedRevision?: number;
  cancellationReason?: string;
  shareToken?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConfigValidation {
  valid: boolean;
  errors: { field: string; message: string }[];
  adjustments: { component: string; from?: string; to: string; reason: string }[];
  alternatives: string[];
}

export interface AuditEntry {
  action: string;
  actor: string;
  at: string;
  details?: Record<string, unknown>;
}

export interface EmailRecord {
  id: string;
  to: string[];
  status: 'queued' | 'sent' | 'failed';
  revision: number;
  type: 'send' | 'resend';
  error?: string;
  at: string;
}
