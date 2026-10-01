/** HTTP-клиент Renova API */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { evaluateApiBaseGuard } from '@/lib/apiBaseGuard';
import { isAuthoritativeRefreshRejection, shouldFallbackToDurableCache } from './failurePolicy';
import { validationMessage, isHumanMessage } from './validationMessage';
import { completionGateMessage } from '@/lib/domain/completionGate';
import { currentSessionUserId, getSessionStamp } from '@/lib/domain/sessionAuthority';
import type { SessionStamp } from '@/lib/domain/sessionFence';

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

/** Duck-typing: `instanceof ApiError` ломается при HMR/дублях бандла */
export function isRateLimitError(e: unknown): boolean {
  if (e == null || typeof e !== 'object') return false;
  const err = e as { code?: unknown; status?: unknown; message?: unknown };
  if (err.code === 'rate_limit' || err.status === 429) return true;
  if (typeof err.message === 'string') {
    const m = err.message.toLowerCase();
    if (m === 'rate_limit' || m.includes('слишком много запросов')) return true;
  }
  return e instanceof ApiError && (e.code === 'rate_limit' || e.status === 429);
}

export function parseApiErrorBody(txt: string, status: number): { message: string; code?: string; detail?: unknown } {
  let code: string | undefined;
  let detail: unknown;
  try {
    const j = JSON.parse(txt) as { detail?: unknown; code?: string; message?: string };
    detail = j.detail;
    if (typeof j.detail === 'string') {
      if (j.detail === 'rate_limit' || status === 429) {
        return {
          message: 'Слишком много запросов. Подождите несколько секунд и повторите.',
          code: 'rate_limit',
          detail,
        };
      }
      return { message: j.detail, code: j.detail, detail };
    }
    if (typeof j.message === 'string' && j.message) {
      return { message: j.message, code: j.code, detail };
    }
    if (Array.isArray(j.detail)) {
      // FastAPI 422: detail — массив ошибок полей, а не строка.
      const human = validationMessage(j.detail);
      if (human) return { message: human, code: 'validation_error', detail };
    } else if (typeof j.detail === 'object' && j.detail) {
      const d = j.detail as { code?: string; message?: string };
      // STG-011: 409/422 completion_gate — список невыполненных условий, а не «Ошибка сервера».
      const gate = completionGateMessage(j.detail);
      if (gate) return { message: gate, code: 'completion_gate', detail };
      if (typeof d.message === 'string' && d.message) {
        return { message: d.message, code: d.code || j.code, detail };
      }
      if (typeof d.code === 'string') code = d.code;
    } else if (typeof j.code === 'string') {
      code = j.code;
    }
  } catch {
    /* plain text body */
  }
  if (code === 'rate_limit' || status === 429) {
    return { message: 'Слишком много запросов. Подождите несколько секунд и повторите.', code: 'rate_limit', detail };
  }
  const fallback = isHumanMessage(txt) ? txt.trim() : `Ошибка сервера (HTTP ${status}). Попробуйте позже.`;
  return { message: fallback, code, detail };
}

const OFFLINE_ROOMS = 'renova_cache_rooms';
const OFFLINE_STAGES = 'renova_cache_stages';
const OFFLINE_GET_PREFIX = 'renova_cache_get:';
const _cache = new Map<string, { t: number; v: unknown }>();
/**
 * Эпоха записи: растёт после каждой успешной мутации. GET, начатый до мутации и
 * завершившийся после неё, несёт устаревшие данные — в TTL-кэш он не пишется (CMP-004).
 */
let _mutationEpoch = 0;
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
  return shouldFallbackToDurableCache(error);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function retryAfterMs(res: Response): number {
  const raw = res.headers.get('Retry-After');
  if (!raw) return 1200;
  const sec = Number(raw);
  if (Number.isFinite(sec) && sec >= 0) return Math.min(8000, Math.max(400, sec * 1000));
  return 1200;
}

/**
 * Общий gate для периодического опроса (#432): раньше 429 останавливал только
 * тот запрос, который его получил — независимые таймеры (inbox poll, WS
 * reconnect-triggered reload и т.п.) продолжали тикать по своему расписанию,
 * так что состояние «rate limited» никогда не проходило и баннер «данные
 * устарели» не сходил с экрана. Теперь любой 429 от любого запроса поднимает
 * общую паузу с экспоненциальным ростом при повторных попаданиях подряд;
 * периодические опросчики обязаны проверять `isPollingPaused()` перед тем,
 * как выполнить очередной тик.
 */
