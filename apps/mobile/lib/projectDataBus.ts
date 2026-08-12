/** W81/W82: смена данных объекта → home/inbox без полного remount. */
import type { ProjectDetail, User, UserRole } from '@/lib/api';
import type { OsRole } from '@/constants/osSections';
import { reportCatch, reportError } from '@/lib/reportError';

type Listener = (projectId?: string | null) => void;

const listeners = new Set<Listener>();

export function subscribeProjectDataChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyProjectDataChanged(projectId?: string | null): void {
  [...listeners].forEach((listener) => {
    try {
      listener(projectId || null);
    } catch (error) {
      // Один ошибочный listener не блокирует остальные экраны, но такой разрыв
      // нельзя оставлять невидимым: иначе post-commit UI может остаться stale.
      reportError('projectDataBus.listener', error, { projectId: projectId || null });
    }
  });
}

type SyncOpts = {
  user: User | null | undefined;
  project: ProjectDetail | null | undefined;
  /** Если не задан — из user.role */
  role?: OsRole | UserRole | string | null;
};

type SyncState = {
  dirty: boolean;
  latest: SyncOpts;
  promise: Promise<void>;
};

type ScheduledSync = {
  latest: SyncOpts;
  promise: Promise<void>;
  timer: ReturnType<typeof setTimeout>;
};

/**
 * Последовательные UI callbacks одной операции часто вызывают sync несколько раз.
 * Первый refresh выполняется сразу, вызовы в том же burst объединяются в один
 * обязательный trailing refresh с последними opts.
 */
const SIDE_EFFECT_COALESCE_MS = 300;
const activeSyncs = new Map<string, SyncState>();
const scheduledSyncs = new Map<string, ScheduledSync>();
const lastCompletedAt = new Map<string, number>();

function resolveSyncContext(opts: SyncOpts) {
  const { user, project } = opts;
  if (!user?.id || !project?.id) return null;
  const raw = opts.role ?? user.role;
  const osRole: OsRole = String(raw) === 'contractor' ? 'contractor' : 'customer';
  return {
    key: `${user.id}:${project.id}:${osRole}`,
    user,
    project,
    osRole,
  };
}

async function performProjectSideEffects(opts: SyncOpts): Promise<void> {
  const context = resolveSyncContext(opts);
  if (!context) {
    notifyProjectDataChanged();
    return;
  }

  try {
    const { reloadInboxSync } = await import('@/lib/inboxSyncStore');
    await reloadInboxSync({
      userId: context.user.id,
      userRole: context.user.role,
      projectId: context.project.id,
      project: context.project,
      osRole: context.osRole,
    }).catch(reportCatch('projectDataBus.inboxSync'));
  } catch (error) {
    // Dynamic import is intentionally optional in isolated test/runtime surfaces,
    // but a production import failure must be observable. Home listeners still run.
    reportError('projectDataBus.inboxImport', error, {
      userId: context.user.id,
      projectId: context.project.id,
      role: context.osRole,
    });
  }
  notifyProjectDataChanged(context.project.id);
}

function startSync(key: string, opts: SyncOpts): Promise<void> {
  const state: SyncState = {
    dirty: false,
    latest: opts,
    promise: Promise.resolve(),
  };

  state.promise = (async () => {
    let current = opts;
    do {
      state.dirty = false;
      await performProjectSideEffects(current);
      current = state.latest;
    } while (state.dirty);
  })().finally(() => {
    if (activeSyncs.get(key) === state) activeSyncs.delete(key);
    lastCompletedAt.set(key, Date.now());
  });

  activeSyncs.set(key, state);
  return state.promise;
}

/**
 * W82: единый side-effect после мутаций golden path
 * (приёмка, ДО, подпись, гарантия, closeout, график).
 * reloadInboxSync — dynamic import, чтобы bus не тянул RN в unit-тестах.
 */
export function syncProjectSideEffects(opts: SyncOpts): Promise<void> {
  const context = resolveSyncContext(opts);
  if (!context) {
    notifyProjectDataChanged();
    return Promise.resolve();
  }

  const active = activeSyncs.get(context.key);
  if (active) {
    active.latest = opts;
    active.dirty = true;
    return active.promise;
  }

  const scheduled = scheduledSyncs.get(context.key);
  if (scheduled) {
    scheduled.latest = opts;
    return scheduled.promise;
  }

  const elapsed = Date.now() - (lastCompletedAt.get(context.key) ?? 0);
  if (elapsed < SIDE_EFFECT_COALESCE_MS) {
    let resolvePromise: () => void = () => undefined;
    let rejectPromise: (error: unknown) => void = () => undefined;
    const promise = new Promise<void>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    const entry: ScheduledSync = {
      latest: opts,
      promise,
      timer: setTimeout(() => {
        scheduledSyncs.delete(context.key);
        startSync(context.key, entry.latest).then(resolvePromise, rejectPromise);
      }, SIDE_EFFECT_COALESCE_MS - elapsed),
    };
    scheduledSyncs.set(context.key, entry);
    return promise;
  }

  return startSync(context.key, opts);
}

/**
 * W87: выполнить мутацию и сразу синхронизировать inbox/home.
 * Канон для новых callers — оборачивать action, а не дублировать sync вручную.
 */
export async function runWithProjectSideEffects<T>(
  opts: SyncOpts,
  action: () => Promise<T>,
): Promise<T> {
  const result = await action();
  await syncProjectSideEffects(opts);
  return result;
}
