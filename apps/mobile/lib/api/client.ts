/** HTTP-клиент Renova API */
export class ApiError extends Error {
  status: number;
  code?: string;
  detail?: unknown;
  constructor(status: number, message: string, code?: string, detail?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

export function isRateLimitError(e: unknown): boolean {
  return e instanceof ApiError && (e.code === 'rate_limit' || e.status === 429);
}

function parseApiErrorBody(txt: string, status: number): { message: string; code?: string; detail?: unknown } {
  let code: string | undefined;
  let detail: unknown;
  try {
    const j = JSON.parse(txt) as { detail?: unknown; code?: string; message?: string };
    detail = j.detail;
    if (typeof j.detail === 'string') {
      code = j.detail;
    } else if (typeof j.detail === 'object' && j.detail && 'code' in (j.detail as object)) {
      code = (j.detail as { code?: string }).code;
    } else if (typeof j.code === 'string') {
      code = j.code;
    }
  } catch {
    /* plain text body */
  }
  if (code === 'rate_limit' || status === 429) {
    return { message: 'Слишком много запросов. Подождите несколько секунд и повторите.', code: 'rate_limit', detail };
  }
  return { message: txt || `HTTP ${status}`, code, detail };
}

const OFFLINE_ROOMS = "renova_cache_rooms";
const OFFLINE_STAGES = "renova_cache_stages";
const _cache = new Map<string, { t: number; v: unknown }>();
const CACHE_TTL = 30_000;

export async function cachedGet<T>(path: string, userId?: string): Promise<T> {
  const k = `${userId || ''}:${path}`;
  const hit = _cache.get(k);
  if (hit && Date.now() - hit.t < CACHE_TTL) return hit.v as T;
  const v = await req<T>(path, {}, userId);
  _cache.set(k, { t: Date.now(), v });
  return v;
}

export const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://127.0.0.1:8100';

export async function req<T>(path: string, opts: RequestInit = {}, userId?: string): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(opts.headers as object) };
  if (userId) headers['X-User-Id'] = userId;
  const res = await fetch(`${API_BASE}${path}`, { ...opts, headers });
  if (!res.ok) {
    const txt = await res.text();
    const parsed = parseApiErrorBody(txt, res.status);
    throw new ApiError(res.status, parsed.message, parsed.code, parsed.detail);
  }
  return res.json();
}

export { OFFLINE_ROOMS, OFFLINE_STAGES };