const RATE_LIMIT_BASE_PAUSE_MS = 3_000;
const RATE_LIMIT_MAX_PAUSE_MS = 60_000;
/** Повторное попадание позже этого окна после конца паузы считается новой серией, а не продолжением старой. */
const RATE_LIMIT_STREAK_WINDOW_MS = 5_000;
let _rateLimitPauseMs = 0;
let _rateLimitPausedUntil = 0;

function registerRateLimitHit(hintMs?: number): void {
  const now = Date.now();
  const withinStreak = now < _rateLimitPausedUntil + RATE_LIMIT_STREAK_WINDOW_MS;
  _rateLimitPauseMs = withinStreak && _rateLimitPauseMs > 0
    ? Math.min(RATE_LIMIT_MAX_PAUSE_MS, _rateLimitPauseMs * 2)
    : RATE_LIMIT_BASE_PAUSE_MS;
  const wait = Math.max(_rateLimitPauseMs, hintMs || 0);
  _rateLimitPausedUntil = Math.max(_rateLimitPausedUntil, now + wait);
}

function registerRateLimitRecovered(): void {
  _rateLimitPauseMs = 0;
  _rateLimitPausedUntil = 0;
}

/** Приостановлен ли сейчас периодический опрос общим 429-gate. */
export function isPollingPaused(): boolean {
  return Date.now() < _rateLimitPausedUntil;
}

/** Сколько ещё ждать до конца текущей паузы (0, если пауза не активна). */
export function pollingResumesInMs(): number {
  return Math.max(0, _rateLimitPausedUntil - Date.now());
}

async function saveDurableCache<T>(path: string, userId: string | undefined, value: T) {
  try {
    await AsyncStorage.setItem(storageKey(path, userId), JSON.stringify({ t: Date.now(), v: value }));
  } catch {
    /* silent-catch-ok: cache persistence is best-effort; network response stays authoritative */
  }
}

async function readDurableCache<T>(path: string, userId?: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(path, userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { t?: number; v?: T };
    if (!parsed.t || Date.now() - parsed.t > DURABLE_CACHE_TTL) return null;
    return parsed.v ?? null;
  } catch {
    /* silent-catch-ok: unreadable cache is a cache miss; request/error remains authoritative */
    return null;
  }
}

/** Путь без `userId:`-префикса ключа кэша. */
function pathOfCacheKey(k: string): string {
  const i = k.indexOf(':/');
  return i >= 0 ? k.slice(i + 1) : k;
}

function userOfCacheKey(k: string): string {
  const i = k.indexOf(':/');
  return i >= 0 ? k.slice(0, i) : '';
}

