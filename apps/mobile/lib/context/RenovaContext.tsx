/** Глобальное состояние: пользователь, роль, активный проект */
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { PaywallModal } from '@/components/renova/PaywallModal';
import { replaceOsNav } from '@/lib/pushOsNav';
import { flushOfflineOutbox } from '@/lib/offline';
import { reloadInboxSync } from "@/lib/inboxSyncStore";
import { notifyProjectDataChanged, syncProjectSideEffects } from "@/lib/projectDataBus";

function signalPreviewReady() {
  if (typeof window !== "undefined" && window.parent !== window) {
    window.parent.postMessage({ type: "renova-ready" }, "*");
  }
}

import { ApiError, api, isRateLimitError, ProjectDetail, ProjectSummary, User, UserRole } from '@/lib/api';
import { setAccessToken } from '@/lib/api/client';
import {
  bootstrapPreviewDemo,
  inferDemoRole,
  isDemoPhone,
  isPreviewFrame,
  listProjectsWithRetry,
  loadActiveProject,
  pingApi,
  recoverDemoSession,
} from '@/lib/sessionBootstrap';
import { enrichProjectsPendingPayments } from '@/lib/domain/enrichProjectsPendingPayments';
import { pickPrimaryDemoProject } from '@/lib/pickPrimaryDemoProject';
import { resolveActiveProjectId, isJunkProjectName } from '@/lib/resolveActiveProjectId';
import { SESSION_KEYS } from '@/constants/sessionKeys';
import { setCustomerBudget } from '@/lib/customerBudgetPrefs';
import { normalizeCustomerBudget } from '@/lib/customerBudgetSync';
import { Platform } from 'react-native';

const LOGIN_TIMEOUT_MS = 15_000;

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

/** Push registration can hang on web — defer and skip non-native platforms */
function deferPushRegistration(userId: string) {
  if (Platform.OS === 'web' || typeof window !== 'undefined') return;
  setTimeout(async () => {
    try {
      const Notifications = await import('expo-notifications');
      const { status } = await Notifications.requestPermissionsAsync();
      if (status === 'granted') {
        const tok = (await Notifications.getExpoPushTokenAsync()).data;
        await api.registerPushToken(userId, tok);
      }
    } catch { /* push optional */ }
  }, 0);
}

import { syncCustomerBudgetOnLoad } from '@/lib/customerBudgetMigrate';
import { buildProjectCreatePayload } from '@/lib/wizard/buildProjectCreatePayload';

const KEYS = { userId: 'renova_user_id', projectId: 'renova_project_id', accessToken: 'renova_access_token' };

async function persistAccessToken(user: { access_token?: string | null }) {
  const tok = user.access_token?.trim();
  if (tok) {
    setAccessToken(tok);
    await AsyncStorage.setItem(KEYS.accessToken, tok);
  }
}

async function clearAccessToken() {
  setAccessToken(null);
  await AsyncStorage.removeItem(KEYS.accessToken);
}


import type { WizardRoomDraft } from '@/constants/roomTypes';

type WizardDraft = {
  name: string;
  address: string;
  renovation_type: string;
  property_type: 'apartment' | 'house';
  planned_start_date?: string;
  planned_end_date?: string;
  /** Лимит, который заказчик готов вложить (₽) */
  customer_budget?: number;
  rooms: WizardRoomDraft[];
  /** quick = шаблон комнат, detailed = пошагово */
  wizard_mode?: 'quick' | 'detailed';
};

export type ProjectProfilePatch = Partial<Pick<WizardDraft, 'name' | 'address' | 'renovation_type' | 'property_type' | 'customer_budget'>> & {
  planned_start_date?: string | null;
  planned_end_date?: string | null;
};

/** Результат создания объекта из wizard */
export type CreateProjectResult = {
  id: string;
  /** На demo-телефоне активным остаётся канонический объект */
  demoKeptPrimary?: { createdName: string; activeName: string };
};

