import { badRequest } from '../common/errors';

/**
 * FR-NS-02: ATLAS-I must never hold sales transaction details. Orders, invoices, payments,
 * credit memos, refunds and settlements live only in Oracle NetSuite; the CRM keeps reference IDs
 * and status flags. This guard rejects any attempt to store such data in core fields, custom
 * fields, field definitions or free-form JSON on CRM records.
 */
const FORBIDDEN_KEY_PATTERNS: RegExp[] = [
  /invoice(_|-)?(amount|total|number|no|lines?|items?)/i,
  /^invoices?$/i,
  /payment(_|-)?(amount|details?|method|reference|status_amount)/i,
  /^payments?$/i,
  /amount(_|-)?(paid|due|outstanding|invoiced|refunded|settled)/i,
  /(credit(_|-)?memo|refund(_|-)?amount|settlement(_|-)?amount)/i,
  /(order|so)(_|-)?lines?/i,
  /line(_|-)?items?/i,
  /card(_|-)?(number|no|pan|cvv|cvc|expiry)/i,
  /^(pan|cvv|cvc)$/i,
  /(bank(_|-)?account|iban|swift|bic|routing(_|-)?number|sort(_|-)?code)/i,
];

/** Allowed even though they contain sensitive-looking words: reference IDs and status flags. */
const ALLOWED_KEYS = new Set(['netsuite_sales_order_id', 'netsuite_status', 'netsuite_customer_id', 'order_reference']);

// 13-19 digit runs (optionally grouped by spaces or dashes) starting 2-6, passing Luhn, look like card numbers.
// Hex-adjacent digits (UUIDs, hashes) are excluded by the lookarounds.
const CARD_LIKE = /(?<![0-9A-Za-z-])[2-6](?:[ -]?\d){12,18}(?![0-9A-Za-z-])/g;
const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function luhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

export function isForbiddenKey(key: string): boolean {
  if (ALLOWED_KEYS.has(key)) return false;
  return FORBIDDEN_KEY_PATTERNS.some((p) => p.test(key));
}

export function containsCardNumber(text: string): boolean {
  if (UUID_LIKE.test(text)) return false;
  for (const m of text.matchAll(CARD_LIKE)) {
    const digits = m[0].replace(/[ -]/g, '');
    if (digits.length >= 13 && digits.length <= 19 && luhn(digits)) return true;
  }
  return false;
}

/** Walks a payload and returns the paths of every transaction-like key or card-like value. */
export function findTransactionData(value: unknown, path: string[] = []): string[] {
  const hits: string[] = [];
  if (Array.isArray(value)) {
    value.forEach((v, i) => hits.push(...findTransactionData(v, [...path, String(i)])));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (isForbiddenKey(k)) hits.push([...path, k].join('.'));
      hits.push(...findTransactionData(v, [...path, k]));
    }
  } else if (typeof value === 'string' && containsCardNumber(value)) {
    hits.push(path.join('.') || '(value)');
  }
  return hits;
}

export function assertNoTransactionData(value: unknown): void {
  const hits = findTransactionData(value);
  if (hits.length) {
    throw badRequest(
      'transaction_data_rejected',
      'Sales transaction details (orders, invoices, payments, settlement, card or bank data) belong in Oracle NetSuite, not the CRM',
      { fields: hits },
    );
  }
}

/** Captured communications are redacted rather than rejected: card-like numbers become a marker. */
export function redactCardNumbers(text: string): string {
  return text.replace(CARD_LIKE, (m) => {
    const digits = m.replace(/[ -]/g, '');
    return digits.length >= 13 && digits.length <= 19 && luhn(digits) ? '[redacted: payment card]' : m;
  });
}

/** For inbound integration payloads: drop transaction-like keys and redact card numbers before storing. */
export function stripTransactionData<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => stripTransactionData(v)) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (isForbiddenKey(k)) continue;
      out[k] = stripTransactionData(v);
    }
    return out as T;
  }
  if (typeof value === 'string') return redactCardNumbers(value) as T;
  return value;
}
