/**
 * Восстановление сессии при старте: API health, retry проектов, демо-recovery.
 * Решает «пустой» UI когда backend ещё не поднялся или storage устарел.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, ProjectDetail, ProjectSummary, User, UserRole } from '@/lib/api';
import { pickPrimaryDemoProject } from '@/lib/pickPrimaryDemoProject';
import { resolveActiveProjectId } from '@/lib/resolveActiveProjectId';
import { API_BASE } from '@/lib/api/client';

const KEYS = { userId: 'renova_user_id', projectId: 'renova_project_id' };

export const DEMO_PHONES = ['+70000000001', '+70000000002'] as const;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** iframe iphone-preview — автодемо без ручного входа */
export function isPreviewFrame(): boolean {
  return typeof window !== 'undefined' && window.parent !== window;
}

/** Проверка доступности API с повторами (backend может стартовать позже Expo) */
export async function pingApi(retries = 5, delayMs = 600): Promise<boolean> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(`${API_BASE}/health`, { method: 'GET' });
      if (res.ok) return true;
    } catch {
      /* retry */
    }
    if (i < retries - 1) await sleep(delayMs * (i + 1));
  }
  return false;
}

export async function listProjectsWithRetry(userId: string, retries = 3): Promise<ProjectSummary[]> {
  for (let i = 0; i < retries; i++) {
    try {
      return await api.listProjects(userId);
    } catch {
      if (i < retries - 1) await sleep(500 * (i + 1));
    }
  }
  return [];
}

export function inferDemoRole(user: User | null, storedRole: string | null): UserRole {
  if (storedRole === 'contractor' || storedRole === 'customer') return storedRole;
  if (user?.phone === '+70000000002') return 'contractor';
  return 'customer';
}

export function isDemoPhone(phone?: string | null): boolean {
  return !!phone && (DEMO_PHONES as readonly string[]).includes(phone);
}

/** Загрузить активный проект: saved id (без junk) → канонический demo */
export async function loadActiveProject(
  userId: string,
  projects: ProjectSummary[],
  savedProjectId: string | null,
  role: UserRole,
): Promise<ProjectDetail | null> {
  const fallback = pickPrimaryDemoProject(projects)?.id ?? projects[0]?.id;
  const pickId = resolveActiveProjectId(projects, savedProjectId) ?? fallback;
  if (!pickId) return null;
  try {
    let p = await api.getProject(userId, pickId);
    if (!p && fallback) {
      p = await api.getProject(userId, fallback);
      if (p) await AsyncStorage.setItem(KEYS.projectId, fallback);
      return p;
    }
    if (role === 'contractor' && p) {
      try {
        p = await api.assignProject(userId, pickId);
      } catch {
        /* ok */
      }
    }
    if (p) await AsyncStorage.setItem(KEYS.projectId, p.id);
    return p;
  } catch {
    return null;
  }
}

/** Перелогин в демо-пользователя с актуальными проектами */
export async function recoverDemoSession(role: UserRole): Promise<{ user: User; projects: ProjectSummary[] } | null> {
  try {
    const u = await api.demoLogin(role);
    await AsyncStorage.setItem(KEYS.userId, u.id);
    await AsyncStorage.setItem('renova_user_role', role);
    const list = await listProjectsWithRetry(u.id, 4);
    return { user: u, projects: list };
  } catch {
    return null;
  }
}

/** Автовход для preview: демо-заказчик + пропуск квиза */
export async function bootstrapPreviewDemo(): Promise<{ user: User; projects: ProjectSummary[] } | null> {
  await AsyncStorage.setItem('renova_detail_quiz_done', '1');
  await AsyncStorage.setItem('renova_detail_level', 'standard');
  return recoverDemoSession('customer');
}
