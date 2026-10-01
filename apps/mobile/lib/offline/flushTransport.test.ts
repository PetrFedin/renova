/**
 * Реплей офлайн-очереди: обновление токена (CMP-007), таймер повтора (CMP-015),
 * очистка очереди выходящего пользователя (CMP-016).
 */
import '@/lib/testing/asyncStorageMock';
process.env.EXPO_PUBLIC_API_URL ||= 'http://127.0.0.1:8100';

import { decideFlushOutcome } from './flushPolicy';
import { FLUSH_SCHEDULER_MIN_DELAY_MS, nextFlushDelayMs, startOfflineFlushScheduler } from './flushScheduler';

const must = (c: boolean, m: string) => {
  if (!c) throw new Error(m);
};
const tick = () => new Promise((r) => setTimeout(r, 0));
const json = (status: number, body: unknown) => ({
  ok: status < 400,
  status,
  text: async () => JSON.stringify(body),
  headers: { get: (_k: string) => null },
});

async function main() {
  // --- политика: 401 больше не постоянная ошибка ---
  const d401 = decideFlushOutcome(401, 'expired', 0, 1_000);
  must(d401.action === 'retry', `401 must be retried with backoff, got ${d401.action}`);
  must(decideFlushOutcome(403, 'x', 0, 1_000).action === 'block', '403 stays permanent');
  must(decideFlushOutcome(422, 'x', 0, 1_000).action === 'block', '422 stays permanent');

  const client = await import('@/lib/api/client');
  const authority = await import('@/lib/domain/sessionAuthority');
  const queue = await import('@/lib/offlineQueue');
  const { resetMemoryStorage } = await import('@/lib/testing/asyncStorageMock');
  const sent: { url: string; auth?: string; body?: string; offlineId?: string }[] = [];
  let tokenValid = 'a2';
  (globalThis as any).fetch = async (url: string, init: any) => {
    const u = String(url);
    if (u.endsWith('/auth/refresh')) return json(200, { access_token: 'a2', refresh_token: 'r2' });
    sent.push({ url: u, auth: init.headers?.Authorization, body: init.body, offlineId: init.headers?.['X-Offline-Id'] });
    return init.headers?.Authorization === `Bearer ${tokenValid}` ? json(200, { ok: true }) : json(401, { detail: 'expired' });
  };

  // --- CMP-007: 401 на реплее -> один refresh и повтор ТОГО ЖЕ задания ---
  resetMemoryStorage();
  authority.beginSessionAuthority('u1');
  client.setAccessToken('a1');
  client.setRefreshToken('r1');
  const body = JSON.stringify({ text: 'hi', client_request_id: 'crid-1' });
  const job = await queue.enqueueJob({ path: '/api/v1/projects/p1/stages/s1/comments', method: 'POST', body, userId: 'u1' });
  const result = await queue.flush('http://x');
  must(result.synced === 1 && result.blocked === 0, `job must sync after token refresh: ${JSON.stringify(result)}`);
  must(sent.length === 2, `exactly one retry expected, sent ${sent.length}`);
  must(sent[0].auth === 'Bearer a1' && sent[1].auth === 'Bearer a2', 'retry carries the refreshed token');
  must(sent[0].body === body && sent[1].body === body, 'same body / client_request_id on retry');
  must(sent[0].offlineId === job.id && sent[1].offlineId === job.id, 'same X-Offline-Id on retry');
  must((await queue.getQueue()).length === 0, 'job removed after success');

  // 401, который не лечится refresh -> не блокируем навсегда, а откладываем
  sent.length = 0;
  tokenValid = 'never';
  client.setAccessToken('a1');
  client.setRefreshToken('r1');
  await queue.enqueueJob({ path: '/api/v1/projects/p1/payments', method: 'POST', body: '{}', userId: 'u1' });
  const res2 = await queue.flush('http://x');
  const [stuck] = await queue.getQueue();
  must(res2.synced === 0 && stuck && stuck.blocked === false, 'persistent 401 must not block the job at once');
  must(typeof stuck.nextAttemptAt === 'number' && stuck.attempts === 1, 'backoff scheduled after persistent 401');
  must(sent.length === 2, 'persistent 401: one original attempt + one retry only');

  // --- CMP-016: очередь выходящего пользователя, чужие задания остаются ---
  resetMemoryStorage();
  await queue.enqueueJob({ path: '/a', method: 'POST', body: '{}', userId: 'u1' });
  await queue.enqueueJob({ path: '/b', method: 'POST', body: '{}', userId: 'u1' });
  await queue.enqueueJob({ path: '/c', method: 'POST', body: '{}', userId: 'u2' });
  must((await queue.dropJobsForUser('u1')) === 2, 'both jobs of the leaving user dropped');
  const rest = await queue.getQueue();
  must(rest.length === 1 && rest[0].userId === 'u2', 'other user jobs preserved');
  must((await queue.dropJobsForUser('')) === 0, 'empty user id drops nothing');

  // --- CMP-015: расчёт задержки ---
  const now = 10_000;
  const mk = (over: Record<string, unknown>) => ({ path: '/p', method: 'POST', body: '{}', userId: 'u1', ts: 1, id: String(Math.random()), ...over }) as any;
  must(nextFlushDelayMs([], now, 'u1') === null, 'empty queue: nothing to wait for');
  must(nextFlushDelayMs([mk({})], now, 'u1') === null, 'job without nextAttemptAt does not arm the timer');
  must(nextFlushDelayMs([mk({ nextAttemptAt: now + 30_000 })], now, 'u1') === 30_000, 'waits until nextAttemptAt');
  must(nextFlushDelayMs([mk({ nextAttemptAt: now - 5_000 })], now, 'u1') === FLUSH_SCHEDULER_MIN_DELAY_MS, 'overdue job still respects the minimum delay');
  must(nextFlushDelayMs([mk({ nextAttemptAt: now + 60_000 }), mk({ nextAttemptAt: now + 8_000 })], now, 'u1') === 8_000, 'earliest wins');
  must(nextFlushDelayMs([mk({ nextAttemptAt: now + 1, blocked: true }), mk({ nextAttemptAt: now + 1, conflict: true })], now, 'u1') === null, 'blocked/conflict ignored');
  must(nextFlushDelayMs([mk({ nextAttemptAt: now + 1, userId: 'u2' })], now, 'u1') === null, 'foreign jobs ignored');
  must(nextFlushDelayMs([mk({ nextAttemptAt: now + 1_000 })], now, 'u1', 20_000) === 20_000, '429 gate pause extends the wait');

  // --- CMP-015: планировщик с поддельными таймерами ---
  let clock = 0;
  let jobs: any[] = [mk({ nextAttemptAt: 6_000 })];
  let online = true;
  let paused = 0;
  let flushes = 0;
  const timers: { fn: () => void; at: number; id: number }[] = [];
  let seq = 0;
  let listener: () => void = () => undefined;
  const advance = async (to: number) => {
    clock = to;
    for (;;) {
      const due = timers.filter((t) => t.at <= clock).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      timers.splice(timers.indexOf(due), 1);
      due.fn();
      await tick();
      await tick();
    }
  };
  const stop = startOfflineFlushScheduler({
    getJobs: async () => jobs,
    flush: async () => { flushes += 1; jobs = []; listener(); },
    isOnline: async () => online,
    subscribe: (l) => { listener = l; return () => undefined; },
    getUserId: () => 'u1',
    pausedForMs: () => paused,
    now: () => clock,
    setTimer: (fn, ms) => { const t = { fn, at: clock + ms, id: ++seq }; timers.push(t); return t.id; },
    clearTimer: (h) => { const i = timers.findIndex((t) => t.id === h); if (i >= 0) timers.splice(i, 1); },
  });
  await tick(); await tick();
  must(timers.length === 1 && timers[0].at === 6_000, 'timer armed for nextAttemptAt');
  await advance(5_999);
  must(flushes === 0, 'not before nextAttemptAt');
  await advance(6_000);
  must(flushes === 1, 'flush fires at nextAttemptAt without any NetInfo event');
  must(timers.length === 0, 'queue drained: no timers left');

  // офлайн: не флашим (и не сжигаем попытки), перепроверяем позже
  jobs = [mk({ nextAttemptAt: clock + 3_000 })];
  online = false;
  listener();
  await tick(); await tick();
  await advance(clock + 3_000);
  must(flushes === 1, 'offline: no flush');
  must(timers.length === 1, 'offline: re-check scheduled');
  online = true;
  await advance(clock + 30_000);
  await advance(clock + FLUSH_SCHEDULER_MIN_DELAY_MS);
  must(flushes === 2, 'back online: flush on re-check');

  // пауза 429-gate: ждём конец паузы
  jobs = [mk({ nextAttemptAt: clock + 1_000 })];
  paused = 20_000;
  listener();
  await tick(); await tick();
  const armed = timers[0];
  must(armed && armed.at >= clock + 20_000, 'timer respects the 429 pause');
  stop();
  must(timers.length === 0, 'stop clears the timer');

  console.log('flushTransport.test OK');
}

main().catch((e) => { console.error(e); process.exit(1); });
