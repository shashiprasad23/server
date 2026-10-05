export type Json = Record<string, any>;

let token = sessionStorage.getItem('atlas.token') ?? '';

export function setToken(t: string) {
  token = t;
  if (t) sessionStorage.setItem('atlas.token', t);
  else sessionStorage.removeItem('atlas.token');
}
export const hasToken = () => !!token;

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: unknown) {
    super(message);
  }
}

export async function api<T = any>(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? (init.body ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...init.headers },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    if (res.status === 401) setToken('');
    throw new ApiError(res.status, json?.error?.code ?? 'error', json?.error?.message ?? res.statusText, json?.error?.details);
  }
  return json as T;
}

export const money = (v: unknown, currency = 'USD') =>
  v == null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(Number(v));

export const when = (v: unknown) => (v ? new Date(String(v)).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—');