const PROJECT_PATH_RE = /^\/api\/v1\/projects\/([^/?#]+)/;

/** Какие закэшированные GET делает неактуальными успешная мутация по `mutationPath`. */
function isAffectedByMutation(cachedPath: string, mutationPath: string): boolean {
  const mp = PROJECT_PATH_RE.exec(mutationPath);
  if (!mp) return true; // вне проекта — последствия неизвестны, сбрасываем всё пользователя
  const prefix = `/api/v1/projects/${mp[1]}`;
  if (cachedPath === prefix || cachedPath.startsWith(`${prefix}/`) || cachedPath.startsWith(`${prefix}?`)) return true;
  // Сопутствующие списки проектов (прогресс, статусы, счётчики).
  if (cachedPath === '/api/v1/projects' || cachedPath.startsWith('/api/v1/projects?')) return true;
  return false;
}

function mutationMatchesCacheUser(cacheUser: string, userId?: string): boolean {
  return !userId || cacheUser === userId;
}

/**
 * После УСПЕШНОЙ мутации сбрасывает закэшированные GET того же проекта и списки
 * проектов (память + durable), а также «летящие» GET — иначе экран читает
 * устаревшие данные до 30 с (CMP-004). Вызывается из `req` и из реплея офлайн-очереди.
 */
export async function invalidateCachesAfterMutation(mutationPath: string, userId?: string): Promise<void> {
  _mutationEpoch += 1;
  for (const k of [..._cache.keys()]) {
    if (mutationMatchesCacheUser(userOfCacheKey(k), userId) && isAffectedByMutation(pathOfCacheKey(k), mutationPath)) {
      _cache.delete(k);
    }
  }
  for (const k of [..._inFlightGets.keys()]) {
    if (mutationMatchesCacheUser(userOfCacheKey(k), userId) && isAffectedByMutation(pathOfCacheKey(k), mutationPath)) {
      _inFlightGets.delete(k);
    }
  }
  try {
    const keys = await AsyncStorage.getAllKeys();
    const stale = keys.filter((key) => {
      if (!key.startsWith(OFFLINE_GET_PREFIX)) return false;
      const ck = key.slice(OFFLINE_GET_PREFIX.length);
      return mutationMatchesCacheUser(userOfCacheKey(ck), userId) && isAffectedByMutation(pathOfCacheKey(ck), mutationPath);
    });
    if (stale.length) await AsyncStorage.multiRemove(stale);
  } catch {
    /* silent-catch-ok: durable invalidation is best-effort; in-memory cache is already cleared */
  }
}

/** Полная очистка GET-кэша (память + `renova_cache_get:*`, комнаты, этапы) — при выходе (CMP-016). */
export async function clearAllCachedGets(): Promise<void> {
  _mutationEpoch += 1;
  _cache.clear();
  _inFlightGets.clear();
  _cacheMeta.clear();
  try {
    const keys = await AsyncStorage.getAllKeys();
    const doomed = keys.filter(
      (key) => key.startsWith(OFFLINE_GET_PREFIX) || key.startsWith(OFFLINE_ROOMS) || key.startsWith(OFFLINE_STAGES),
    );
    if (doomed.length) await AsyncStorage.multiRemove(doomed);
  } catch {
    /* silent-catch-ok: best-effort privacy cleanup; the in-memory cache is already cleared */
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
      /* silent-catch-ok: invalidation is best-effort; in-memory cache is already cleared */
    }
  }
}

/**
 * Общий сброс TTL-кэша одного `cachedGet`-пути (#432). Нужен там, где список
 * теперь читается через `cachedGet` (change-orders, material-picks,
 * work-orders, warranty-claims, documents, issues, selections/pending-count):
 * без сброса мутация (create/approve/reject/...) могла бы до 30с показывать
 * список без только что созданной/изменённой записи.
 */
export async function invalidateCachedGet(path: string, userId?: string): Promise<void> {
  _cache.delete(cacheKey(path, userId));
  try {
    await AsyncStorage.removeItem(storageKey(path, userId));
  } catch {
    /* silent-catch-ok: invalidation is best-effort; in-memory cache is already cleared */
  }
}

/** P1.14: last cachedGet outcome — UI can show «данные могут быть устаревшими» */
export type CachedGetMeta = {
  path: string;
  fromCache: boolean;
  stale: boolean;
  cachedAt?: number;
  errorStatus?: number;
};
/**
 * Провенанс на каждый путь, а не одна «последняя» переменная (#317).
 *
 * Приложение поднимает десятки запросов одновременно; общая переменная
 * означала бы, что свежий ответ по одному пути стирает отметку устаревания
 * по другому — и экран с устаревшими данными выглядел бы свежим.
 */
const _cacheMeta = new Map<string, CachedGetMeta>();

function rememberCacheMeta(meta: CachedGetMeta): void {
  _cacheMeta.set(meta.path, meta);
}

/** Пути, отданные из кэша после сбоя. Пусто — ничего устаревшего не показано. */
export function getStaleCachePaths(): string[] {
  const stale: string[] = [];
  for (const meta of _cacheMeta.values()) if (meta.stale) stale.push(meta.path);
  return stale;
}

/** Сколько путей сейчас показывают устаревшее — для баннера. */
export function getCacheMetaFor(path: string): CachedGetMeta | null {
  return _cacheMeta.get(path) ?? null;
}

export async function cachedGet<T>(path: string, userId?: string): Promise<T> {
  const k = cacheKey(path, userId);
  const hit = _cache.get(k);
  if (hit && Date.now() - hit.t < CACHE_TTL) {
    rememberCacheMeta({ path, fromCache: true, stale: false, cachedAt: hit.t });
    return hit.v as T;
  }
  try {
    // Провенанс едет вместе с запросом: `req` мог отдать значение из
    // долговременного кэша, и выдавать его за свежий ответ нельзя.
    const provenance: CacheProvenance = { servedFromDurableCache: false };
    const epochAtStart = _mutationEpoch;
    const v = await req<T>(path, { provenance }, userId);
    if (provenance.servedFromDurableCache) {
      // Ни возраст, ни запись в кэш не обновляем: значение старое, и следующий
      // вызов обязан снова пойти в сеть, а не жить с подновлённой меткой.
      rememberCacheMeta({ path, fromCache: true, stale: true, cachedAt: hit?.t });
      return v;
    }
    const now = Date.now();
    // Мутация завершилась, пока шёл этот GET: ответ мог быть снят до неё — не кэшируем.
    if (epochAtStart === _mutationEpoch) {
      _cache.set(k, { t: now, v });
      await saveDurableCache(path, userId, v);
    }
    rememberCacheMeta({ path, fromCache: false, stale: false, cachedAt: now });
    return v;
  } catch (error) {
    if (canFallbackToCache(error)) {
      const fallback = await readDurableCache<T>(path, userId);
      if (fallback !== null) {
        const status = error instanceof ApiError ? error.status : undefined;
        try {
          const { reportError } = await import('@/lib/reportError');
          reportError('api.cachedGet.staleFallback', error, { path, status });
        } catch {
          /* silent-catch-ok: telemetry must never prevent a valid stale-cache fallback */
        }
        _cache.set(k, { t: Date.now(), v: fallback });
        rememberCacheMeta({
          path,
          fromCache: true,
          stale: true,
          cachedAt: Date.now(),
          errorStatus: status,
        });
        return fallback;
      }
    }
    rememberCacheMeta({ path, fromCache: false, stale: false });
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

/** In-memory JWT (persisted via RenovaContext / AsyncStorage). */
let _accessToken: string | null = null;

export function setAccessToken(token: string | null) {
  _accessToken = token && token.trim() ? token.trim() : null;
}

export function getAccessToken(): string | null {
  return _accessToken;
}

let _refreshToken: string | null = null;
let _refreshInflight: Promise<boolean> | null = null;

/**
 * Мост клиента с владельцем сессии (RenovaContext), который знает про SecureStore
 * и экран входа. Клиент живёт вне React-дерева, поэтому связь — через колбэки.
 */
export type SessionHooks = {
  /** Ротация refresh: новые токены надо сохранить (CMP-002). `stamp` — сессия, которой они принадлежат. */
  onTokensRotated?: (tokens: { access: string; refresh: string | null }, stamp: SessionStamp) => void | Promise<void>;
  /** Окончательный отказ авторизации (CMP-003): сессию надо закончить и показать вход. */
  onSessionExpired?: (stamp: SessionStamp) => void | Promise<void>;
};
let _sessionHooks: SessionHooks = {};
/** Возвращает функцию отмены регистрации (снимает только свои хуки). */
export function setSessionHooks(hooks: SessionHooks): () => void {
  _sessionHooks = hooks;
  return () => {
    if (_sessionHooks === hooks) _sessionHooks = {};
  };
}

async function reportHookFailure(scope: string, error: unknown): Promise<void> {
  try {
    const { reportError } = await import('@/lib/reportError');
    reportError(scope, error);
  } catch {
    /* silent-catch-ok: telemetry must never break the auth flow */
  }
}

/** Одно уведомление об окончании сессии на поколение — параллельные 401 не плодят выходы. */
let _expiredNotifiedGeneration = -1;
async function notifySessionExpired(stamp: SessionStamp): Promise<void> {
  if (getSessionStamp().generation !== stamp.generation) return;
  if (_expiredNotifiedGeneration === stamp.generation) return;
  _expiredNotifiedGeneration = stamp.generation;
  try {
    await _sessionHooks.onSessionExpired?.(stamp);
  } catch (error) {
    await reportHookFailure('api.client.sessionExpiredHook', error);
  }
}

export function setRefreshToken(token: string | null) {
  _refreshToken = token && token.trim() ? token.trim() : null;
}

export function getRefreshToken(): string | null {
  return _refreshToken;
}

/**
 * Rotate refresh → new access.
 * Returns false only when the server authoritatively rejects the session.
 * Transient/network/server failures throw and preserve both tokens for retry.
 */
export async function refreshAccessToken(): Promise<boolean> {
  if (!_refreshToken) return false;
  if (_refreshInflight) return _refreshInflight;
  // #315: метка берётся один раз, до await. Если за время сетевого запроса
  // человек вышел и вошёл под другим аккаунтом (или тем же — новое
  // поколение), ответ этой устаревшей сессии не должен ни опубликовать
  // токены новой сессии, ни стереть их авторитетным отказом старой.
  const stampAtStart = getSessionStamp();
  _refreshInflight = (async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: _refreshToken }),
      });
      const txt = await res.text();
      if (!res.ok) {
        const parsed = parseApiErrorBody(txt, res.status);
        if (isAuthoritativeRefreshRejection(res.status)) {
          if (getSessionStamp().generation === stampAtStart.generation) {
            setAccessToken(null);
            setRefreshToken(null);
            await notifySessionExpired(stampAtStart);
          }
          return false;
        }
        throw new ApiError(res.status, parsed.message, parsed.code, parsed.detail);
      }

      let data: { access_token?: unknown; refresh_token?: unknown };
      try {
        data = txt ? JSON.parse(txt) as { access_token?: unknown; refresh_token?: unknown } : {};
      } catch (error) {
        throw new ApiError(502, 'Сервер вернул некорректный ответ обновления сессии.', 'invalid_refresh_response', error);
      }

      const nextAccess = typeof data.access_token === 'string' ? data.access_token.trim() : '';
      if (!nextAccess) {
        throw new ApiError(502, 'Сервер не вернул новый токен доступа.', 'invalid_refresh_response', data);
      }

      if (getSessionStamp().generation !== stampAtStart.generation) {
        // Сессия сменилась, пока ждали ответ: старая generation не публикует
        // токены поверх новой. Для вызывающего это выглядит как отказ
        // обновления в рамках сессии, с которой он начал операцию.
        return false;
      }
      setAccessToken(nextAccess);

      const nextRefresh = typeof data.refresh_token === 'string' ? data.refresh_token.trim() : '';
      if (nextRefresh) setRefreshToken(nextRefresh);
      // CMP-002: сервер отзывает прежний refresh при ротации — без записи в SecureStore
      // холодный старт пошёл бы со старым токеном и разлогинил бы пользователя.
      try {
        await _sessionHooks.onTokensRotated?.({ access: nextAccess, refresh: nextRefresh || null }, stampAtStart);
      } catch (error) {
        await reportHookFailure('api.client.tokensRotatedHook', error);
      }
      return true;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error instanceof TypeError || (error instanceof Error && /fetch|network|failed/i.test(error.message))) {
        throw new ApiError(0, 'Сервер временно недоступен. Проверьте соединение и повторите.', 'network');
      }
      throw error;
    } finally {
      _refreshInflight = null;
    }
  })();
  return _refreshInflight;
}

