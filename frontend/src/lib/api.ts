// Thin fetch wrapper: bearer token, correlation-aware errors, idempotency keys for creates.

export class ApiError extends Error {
  status: number;
  code: string;
  errors: Record<string, string[]>;
  correlationId?: string;
  constructor(status: number, body: any) {
    super(body?.message ?? `Request failed (${status})`);
    this.status = status;
    this.code = body?.code ?? "error";
    this.errors = body?.errors ?? {};
    this.correlationId = body?.correlationId;
  }
}

const TOKEN_KEY = "upm.token";

export const auth = {
  get token(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set token(v: string | null) {
    try {
      if (v) localStorage.setItem(TOKEN_KEY, v);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* storage unavailable */
    }
  },
};

export function newKey(): string {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

type Opts = { method?: string; body?: unknown; idempotencyKey?: string; headers?: Record<string, string> };

export async function api<T = any>(path: string, opts: Opts = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json", "X-Source": "web", ...(opts.headers ?? {}) };
  if (auth.token) headers.Authorization = `Bearer ${auth.token}`;
  if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
  let body: BodyInit | undefined;
  if (opts.body instanceof FormData) body = opts.body;
  else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(`/api/v1${path}`, { method: opts.method ?? (body ? "POST" : "GET"), headers, body });
  if (res.status === 401 && !path.startsWith("/auth")) {
    auth.token = null;
    if (!location.pathname.startsWith("/login")) location.assign("/login");
  }
  const type = res.headers.get("content-type") ?? "";
  const data = type.includes("json") ? await res.json() : await res.text();
  if (!res.ok) throw new ApiError(res.status, data);
  return data as T;
}

export const post = <T = any>(path: string, body?: unknown, idempotencyKey?: string) =>
  api<T>(path, { method: "POST", body: body ?? {}, idempotencyKey });
export const patch = <T = any>(path: string, body: unknown) => api<T>(path, { method: "PATCH", body });
export const put = <T = any>(path: string, body: unknown) => api<T>(path, { method: "PUT", body });
export const del = <T = any>(path: string) => api<T>(path, { method: "DELETE" });

export async function download(path: string, filename: string) {
  const res = await fetch(`/api/v1${path}`, { headers: { Authorization: `Bearer ${auth.token}` } });
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => ({})));
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