type Ctx = {
  loading: boolean;
  apiReachable: boolean;
  user: User | null;
  projects: ProjectSummary[];
  activeProject: ProjectDetail | null;
  wizard: WizardDraft;
  setWizard: (p: Partial<WizardDraft>) => void;
  demoLogin: (role: UserRole) => Promise<void>;
  register: (phone: string, role: UserRole, extra?: { full_name?: string; inn?: string }) => Promise<void>;
  loginWithSms: (phone: string, code: string, role: UserRole, extra?: { full_name?: string; inn?: string }) => Promise<void>;
  refreshProjects: () => Promise<void>;
  refreshMe: () => Promise<void>;
  /** Сброс активного объекта (корзина/архив текущего проекта) */
  clearActiveProject: () => Promise<void>;
  loadProject: (id: string) => Promise<void>;
  /** Подхват сохранённого объекта — один раз на все разделы OS */
  ensureActiveProject: () => Promise<void>;
  /** Идёт загрузка/восстановление активного объекта */
  projectResolving: boolean;
  recoverSession: () => Promise<void>;
  createProjectFromWizard: (extra?: Partial<WizardDraft>) => Promise<CreateProjectResult>;
  updateProjectProfile: (patch: ProjectProfilePatch) => Promise<void>;
  submitStage: (stageId: string) => Promise<void>;
  acceptStage: (stageId: string, opts?: { qualityScore?: number | null }) => Promise<void>;
  rejectStage: (stageId: string, reason: string, opts?: { qualityScore?: number | null }) => Promise<void>;
  logout: () => Promise<void>;
  
  paywallVisible: boolean;
  showPaywall: () => void;
  hidePaywall: () => void;
  readOnly: boolean;
  teamRole: string | null;
  isContractorOwner: boolean;
};

const defaultWizard: WizardDraft = {
  name: '',
  address: '',
  renovation_type: 'cosmetic',
  property_type: 'apartment',
  wizard_mode: 'detailed',
  rooms: [{ name: 'Гостиная', room_type: 'living', floor_level: 1, length_m: 4.2, width_m: 3.1, height_m: 2.7, outlets_count: 6, switches_count: 2, plumbing_points: 0 }],
};

const RenovaContext = createContext<Ctx | null>(null);