/**
 * Портал-гость (CMP-009/017): JWT из /auth/portal/session — не сессия пользователя и
 * не должен подменять глобальный Bearer. Он привязан к user_id ссылки и подкладывается
 * только запросам с этим `userId`, пока открыт экран портала. Реальная сессия того же
 * пользователя имеет приоритет.
 */
const _portalBearers = new Map<string, string>();

export function registerPortalBearer(portalUserId: string, token: string): () => void {
  const t = token.trim();
  if (!portalUserId || !t) return () => undefined;
  _portalBearers.set(portalUserId, t);
  return () => {
    if (_portalBearers.get(portalUserId) === t) _portalBearers.delete(portalUserId);
  };
}

function portalBearerFor(userId?: string | null): string | null {
  if (!userId) return null;
  if (_accessToken && userId === currentSessionUserId()) return null;
  return _portalBearers.get(userId) ?? null;
}

/** Auth headers for fetch outside `req` (PDF, CSV, offline queue). */
export function authHeaders(userId?: string | null): Record<string, string> {
  const h: Record<string, string> = {};
  const portal = portalBearerFor(userId);
  if (portal) {
    h.Authorization = `Bearer ${portal}`;
    return h;
  }
  if (_accessToken) {
    // #315: `_accessToken` — один общий глобальный Bearer. Запрос с явным
    // `userId`, который не совпадает с активной сессией (устаревшее задание
    // офлайн-очереди, запоздалый вызов экрана после переключения аккаунта),
    // не должен уходить с чужим токеном. Явный `userId` без активной сессии
    // (уже вышли) — тоже отказ: публиковать нечему.
    if (userId != null && userId !== currentSessionUserId()) {
      return h;
    }
    h.Authorization = `Bearer ${_accessToken}`;
    return h;
  }
  const env = (process.env.EXPO_PUBLIC_APP_ENV || process.env.APP_ENV || 'development').toLowerCase();
  const allowHeader = env === 'development' || env === 'test';
  if (userId && allowHeader) h['X-User-Id'] = userId;
  return h;
}

