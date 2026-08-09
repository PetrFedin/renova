/**
 * Восстановление сессии при старте: API health, retry проектов, демо-recovery.
 * Решает «пустой» UI когда backend ещё не поднялся или storage устарел.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, ProjectDetail, ProjectSummary, User, UserRole } from '@/lib/api';
import { pickPrimaryDemoProject } from '@/lib/pickPrimaryDemoProject';
import { resolveActiveProjectId } from '@/lib/resolveActiveProjectId';
import { API_BASE } from '@/lib/api/client';
import { reportError } from '@/lib/reportError';

const KEYS = {
  userId: 'renova_user_id',
  projectId: 'renova_project_id',
  projectExplicitlyPicked: 'renova_project_explicitly_picked',
};

export const DEMO_PHONES = ['+70000000001', '+70000000002'] as const;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** iframe iphone-preview — автодемо без ручного входа */
export function isPreviewFrame(): boolean {
  return typeof window !== 'undefined' && window.parent !== window;
}

/** Проверка доступности API с повторами (backend может стартовать позже Expo). */
export async function pingApi(retries = 5, delayMs = 600): Promise<boolean> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(`${API_BASE}/health`, { method: 'GET' });
      if (res.ok) return true;
      if (i === retries - 1) {
        reportError('sessionBootstrap.pingApi.http', new Error(`HTTP ${res.status}`), { retries });
      }
    } catch (error) {
      if (i === retries - 1) reportError('sessionBootstrap.pingApi', error, { retries });
    }
    if (i < retries - 1) await sleep(delayMs * (i + 1));
  }
  return false;
}

/** Retry transient failures, but never turn exhausted retries into a real empty list. */
export async function listProjectsWithRetry(userId: string, retries = 3): Promise<ProjectSummary[]> {
  let lastError: unknown = new Error('projects_load_failed');
  for (let i = 0; i < retries; i++) {
    try {
      return await api.listProjects(userId);
    } catch (error) {
      lastError = error;
      if (i === retries - 1) throw error;
      await sleep(500 * (i + 1));
    }
  }
  throw lastError;
}

export function inferDemoRole(user: User | null, storedRole: string | null): UserRole {
  if (storedRole === 'contractor' || storedRole === 'customer') return storedRole;
  if (user?.phone === '+70000000002') return 'contractor';
  return 'customer';
}

export function isDemoPhone(phone?: string | null): boolean {
  return !!phone && (DEMO_PHONES as readonly string[]).includes(phone);
}

/** Загрузить активный проект: явный выбор → предложенный id → канонический demo. */
export async function loadActiveProject(
  userId: string,
  projects: ProjectSummary[],
  savedProjectId: string | null,
  role: UserRole,
): Promise<ProjectDetail | null> {
  const fallback = pickPrimaryDemoProject(projects)?.id ?? projects[0]?.id;
  const [persistedProjectId, explicitlyPicked] = await Promise.all([
    AsyncStorage.getItem(KEYS.projectId),
    AsyncStorage.getItem(KEYS.projectExplicitlyPicked),
  ]);
  const explicitProjectId =
    explicitlyPicked === '1'
      ? resolveActiveProjectId(projects, persistedProjectId)
      : null;
  const pickId =
    explicitProjectId
    ?? resolveActiveProjectId(projects, savedProjectId)
    ?? fallback;
  if (!pickId) return null;

  let p = await api.getProject(userId, pickId);
  if (!p && fallback) {
    p = await api.getProject(userId, fallback);
    if (p) await AsyncStorage.setItem(KEYS.projectId, fallback);
    return p;
  }
  if (role === 'contractor' && p) {
    try {
      p = await api.assignProject(userId, pickId);
    } catch (error) {
      // getProject already proved readable access; assignment reconciliation is
      // non-blocking, but failure must remain observable.
      reportError('sessionBootstrap.assignProject', error, { userId, projectId: pickId });
    }
  }
  if (p) await AsyncStorage.setItem(KEYS.projectId, p.id);
  return p;
}

/** Перелогин в демо-пользователя с актуальными проектами. Transport errors propagate. */
export async function recoverDemoSession(role: UserRole): Promise<{ user: User; projects: ProjectSummary[] }> {
  const u = await api.demoLogin(role);
  await AsyncStorage.setItem(KEYS.userId, u.id);
  await AsyncStorage.setItem('renova_user_role', role);
  const list = await listProjectsWithRetry(u.id, 4);
  return { user: u, projects: list };
}

/** Автовход для preview: демо-заказчик + пропуск квиза и выбора объекта */
export async function bootstrapPreviewDemo(): Promise<{ user: User; projects: ProjectSummary[] }> {
  await AsyncStorage.setItem('renova_detail_quiz_done', '1');
  await AsyncStorage.setItem('renova_detail_level', 'standard');
  await AsyncStorage.setItem('renova_project_explicitly_picked', '1');
  await AsyncStorage.removeItem('renova_pending_project_pick');
  return recoverDemoSession('customer');
}
