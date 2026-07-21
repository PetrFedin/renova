/** W81/W82: смена данных объекта → home/inbox без полного remount. */
import type { ProjectDetail, User, UserRole } from '@/lib/api';
import type { OsRole } from '@/constants/osSections';
import { reportCatch } from '@/lib/reportError';

type Listener = () => void;

const listeners = new Set<Listener>();

export function subscribeProjectDataChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyProjectDataChanged(): void {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* noop */
    }
  });
}

type SyncOpts = {
  user: User | null | undefined;
  project: ProjectDetail | null | undefined;
  /** Если не задан — из user.role */
  role?: OsRole | UserRole | string | null;
};

/**
 * W82: единый side-effect после мутаций golden path
 * (приёмка, ДО, подпись, гарантия, closeout, график).
 * reloadInboxSync — dynamic import, чтобы bus не тянул RN в unit-тестах.
 */
export async function syncProjectSideEffects(opts: SyncOpts): Promise<void> {
  const { user, project } = opts;
  if (!user?.id || !project?.id) {
    notifyProjectDataChanged();
    return;
  }
  const raw = opts.role ?? user.role;
  const osRole: OsRole = String(raw) === 'contractor' ? 'contractor' : 'customer';
  try {
    const { reloadInboxSync } = await import('@/lib/inboxSyncStore');
    await reloadInboxSync({
      userId: user.id,
      userRole: user.role,
      projectId: project.id,
      project,
      osRole,
    }).catch(reportCatch('projectDataBus.inboxSync'));
  } catch {
    /* offline / test env без inboxSyncStore */
  }
  notifyProjectDataChanged();
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