const REQUEST_TIMEOUT_MS = 20_000;

/** Откуда пришло значение: сеть или долговременный кэш после сбоя (#317). */
export type CacheProvenance = { servedFromDurableCache: boolean };

export type ReqOptions = RequestInit & {
  /** Заполняется `req`, если ответ подменён значением из кэша. */
  provenance?: CacheProvenance;
  /** Disable durable cache when absence itself controls a write action. */
  cacheFallback?: boolean;
};

/**
 * In-flight GET dedupe (#329): a single Home render issues ~200 requests, and
 * the same URL repeats up to a dozen times in one burst as independent
 * widgets ask for the same resource at the same moment. Collapsing identical
 * *in-flight* GETs into one network call costs nothing in freshness — every
 * caller would have received the same response anyway — unlike the TTL
 * cache in `cachedGet`, which would risk serving stale data after a write.
 * Mutating methods are never merged: two POSTs are two distinct intents and
 * must both reach the server (idempotency there is handled by
 * `client_request_id`, not by collapsing the calls).
 */
type InFlightGet = { promise: Promise<unknown>; controller: AbortController; subscribers: number };
const _inFlightGets = new Map<string, InFlightGet>();

/** Number of GETs currently merged and waiting on the network — test hook. */
export function inFlightGetCount(): number {
  return _inFlightGets.size;
}

