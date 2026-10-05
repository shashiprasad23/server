export type Json = Record<string, any>;

let token = '';
try {
  token = sessionStorage.getItem('atlas.token') ?? '';
} catch {
  /* storage unavailable */
}

export function setToken(t: string) {
  token = t;
  try {
    if (t) sessionStorage.setItem('atlas.token', t);
    else sessionStorage.removeItem('atlas.token');
  } catch {
    /* storage unavailable */
  }
}
export const hasToken = () => !!token;

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: unknown) {
    super(message);
  }
}

export async function api<T = any>(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...init.headers },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  if (!res.ok) {
    if (res.status === 401) setToken('');
    throw new ApiError(res.status, json?.error?.code ?? 'error', json?.error?.message ?? res.statusText, json?.error?.details);
  }
  return json as T;
}

/** Opens an authenticated HTML document (e.g. a proposal) in a new tab. */
export async function openHtml(path: string) {
  const res = await fetch(path, { headers: { authorization: `Bearer ${token}` } });
  const html = await res.text();
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  window.open(url, '_blank', 'noopener');
}

export const money = (v: unknown, currency = 'USD') =>
  v == null || v === '' ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(Number(v));

export const compactMoney = (v: unknown) =>
  v == null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 }).format(Number(v));

export const when = (v: unknown) => (v ? new Date(String(v)).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—');
export const date = (v: unknown) => (v ? new Date(String(v)).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '—');
export const ago = (v: unknown) => {
  if (!v) return '—';
  const s = Math.round((Date.now() - new Date(String(v)).getTime()) / 1000);
  if (s < 60) return `${Math.max(0, s)}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};
export const label = (s: unknown) => String(s ?? '').replace(/_/g, ' ');
