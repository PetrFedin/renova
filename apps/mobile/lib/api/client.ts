/** HTTP-клиент Renova API */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { evaluateApiBaseGuard } from '@/lib/apiBaseGuard';

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
      return { message: j.detail, code: j.detail, detail };
    }
    if (typeof j.message === 'string' && j.message) {
      return { message: j.message, code: j.code, detail };
    }
    if (typeof j.detail === 'object' && j.detail && 'code' in (j.detail as object)) {
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

const OFFLINE_ROOMS = 'renova_cache_rooms';
const OFFLINE_STAGES = 'renova_cache_stages';
const OFFLINE_GET_PREFIX = 'renova_cache_get:';
const _cache = new Map<string, { t: number; v: unknown }>();
const CACHE_TTL = 30_000;
const DURABLE_CACHE_TTL = 24 * 60 * 60 * 1000;

function cacheKey(path: string, userId?: string) {
  return `${userId || ''}:${path}`;
}

function storageKey(path: string, userId?: string) {
  return `${OFFLINE_GET_PREFIX}${cacheKey(path, userId)}`;
}

function canUseDurableCache(opts: RequestInit) {
  return !opts.method || opts.method === 'GET';
}

function canFallbackToCache(error: unknown) {
  if (!(error instanceof ApiError)) return true;
  return error.status >= 500;
}

async function saveDurableCache<T>(path: string, userId: string | undefined, value: T) {
  try {
    await AsyncStorage.setItem(storageKey(path, userId), JSON.stringify({ t: Date.now(), v: value }));
  } catch { /* cache is best-effort */ }
}

async function readDurableCache<T>(path: string, userId?: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(path, userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { t?: number; v?: T };
    if (!parsed.t || Date.now() - parsed.t > DURABLE_CACHE_TTL) return null;
    return parsed.v ?? null;
  } catch {
    return null;
  }
}

const PROJECT_LIST_PATHS = [
  '/api/v1/projects',
  '/api/v1/projects?bucket=active',
  '/api/v1/projects?bucket=archived',
  '/api/v1/projects?bucket=trashed',
] as const;

/** Сброс кэша списков проектов после archive/trash/restore — иначе UI до 30с показывает старые данные. */
export async function invalidateProjectsCache(userId: string): Promise<void> {
  for (const path of PROJECT_LIST_PATHS) {
    _cache.delete(cacheKey(path, userId));
    try {
      await AsyncStorage.removeItem(storageKey(path, userId));
    } catch {
      /* cache is best-effort */
    }
  }
}

export async function cachedGet<T>(path: string, userId?: string): Promise<T> {
  const k = cacheKey(path, userId);
  const hit = _cache.get(k);
  if (hit && Date.now() - hit.t < CACHE_TTL) return hit.v as T;
  try {
    const v = await req<T>(path, {}, userId);
    _cache.set(k, { t: Date.now(), v });
    await saveDurableCache(path, userId, v);
    return v;
  } catch (error) {
    if (canFallbackToCache(error)) {
      const fallback = await readDurableCache<T>(path, userId);
      if (fallback !== null) {
        _cache.set(k, { t: Date.now(), v: fallback });
        return fallback;
      }
    }
    throw error;
  }
}

const _apiGuard = evaluateApiBaseGuard(
  process.env.EXPO_PUBLIC_API_URL,
  process.env.EXPO_PUBLIC_APP_ENV ?? process.env.APP_ENV,
);
if (_apiGuard.warning && typeof __DEV__ !== 'undefined' && __DEV__) {
  console.warn(`[renova:api-base] ${_apiGuard.warning}`);
}
if (_apiGuard.blocked) {
  console.error(`[renova:api-base] BLOCKED: ${_apiGuard.warning}`);
}
export const API_BASE = _apiGuard.apiBase;
export const API_BASE_GUARD = _apiGuard;


const REQUEST_TIMEOUT_MS = 20_000;

export async function req<T>(path: string, opts: RequestInit = {}, userId?: string): Promise<T> {
  const isFormData = typeof FormData !== 'undefined' && opts.body instanceof FormData;
  const headers: Record<string, string> = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...(opts.headers as object),
  };
  if (userId) headers['X-User-Id'] = userId;
  // FormData must manage its own multipart boundary — drop forced JSON content-type
  if (isFormData) delete headers['Content-Type'];
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...opts,
      headers,
      signal: opts.signal ?? controller.signal,
    });
    if (!res.ok) {
      const txt = await res.text();
      const parsed = parseApiErrorBody(txt, res.status);
      throw new ApiError(res.status, parsed.message, parsed.code, parsed.detail);
    }
    const text = await res.text();
    const data = text ? JSON.parse(text) : undefined;
    if (canUseDurableCache(opts) && data !== undefined) await saveDurableCache(path, userId, data);
    return data as T;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ApiError(0, 'Сервер не отвечает. Проверьте, что backend запущен (npm run backend:dev).');
    }
    if (error instanceof TypeError || (error instanceof Error && /fetch|network|failed/i.test(error.message))) {
      throw new ApiError(0, 'Сервер недоступен. Запустите backend на порту 8100: cd renova && backend/.venv/bin/uvicorn app.main:app --reload --port 8100');
    }
    if (canUseDurableCache(opts) && canFallbackToCache(error)) {
      const fallback = await readDurableCache<T>(path, userId);
      if (fallback !== null) return fallback;
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export { OFFLINE_ROOMS, OFFLINE_STAGES, OFFLINE_GET_PREFIX };