function inFlightKey(path: string, userId?: string): string {
  return `${userId || ''}:${path}`;
}

/** Ошибку получают сами ждущие; здесь лишь помечаем промис обработанным, чтобы отмена всех не давала unhandled rejection. */
function settledForSubscribers(_error: unknown): void {
  /* handled by each subscriber */
}

function abortError(): Error {
  const e = new Error('Aborted');
  e.name = 'AbortError';
  return e;
}

/**
 * CMP-024: общий сетевой запрос живёт на собственном AbortController. Отмена
 * `signal` одного вызывателя отклоняет только его промис; сеть обрывается лишь когда
 * отменили все, кто ждёт этот запрос. Вызыватель без `signal` держит запрос навсегда.
 */
function subscribeToInFlight<T>(entry: InFlightGet, signal?: AbortSignal | null): Promise<T> {
  entry.subscribers += 1;
  if (!signal) return entry.promise as Promise<T>;
  return new Promise<T>((resolve, reject) => {
    let done = false;
    const release = () => {
      entry.subscribers -= 1;
      if (entry.subscribers <= 0) entry.controller.abort();
    };
    const onAbort = () => {
      if (done) return;
      done = true;
      release();
      reject(abortError());
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
    (entry.promise as Promise<T>).then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        if (!done) { done = true; resolve(v); }
      },
      (e) => {
        signal.removeEventListener('abort', onAbort);
        if (!done) { done = true; reject(e); }
      },
    );
  });
}

export async function req<T>(path: string, opts: ReqOptions = {}, userId?: string): Promise<T> {
  if (!canUseDurableCache(opts)) {
    const result = await performReq<T>(path, opts, userId);
    // CMP-004: мутация прошла — закэшированные GET того же проекта устарели.
    await invalidateCachesAfterMutation(path, userId);
    return result;
  }

  const key = inFlightKey(path, userId);
  const existing = _inFlightGets.get(key);
  if (existing) return subscribeToInFlight<T>(existing, opts.signal);

  const { signal: callerSignal, ...rest } = opts;
  const controller = new AbortController();
  const promise: Promise<unknown> = performReq<T>(path, { ...rest, signal: controller.signal }, userId).finally(() => {
    // Мутация могла вытеснить запись и завести новую под тем же ключом — чужую не трогаем.
    if (_inFlightGets.get(key)?.promise === promise) _inFlightGets.delete(key);
  });
  promise.catch(settledForSubscribers);
  const entry: InFlightGet = { promise, controller, subscribers: 0 };
  _inFlightGets.set(key, entry);
  return subscribeToInFlight<T>(entry, callerSignal);
}

