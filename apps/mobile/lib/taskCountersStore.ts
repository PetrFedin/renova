/**
 * Единый store счётчиков задач.
 * Calendar badge ← dueToday; Inbox tasks ← actionRequired; overdue отдельно.
 * После task.updated: delta по revision ИЛИ reconciliation fetch.
 */
import { AppState, type AppStateStatus } from 'react-native';
import { api } from '@/lib/api';
import { getDeviceTimezone } from '@/lib/i18n';
import {
  applyTaskCounterDelta,
  emptyTaskCounters,
  shouldApplyTaskCounters,
  taskCountersContextKey,
  type TaskCounters,
} from '@/lib/domain/taskCounters';
import { projectDataBus } from '@/lib/projectDataBus';

type Listener = () => void;

type StoreState = {
  contextKey: string | null;
  counters: TaskCounters | null;
  loading: boolean;
  error: string | null;
  stale: boolean;
  updatedAt: number;
};

let state: StoreState = {
  contextKey: null,
  counters: null,
  loading: false,
  error: null,
  stale: false,
  updatedAt: 0,
};

const listeners = new Set<Listener>();
let bootstrapped = false;
let inflight: Promise<void> | null = null;
let lastArgs: { userId: string; projectId: string; role?: string; timezone?: string } | null = null;

function emit() {
  listeners.forEach((l) => {
    try {
      l();
    } catch {
      /* ignore */
    }
  });
}

function setState(patch: Partial<StoreState>) {
  state = { ...state, ...patch };
  emit();
}

export function getTaskCountersSnapshot(): StoreState {
  return state;
}

export function subscribeTaskCounters(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function reconcileTaskCounters(opts: {
  userId: string;
  projectId: string;
  role?: string;
  timezone?: string;
}): Promise<TaskCounters | null> {
  const tz = opts.timezone || getDeviceTimezone() || 'Europe/Moscow';
  const contextKey = taskCountersContextKey(opts.projectId, opts.role, tz);
  lastArgs = { ...opts, timezone: tz };

  if (inflight) return inflight.then(() => state.counters);
  setState({ loading: true, error: null, contextKey });

  inflight = (async () => {
    try {
      const data = await api.getTaskCounters(opts.userId, {
        project: opts.projectId,
        role: opts.role,
        timezone: tz,
      });
      const incoming: TaskCounters = {
        dueToday: Number(data.dueToday) || 0,
        overdue: Number(data.overdue) || 0,
        upcoming: Number(data.upcoming) || 0,
        actionRequired: Number(data.actionRequired) || 0,
        byType: data.byType || {},
        revision: data.revision ?? 0,
        asOfDate: data.asOfDate,
        timezone: data.timezone || tz,
        projectId: opts.projectId,
        role: opts.role,
      };
      if (!shouldApplyTaskCounters(state.counters, incoming) && state.contextKey === contextKey) {
        // stale response — оставляем текущие
        setState({ loading: false, stale: false, updatedAt: Date.now() });
        return;
      }
      setState({
        counters: incoming,
        loading: false,
        error: null,
        stale: false,
        contextKey,
        updatedAt: Date.now(),
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Не удалось загрузить счётчики задач';
      setState({
        loading: false,
        error: msg,
        stale: Boolean(state.counters),
        updatedAt: Date.now(),
      });
    } finally {
      inflight = null;
    }
  })();

  await inflight;
  return state.counters;
}

/** WS / push: task.updated — delta или полный reconcile */
export function handleTaskUpdatedEvent(payload: {
  type?: string;
  revision?: string | number;
  project_id?: string;
  counter_delta?: Record<string, number>;
}): void {
  if (payload.type && payload.type !== 'task.updated') return;
  const projectId = payload.project_id;
  if (projectId && lastArgs?.projectId && projectId !== lastArgs.projectId) return;

  if (payload.revision != null && payload.counter_delta && state.counters) {
    const next = applyTaskCounterDelta(state.counters, {
      revision: payload.revision,
      counter_delta: payload.counter_delta,
    });
    if (next && next !== state.counters) {
      setState({ counters: next, updatedAt: Date.now(), stale: false });
      return;
    }
  }

  // Нет delta или revision gap → reconciliation
  if (lastArgs) {
    void reconcileTaskCounters(lastArgs);
  }
}

export function resetTaskCounters(): void {
  state = {
    contextKey: null,
    counters: null,
    loading: false,
    error: null,
    stale: false,
    updatedAt: 0,
  };
  lastArgs = null;
  emit();
}

function ensureBootstrap(): void {
  if (bootstrapped) return;
  bootstrapped = true;

  projectDataBus.subscribe(() => {
    if (lastArgs) void reconcileTaskCounters(lastArgs);
  });

  AppState.addEventListener('change', (next: AppStateStatus) => {
    if (next === 'active' && lastArgs) void reconcileTaskCounters(lastArgs);
  });
}

ensureBootstrap();

export function peekDueToday(): number {
  return state.counters?.dueToday ?? 0;
}

export function peekActionRequired(): number {
  return state.counters?.actionRequired ?? 0;
}

export function peekOverdue(): number {
  return state.counters?.overdue ?? 0;
}

/** Для тестов / offline placeholder */
export function seedTaskCountersForTests(counters: TaskCounters | null): void {
  setState({
    counters: counters || emptyTaskCounters(),
    loading: false,
    error: null,
    stale: false,
    updatedAt: Date.now(),
  });
}
