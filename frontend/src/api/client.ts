export class ApiError extends Error {
  status: number;
  detail: string;

  constructor(status: number, detail: string) {
    super(detail);
    this.status = status;
    this.detail = detail;
  }
}

function extractDetail(data: unknown): string {
  if (data && typeof data === "object" && "detail" in data) {
    const d = (data as Record<string, unknown>).detail;
    if (typeof d === "string") return d;
    if (Array.isArray(d)) {
      const first = d[0] as Record<string, unknown> | undefined;
      if (first && typeof first.msg === "string") return String(first.msg);
    }
  }
  return "خطای غیرمنتظره رخ داد.";
}

export async function api<T>(
  path: string,
  opts: { method?: string; body?: unknown; params?: Record<string, string | number | boolean | undefined> } = {}
): Promise<T> {
  let url = `/api${path}`;
  if (opts.params) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(opts.params)) {
      if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
    }
    const s = qs.toString();
    if (s) url += `?${s}`;
  }
  const res = await fetch(url, {
    method: opts.method ?? "GET",
    headers: opts.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    credentials: "same-origin",
  });
  if (res.status === 204) return undefined as T;
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    throw new ApiError(res.status, extractDetail(data));
  }
  return data as T;
}