async function performReq<T>(path: string, opts: ReqOptions = {}, userId?: string): Promise<T> {
  const { cacheFallback = true, provenance, ...fetchOpts } = opts;
  const isFormData = typeof FormData !== 'undefined' && fetchOpts.body instanceof FormData;
  const headers: Record<string, string> = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...(fetchOpts.headers as object),
  };
  Object.assign(headers, authHeaders(userId));
  if (isFormData) delete headers['Content-Type'];

  const isGet = canUseDurableCache(fetchOpts);
  let attempt = 0;
  let lastError: unknown;
  // Портальный Bearer гостя не обновляется через refresh сессии (его там нет), а отказ
  // по нему не означает конец сессии пользователя.
  const usesPortalBearer = portalBearerFor(userId) !== null;
  const stampAtRequest = getSessionStamp();
  let refreshedInThisRequest = false;

  try {
    while (attempt < 3) {
      attempt += 1;
      const controller = new AbortController();
      let externallyAborted = Boolean(fetchOpts.signal?.aborted);
      const onExternalAbort = () => {
        externallyAborted = true;
        controller.abort();
      };
      if (fetchOpts.signal && !fetchOpts.signal.aborted) {
        fetchOpts.signal.addEventListener('abort', onExternalAbort, { once: true });
      }
      if (externallyAborted) controller.abort();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const res = await fetch(`${API_BASE}${path}`, {
          ...fetchOpts,
          headers,
          signal: controller.signal,
        });
        if (!res.ok) {
          const txt = await res.text();
          const parsed = parseApiErrorBody(txt, res.status);
          const err = new ApiError(res.status, parsed.message, parsed.code, parsed.detail);
          if (res.status === 401 && attempt < 2 && !usesPortalBearer && !path.includes('/auth/refresh') && getRefreshToken()) {
            const ok = await refreshAccessToken();
            if (ok) {
              Object.assign(headers, authHeaders(userId));
              lastError = err;
              refreshedInThisRequest = true;
              continue;
            }
          } else if (res.status === 401 && refreshedInThisRequest && headers.Authorization && !usesPortalBearer && !path.includes('/auth/')) {
            // CMP-003: 401 и после успешного refresh — сервер не принимает сессию.
            await notifySessionExpired(stampAtRequest);
          }
          if (isRateLimitError(err)) {
            // Общий gate (#432): пауза поднимается для ЛЮБОГО 429, не только GET —
            // иначе независимые поллеры продолжают тикать, пока этот конкретный
            // запрос сам восстанавливается через retry.
            registerRateLimitHit(retryAfterMs(res));
            if (isGet && attempt < 3) {
              lastError = err;
              await sleep(retryAfterMs(res));
              continue;
            }
          }
          throw err;
        }
        const text = await res.text();
        const data = text ? JSON.parse(text) : undefined;
        if (isGet && data !== undefined) await saveDurableCache(path, userId, data);
        registerRateLimitRecovered();
        return data as T;
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          if (externallyAborted || fetchOpts.signal?.aborted) throw error;
          throw new ApiError(0, 'Сервер не ответил вовремя. Попробуйте ещё раз.', 'timeout');
        }
        if (error instanceof TypeError || (error instanceof Error && /fetch|network|failed/i.test(error.message))) {
          throw new ApiError(0, 'Сервер временно недоступен. Проверьте соединение и повторите.', 'network');
        }
        if (isGet && isRateLimitError(error) && attempt < 3) {
          lastError = error;
          await sleep(1200);
          continue;
        }
        throw error;
      } finally {
        clearTimeout(timeoutId);
        fetchOpts.signal?.removeEventListener('abort', onExternalAbort);
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new ApiError(429, 'Слишком много запросов. Подождите несколько секунд и повторите.', 'rate_limit');
  } catch (error) {
    if (isGet && cacheFallback && canFallbackToCache(error)) {
      const fallback = await readDurableCache<T>(path, userId);
      if (fallback !== null) {
        // Значение подменено кэшем: сообщаем вызывающему, иначе он выдаст
        // старые данные за свежий ответ (#317).
        if (provenance) provenance.servedFromDurableCache = true;
        return fallback;
      }
    }
    throw error;
  }
}

export { OFFLINE_ROOMS, OFFLINE_STAGES, OFFLINE_GET_PREFIX };