export function RenovaProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [apiReachable, setApiReachable] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [activeProject, setActiveProject] = useState<ProjectDetail | null>(null);
  const [projectResolving, setProjectResolving] = useState(false);
  const ensureAttemptKeyRef = useRef<string | null>(null);
  const [wizard, setWizardState] = useState<WizardDraft>(defaultWizard);
  const [paywallVisible, setPaywallVisible] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  /** W68 #43: роль в бригаде owner|foreman|member|viewer */
  const [teamRole, setTeamRole] = useState<string | null>(null);

  const setWizard = useCallback((p: Partial<WizardDraft>) => {
    setWizardState((w) => ({ ...w, ...p }));
  }, []);

  const refreshProjects = useCallback(async () => {
    if (!user) return;
    const raw = await api.listProjects(user.id);
    const list = await enrichProjectsPendingPayments(user.id, raw, user.role);
    setProjects(list);
  }, [user]);

  const clearActiveProject = useCallback(async () => {
    setActiveProject(null);
    setReadOnly(false);
    await AsyncStorage.removeItem(KEYS.projectId);
    await AsyncStorage.removeItem(SESSION_KEYS.projectExplicitlyPicked);
    await AsyncStorage.setItem(SESSION_KEYS.pendingProjectPick, '1');
  }, []);

  const refreshMe = useCallback(async () => {
    if (!user) return;
    const u = await api.me(user.id);
    setUser(u);
    try {
      const team = await api.getTeam(u.id);
      const me = team?.members?.find((m: any) => m.user_id === u.id);
      setReadOnly(false);
    } catch { setReadOnly(false); }
  }, [user?.id]);

  const loadProject = useCallback(
    async (id: string) => {
      if (!user) return;
      setProjectResolving(true);
      ensureAttemptKeyRef.current = null;
      try {
        let p = await api.getProject(user.id, id);
        if (user.role === 'contractor' && !p) throw new Error('not found');
        if (user.role === 'contractor') {
          try { p = await api.assignProject(user.id, id); } catch (e: any) { if (String(e?.message || '').includes('402') || String(e).includes('subscription')) { const { pushOsNav } = await import('@/lib/pushOsNav'); pushOsNav('/(contractor)/subscription', undefined, 'contractor'); throw e; } }
        }
        const syncedLimit = await syncCustomerBudgetOnLoad(user.id, id, p.customer_budget);
        if (syncedLimit !== normalizeCustomerBudget(p.customer_budget)) {
          p = { ...p, customer_budget: syncedLimit };
        }
        setActiveProject(p);
        setReadOnly(!!p?.read_only);
        await AsyncStorage.setItem(KEYS.projectId, id);
        await AsyncStorage.setItem(SESSION_KEYS.projectExplicitlyPicked, '1');
        await AsyncStorage.removeItem(SESSION_KEYS.pendingProjectPick);
        // W81: inbox/задачи и home hints для нового объекта
        await reloadInboxSync({
          userId: user.id,
          userRole: user.role,
          projectId: id,
          project: p,
          osRole: user.role === 'contractor' ? 'contractor' : 'customer',
        }).catch(() => {});
        notifyProjectDataChanged();
      } catch (e) {
        // Duck-typed rate_limit (HMR) — не роняем UI, оставляем текущий activeProject
        if (isRateLimitError(e)) return;
        if (e instanceof Error && /rate_limit/i.test(e.message)) return;
        throw e;
      } finally {
        setProjectResolving(false);
      }
    },
    [user],
  );

  const ensureActiveProject = useCallback(async () => {
    if (!user || activeProject || !projects.length || projectResolving) return;
    const pending = await AsyncStorage.getItem(SESSION_KEYS.pendingProjectPick);
    if (pending === '1') return;
    const saved = await AsyncStorage.getItem(KEYS.projectId);
    const pickId = resolveActiveProjectId(projects, saved);
    if (!pickId) return;
    const attemptKey = `${user.id}:${pickId}`;
    if (ensureAttemptKeyRef.current === attemptKey) return;
    ensureAttemptKeyRef.current = attemptKey;
    try {
      await loadProject(pickId);
    } catch {
      /* оставляем ref — не крутим бесконечный retry; ручной выбор сбросит */
    }
  }, [user, activeProject, projects, projectResolving, loadProject]);

  useEffect(() => {
    ensureAttemptKeyRef.current = null;
  }, [projects.map((p) => p.id).join('|')]);

  /** Применить пользователя + проекты + активный объект после bootstrap/recovery */
  const applySession = useCallback(async (u: User, list: ProjectSummary[]) => {
    await persistAccessToken(u);
    setUser(u);
    const enriched = await enrichProjectsPendingPayments(u.id, list, u.role);
    setProjects(enriched);
    try {
      const team = await api.getTeam(u.id);
      const me = team?.members?.find((m: { user_id: string; role?: string }) => m.user_id === u.id);
      if (u.role === 'contractor') {
        setTeamRole(me?.role || 'owner');
        setReadOnly(me?.role === 'viewer');
      } else {
        setTeamRole(null);
      }
    } catch {
      setReadOnly(false);
    }
    const pendingPick = await AsyncStorage.getItem(SESSION_KEYS.pendingProjectPick);
    // pendingProjectPick=1 — только явный экран выбора (onboarding); demo auto-load ниже
    if (pendingPick === '1') {
      setActiveProject(null);
      return;
    }
    const pid = await AsyncStorage.getItem(KEYS.projectId);
    const role = inferDemoRole(u, await AsyncStorage.getItem('renova_user_role'));
    const demoPick =
      isDemoPhone(u.phone) && enriched.length > 0
        ? pickPrimaryDemoProject(enriched)?.id ?? enriched[0]?.id
        : null;
    const p = await loadActiveProject(u.id, enriched, demoPick ?? pid, role);
    if (p) {
      setReadOnly(!!p.read_only);
      setActiveProject(p);
      if (isDemoPhone(u.phone)) {
        await AsyncStorage.setItem(SESSION_KEYS.projectExplicitlyPicked, '1');
        await AsyncStorage.removeItem(SESSION_KEYS.pendingProjectPick);
      }
    } else {
      setActiveProject(null);
    }
  }, []);

  const recoverSession = useCallback(async () => {
    const reachable = await pingApi();
    setApiReachable(reachable);
    if (!reachable) return;
    const storedRole = await AsyncStorage.getItem('renova_user_role');
    const role = inferDemoRole(user, storedRole);
    const recovered = await recoverDemoSession(role);
    if (recovered) {
      await applySession(recovered.user, recovered.projects);
      return;
    }
    if (user) {
      const raw = await listProjectsWithRetry(user.id, 4);
      const list = user ? await enrichProjectsPendingPayments(user.id, raw, user.role) : raw;
      setProjects(list);
      const pending = await AsyncStorage.getItem(SESSION_KEYS.pendingProjectPick);
      if (pending === '1') {
        setActiveProject(null);
        return;
      }
      if (list.length) {
        const p = await loadActiveProject(user.id, list, await AsyncStorage.getItem(KEYS.projectId), role);
        if (p) {
          setActiveProject(p);
          setReadOnly(!!p.read_only);
        }
      }
    }
  }, [user, applySession]);

  useEffect(() => {
    (async () => {
      try {
        const reachable = await pingApi();
        setApiReachable(reachable);

        const uid = await AsyncStorage.getItem(KEYS.userId);
        const storedRole = await AsyncStorage.getItem('renova_user_role');
        const storedTok = await AsyncStorage.getItem(KEYS.accessToken);
        if (storedTok) setAccessToken(storedTok);

        // Preview iframe: автодемо без ручного онбординга
        if (!uid && isPreviewFrame() && reachable) {
          const preview = await bootstrapPreviewDemo();
          if (preview) {
            await applySession(preview.user, preview.projects);
            return;
          }
        }

        if (!uid) return;

        let u: User;
        try {
          u = await api.me(uid);
          await persistAccessToken(u);
        } catch {
          await AsyncStorage.multiRemove([KEYS.userId, KEYS.projectId, KEYS.accessToken]);
          await clearAccessToken();
          if (reachable) {
            const recovered = await recoverDemoSession(inferDemoRole(null, storedRole));
            if (recovered) await applySession(recovered.user, recovered.projects);
          }
          return;
        }

        try {
          const Notifications = await import('expo-notifications');
          const { status } = await Notifications.requestPermissionsAsync();
          if (status === 'granted') {
            const tok = (await Notifications.getExpoPushTokenAsync()).data;
            await api.registerPushToken(u.id, tok);
          }
        } catch {}

        let list = await listProjectsWithRetry(u.id);

        // Пустой список или устаревший userId — пересинхронизация с демо
        if (list.length === 0 && reachable) {
          const role = inferDemoRole(u, storedRole);
          if (isDemoPhone(u.phone) || storedRole === 'customer' || storedRole === 'contractor') {
            const recovered = await recoverDemoSession(role);
            if (recovered) {
              u = recovered.user;
              list = recovered.projects;
            }
          }
        }

        await applySession(u, list);
      } catch {
        /* сбой окружения — не сбрасываем storage */
      } finally {
        try {
          await flushOfflineOutbox();  // W93: session boot → канон flush + buses
        } catch {}
        setLoading(false);
        signalPreviewReady();
      }
    })();
  }, [applySession]);


  const demoLogin = useCallback(async (role: UserRole) => {
    const u = await withTimeout(api.demoLogin(role), LOGIN_TIMEOUT_MS, 'Превышено время ожидания сервера');
    await persistAccessToken(u);
    setUser(u);
    try {
      const team = await api.getTeam(u.id);
      const me = team?.members?.find((m: any) => m.user_id === u.id);
      setReadOnly(me?.role === 'viewer');
    } catch { setReadOnly(false); }
    deferPushRegistration(u.id);
    await AsyncStorage.setItem(KEYS.userId, u.id);
    await AsyncStorage.setItem('renova_user_role', role);
    let list: ProjectSummary[] = [];
    try {
      const raw = await withTimeout(listProjectsWithRetry(u.id, 4), LOGIN_TIMEOUT_MS, 'Превышено время ожидания загрузки проектов');
      list = await enrichProjectsPendingPayments(u.id, raw, role);
    } catch {
      list = [];
    }
    setProjects(list);
    setActiveProject(null);
    await AsyncStorage.removeItem(KEYS.projectId);
    await AsyncStorage.removeItem(SESSION_KEYS.projectExplicitlyPicked);
    await AsyncStorage.setItem(SESSION_KEYS.pendingProjectPick, '1');
  }, []);


  const loginWithSms = useCallback(async (phone: string, code: string, role: UserRole, extra?: { full_name?: string; inn?: string }) => {
    const u = await api.verifySmsCode(phone, code, role, extra);
    await persistAccessToken(u);
    await AsyncStorage.setItem(KEYS.userId, u.id);
    setUser(u);
    const raw = await api.listProjects(u.id);
    const list = await enrichProjectsPendingPayments(u.id, raw, role);
    setProjects(list);
    const saved = await AsyncStorage.getItem(KEYS.projectId);
    const pickId = saved ? resolveActiveProjectId(list, saved) : null;
    if (pickId) {
      const detail = await api.getProject(u.id, pickId);
      setActiveProject(detail);
      await AsyncStorage.setItem(KEYS.projectId, pickId);
      await AsyncStorage.removeItem(SESSION_KEYS.pendingProjectPick);
    } else {
      setActiveProject(null);
      await AsyncStorage.removeItem(KEYS.projectId);
      await AsyncStorage.setItem(SESSION_KEYS.pendingProjectPick, '1');
    }
    try {
      const tok = await (await import('expo-notifications')).getExpoPushTokenAsync();
      if (tok?.data) await api.registerPushToken(u.id, tok.data);
    } catch { /* push */ }
  }, []);

  const register = useCallback(async (phone: string, role: UserRole, extra?: { full_name?: string; inn?: string }) => {
    const u = await api.register({ phone, role, ...extra });
    await persistAccessToken(u);
    setUser(u);
        try {
          const team = await api.getTeam(u.id);
          const me = team?.members?.find((m: any) => m.user_id === u.id);
          setReadOnly(me?.role === 'viewer');
        } catch { setReadOnly(false); }
        try {
          const Notifications = await import('expo-notifications');
          const { status } = await Notifications.requestPermissionsAsync();
          if (status === 'granted') {
            const tok = (await Notifications.getExpoPushTokenAsync()).data;
            await api.registerPushToken(u.id, tok);
          }
        } catch {}
    await AsyncStorage.setItem(KEYS.userId, u.id);
    if (role === 'contractor') {
      const raw = await api.listProjects(u.id);
      const list = await enrichProjectsPendingPayments(u.id, raw, role);
      setProjects(list);
    }
  }, []);

  const createProjectFromWizard = useCallback(async (extra?: Partial<WizardDraft>): Promise<CreateProjectResult> => {
    if (!user) throw new Error('no user');
    const draft = { ...wizard, ...extra };
    if (!draft.name.trim()) throw new Error('Укажите название проекта');
    const body = buildProjectCreatePayload(draft);
    const created = await api.createProject(user.id, body);
    if (draft.customer_budget && draft.customer_budget > 0) {
      await api.patchProject(user.id, created.id, { customer_budget: Math.round(draft.customer_budget) });
    }
    const limit = normalizeCustomerBudget(created.customer_budget) ?? normalizeCustomerBudget(draft.customer_budget);
    if (limit) await setCustomerBudget(created.id, limit);
    let detail = created;
    try {
      detail = await api.getProject(user.id, created.id);
    } catch {
      /* POST-ответ достаточен как fallback */
    }
    const refreshed = await enrichProjectsPendingPayments(user.id, await api.listProjects(user.id), user.role as UserRole);
    setProjects(refreshed);
    const junkWizard = isDemoPhone(user.phone) && isJunkProjectName(created.name);
    if (junkWizard) {
      const primary = pickPrimaryDemoProject(refreshed);
      const primaryId = primary?.id;
      if (primaryId) {
        const primaryDetail = await api.getProject(user.id, primaryId);
        setActiveProject(primaryDetail);
        await AsyncStorage.setItem(KEYS.projectId, primaryId);
        await AsyncStorage.removeItem(SESSION_KEYS.pendingProjectPick);
        return {
          id: created.id,
          demoKeptPrimary: { createdName: created.name, activeName: primary?.name || primaryDetail.name },
        };
      }
    }
    setActiveProject(detail);
    await AsyncStorage.setItem(KEYS.projectId, created.id);
    await AsyncStorage.setItem(SESSION_KEYS.projectExplicitlyPicked, '1');
    await AsyncStorage.removeItem(SESSION_KEYS.pendingProjectPick);
    await refreshProjects();
    return { id: created.id };
  }, [user, wizard, refreshProjects]);

  const updateProjectProfile = useCallback(async (patch: ProjectProfilePatch) => {
    if (!user || !activeProject) throw new Error('no project');
    const body: Record<string, unknown> = { ...patch };
    if (patch.address === undefined) delete body.address;
    if (patch.customer_budget === undefined) delete body.customer_budget;
    const p = await api.patchProject(user.id, activeProject.id, body);
    if (patch.customer_budget !== undefined) {
      const limit = normalizeCustomerBudget(p.customer_budget) ?? normalizeCustomerBudget(patch.customer_budget);
      await setCustomerBudget(activeProject.id, limit);
    }
    setActiveProject(p);
    await refreshProjects();
    // W88: профиль/бюджет объекта → home insights + inbox
    await syncProjectSideEffects({ user, project: p });
  }, [user, activeProject, refreshProjects]);

  const submitStage = useCallback(
    async (stageId: string) => {
      if (!user || !activeProject) return;
      await api.submitStage(user.id, activeProject.id, stageId);
      await loadProject(activeProject.id);
      // W84: inbox/home nextAction (приёмка / оплата этапа)
      await syncProjectSideEffects({ user, project: activeProject });
    },
    [user, activeProject, loadProject],
  );

  const rejectStage = useCallback(async (stageId: string, reason: string, opts?: { qualityScore?: number | null }) => {
    if (!user || !activeProject) return;
    await api.rejectStage(user.id, activeProject.id, stageId, reason, opts);
    await loadProject(activeProject.id);
    await syncProjectSideEffects({ user, project: activeProject });
  }, [user, activeProject, loadProject]);

  const acceptStage = useCallback(
    async (stageId: string, opts?: { qualityScore?: number | null }) => {
      if (!user || !activeProject) return;
      try {
        await api.acceptStage(user.id, activeProject.id, stageId, opts);
      } catch (e: any) {
        if (e?.message === 'offline_queued') {
          /* queued */
        } else throw e;
      }
      await loadProject(activeProject.id);
      await syncProjectSideEffects({ user, project: activeProject });
    },
    [user, activeProject, loadProject],
  );

  /** Проект не выбран, но список есть — подхватить сохранённый (не при ожидании выбора) */
  useEffect(() => {
    if (loading || !user || activeProject || !projects.length) return;
    AsyncStorage.getItem(SESSION_KEYS.pendingProjectPick).then((pending) => {
      if (pending === '1') return;
      ensureActiveProject().catch(() => {});
    });
  }, [loading, user?.id, activeProject?.id, projects.length, ensureActiveProject]);

  const logout = useCallback(async () => {
    await AsyncStorage.multiRemove([KEYS.userId, KEYS.projectId, KEYS.accessToken, SESSION_KEYS.pendingProjectPick, SESSION_KEYS.projectExplicitlyPicked]);
    await clearAccessToken();
    setUser(null);
    setProjects([]);
    setActiveProject(null);
    setWizardState(defaultWizard);
  }, []);

  const value = useMemo(
    () => ({
      loading,
      apiReachable,
      user,
      projects,
      activeProject,
      wizard,
      setWizard,
      demoLogin,
      register,
      loginWithSms,
      refreshProjects,
      refreshMe,
      clearActiveProject,
      loadProject,
      ensureActiveProject,
      projectResolving,
      recoverSession,
      createProjectFromWizard,
      updateProjectProfile,
      submitStage,
      acceptStage,
      rejectStage,
      logout,
      paywallVisible,
      showPaywall: () => setPaywallVisible(true),
      hidePaywall: () => setPaywallVisible(false),
      readOnly,
      teamRole,
      isContractorOwner: Boolean(
        user?.role === 'contractor'
        && (!teamRole || teamRole === 'owner')
        && activeProject
        && activeProject.contractor_id === user.id
      ),
    }),
    [loading, apiReachable, user, projects, activeProject, projectResolving, wizard, setWizard, demoLogin, register, loginWithSms, refreshProjects, refreshMe, clearActiveProject, loadProject, ensureActiveProject, recoverSession, createProjectFromWizard, updateProjectProfile, submitStage, acceptStage, rejectStage, logout, paywallVisible, readOnly, teamRole],
  );

  return (
    <RenovaContext.Provider value={value}>
      {children}
      {paywallVisible && user && (
        <PaywallModal
          visible={paywallVisible}
          onClose={() => setPaywallVisible(false)}
          onUpgrade={async () => {
            await api.checkoutPro(user.id);
            setPaywallVisible(false);
            replaceOsNav('/(contractor)/subscription', undefined, 'contractor');
          }}
        />
      )}
    </RenovaContext.Provider>
  );
}

export function useRenova() {
  const ctx = useContext(RenovaContext);
  if (!ctx) throw new Error('useRenova outside provider');
  return ctx;
}
