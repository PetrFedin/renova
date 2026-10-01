/** Глобальное состояние: пользователь, роль, активный проект */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { reportCatch, reportError } from '@/lib/reportError';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { PaywallModal } from '@/components/renova/PaywallModal';
import { ActionConfirmHost } from '@/components/renova/ActionConfirmHost';
import { replaceOsNav } from '@/lib/pushOsNav';
import { flushOfflineOutbox } from '@/lib/offline';
import { reloadInboxSync } from "@/lib/inboxSyncStore";
import { notifyProjectDataChanged, syncProjectSideEffects } from "@/lib/projectDataBus";

function signalPreviewReady() {
  if (typeof window !== "undefined" && window.parent !== window) {
    window.parent.postMessage({ type: "renova-ready" }, "*");
  }
}

import { showActionConfirm } from '@/lib/actionConfirmBus';
import { CUSTOMER_PRO_LIMIT_NOTICE, canPurchasePro } from '@/lib/paywallPolicy';
import { ApiError, api, isRateLimitError, ProjectDetail, ProjectSummary, User, UserRole } from '@/lib/api';
import { clearAllCachedGets, getRefreshToken, invalidateProjectsCache, setAccessToken, setRefreshToken, setSessionHooks } from '@/lib/api/client';
import { dropJobsForUser } from '@/lib/offlineQueue';
import { router } from 'expo-router';
import { isAuthoritativeSessionFailure } from '@/lib/api/failurePolicy';
import { secureGet, secureSet, secureMultiRemove } from '@/lib/secureTokenStore';
import {
  SESSION_USER_SNAPSHOT_KEY,
  parseSessionUserSnapshot,
  serializeSessionUserSnapshot,
} from '@/lib/sessionSnapshot';
import {
  bootstrapPreviewDemo,
  inferDemoRole,
  isDemoEnabled,
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
import { registerNativePushToken, supportsNativeNotifications } from '@/lib/nativeNotifications';
import { detachPushToken, rememberPushToken } from '@/lib/pushTokenLifecycle';
import {
  NOT_APPLICABLE_TEAM_ACCESS,
  UNRESOLVED_TEAM_ACCESS,
  resolveTeamAccess,
  type TeamAccess,
} from '@/lib/domain/teamAccess';

const LOGIN_TIMEOUT_MS = 15_000;

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

/** Native boundary exits before loading expo-notifications on web. */
function deferPushRegistration(userId: string) {
  setTimeout(() => {
    void registerNativePushToken(async (token) => {
      await api.registerPushToken(userId, token);
      await rememberPushToken(AsyncStorage, token, reportCatch('renovaContext.pushTokenRemember', { userId }));
    })
      .catch(reportCatch('renovaContext.pushRegistration', { userId }));
  }, 0);
}

import { syncCustomerBudgetOnLoad } from '@/lib/customerBudgetMigrate';
import { buildProjectCreatePayload } from '@/lib/wizard/buildProjectCreatePayload';

/** Сколько ждать выгрузки очереди перед выходом. */
const LOGOUT_FLUSH_GRACE_MS = 3_000;

const KEYS = {
  userId: 'renova_user_id',
  userRole: 'renova_user_role',
  userSnapshot: SESSION_USER_SNAPSHOT_KEY,
  projectId: 'renova_project_id',
  accessToken: 'renova_access_token',
  refreshToken: 'renova_refresh_token',
};

async function persistAccessToken(user: { access_token?: string | null; refresh_token?: string | null }) {
  const tok = user.access_token?.trim();
  if (tok) {
    setAccessToken(tok);
    await secureSet(KEYS.accessToken, tok);
  }
  const refresh = user.refresh_token?.trim();
  if (refresh) {
    setRefreshToken(refresh);
    await secureSet(KEYS.refreshToken, refresh);
  }
}

async function persistUserSession(user: User) {
  await persistAccessToken(user);
  await AsyncStorage.multiSet([
    [KEYS.userId, user.id],
    [KEYS.userRole, user.role],
  ]);
  await secureSet(KEYS.userSnapshot, serializeSessionUserSnapshot(user));
}

async function clearAccessToken() {
  setAccessToken(null);
  setRefreshToken(null);
  await secureMultiRemove([KEYS.accessToken, KEYS.refreshToken]);
}


import type { WizardRoomDraft } from '@/constants/roomTypes';
import {
  canPublish,
  describeStaleWrite,
  type SessionStamp,
} from '@/lib/domain/sessionFence';
import { beginSessionAuthority, getSessionStamp } from '@/lib/domain/sessionAuthority';

type WizardDraft = {
  name: string;
  address: string;
  renovation_type: string;
  vat_rate?: 0 | 5 | 10 | 20;
  property_type: 'apartment' | 'house';
  planned_start_date?: string;
  planned_end_date?: string;
  /** Лимит, который заказчик готов вложить (₽) */
  customer_budget?: number;
  rooms: WizardRoomDraft[];
  /** quick = шаблон комнат, detailed = пошагово */
  wizard_mode?: 'quick' | 'detailed';
};

export type ProjectProfilePatch = {
  name?: string;
  address?: string | null;
  renovation_type?: string;
  vat_rate?: 0 | 5 | 10 | 20;
  property_type?: 'apartment' | 'house';
  customer_budget?: number | null;
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
  /** Возвращает пользователя из ответа сервера: реальная роль — user.role (ROLE-014). */
  demoLogin: (role: UserRole) => Promise<User>;
  register: (phone: string, role: UserRole, extra?: { full_name?: string; inn?: string }) => Promise<void>;
  loginWithSms: (phone: string, code: string, role: UserRole, extra?: { full_name?: string; inn?: string }) => Promise<User>;
  refreshProjects: () => Promise<void>;
  refreshMe: () => Promise<void>;
  /** Сброс активного объекта (корзина/архив текущего проекта) */
  clearActiveProject: () => Promise<void>;
  /** `strict` — при лимите запросов бросить понятную ошибку (смена объекта), а не молча остаться на прежнем (HOM-12). */
  loadProject: (id: string, opts?: { strict?: boolean }) => Promise<void>;
  /** Подхват сохранённого объекта — один раз на все разделы OS */
  ensureActiveProject: () => Promise<void>;
  /** Идёт загрузка/восстановление активного объекта */
  projectResolving: boolean;
  /** «Повторить»: перезагрузка данных текущей сессии, без смены аккаунта. */
  recoverSession: () => Promise<void>;
  /** Явный демо-вход (только при EXPO_PUBLIC_DEMO=1). */
  recoverDemo: () => Promise<void>;
  createProjectFromWizard: (extra?: Partial<WizardDraft>) => Promise<CreateProjectResult>;
  updateProjectProfile: (patch: ProjectProfilePatch) => Promise<void>;
  submitStage: (stageId: string) => Promise<void>;
  acceptStage: (stageId: string, opts?: { qualityScore?: number | null; checklist?: string[] }) => Promise<void>;
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
  /**
   * Рубеж сессии (#315). Операции контекста публикуют состояние после
   * нескольких await; за это время человек мог выйти и войти под другим
   * аккаунтом. Метка берётся в начале операции и сверяется перед каждой
   * публикацией, записью в хранилище и рассылкой по шине.
   */
  const sessionStampRef = useRef<SessionStamp>(getSessionStamp());
  const beginSession = useCallback((userId: string | null) => {
    // Общий рубеж (#315): api/client.ts и offlineQueue.ts живут вне React и
    // сверяются с тем же поколением, что и этот ref, через sessionAuthority.
    sessionStampRef.current = beginSessionAuthority(userId);
    return sessionStampRef.current;
  }, []);
  const dropStaleWrite = useCallback((taken: SessionStamp, scope: string) => {
    const current = sessionStampRef.current;
    if (canPublish(taken, current)) return false;
    reportError(
      `lib.context.RenovaContext.${scope}.staleSession`,
      new Error(describeStaleWrite(taken, current)),
      { takenUserId: taken.userId, currentUserId: current.userId },
    );
    return true;
  }, []);
  const [wizard, setWizardState] = useState<WizardDraft>(defaultWizard);
  const [paywallVisible, setPaywallVisible] = useState(false);
  /** Project/portal restriction only. Team restriction is composed separately below. */
  const [readOnly, setReadOnly] = useState(false);
  const [teamAccess, setTeamAccess] = useState<TeamAccess>(NOT_APPLICABLE_TEAM_ACCESS);
  const effectiveReadOnly = readOnly || teamAccess.readOnly;
  const teamRole = teamAccess.role;

  const setWizard = useCallback((p: Partial<WizardDraft>) => {
    setWizardState((w) => ({ ...w, ...p }));
  }, []);

  const applyDegradedIdentity = useCallback((u: User) => {
    beginSession(u.id);
    setUser(u);
    setReadOnly(false);
    setTeamAccess(u.role === 'contractor' ? UNRESOLVED_TEAM_ACCESS : NOT_APPLICABLE_TEAM_ACCESS);
  }, []);

  const refreshTeamAccess = useCallback(async (u: User) => {
    if (u.role !== 'contractor') {
      setTeamAccess(NOT_APPLICABLE_TEAM_ACCESS);
      return;
    }

    // While authorization is being resolved, writes are disabled. A project refresh
    // cannot override this because teamAccess is composed separately from readOnly.
    setTeamAccess(UNRESOLVED_TEAM_ACCESS);
    try {
      const team = await api.getTeam(u.id);
      setTeamAccess(resolveTeamAccess({ userId: u.id, userRole: u.role, team }));
    } catch (error) {
      setTeamAccess(UNRESOLVED_TEAM_ACCESS);
      reportError('renovaContext.teamAccess', error, { userId: u.id });
    }
  }, []);

  const refreshProjects = useCallback(async () => {
    if (!user) return;
    const stamp = sessionStampRef.current;
    const raw = await api.listProjects(user.id);
    // Между запросами человек мог выйти и войти под другим аккаунтом: чужой
    // список объектов нельзя ни догружать, ни публиковать.
    if (dropStaleWrite(stamp, 'refreshProjects')) return;
    const list = await enrichProjectsPendingPayments(user.id, raw, user.role);
    if (dropStaleWrite(stamp, 'refreshProjects')) return;
    setProjects(list);
  }, [user, dropStaleWrite]);

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
    await persistUserSession(u);
    setUser(u);
    await refreshTeamAccess(u);
  }, [user?.id, refreshTeamAccess]);

  const loadProject = useCallback(
    async (id: string, opts?: { strict?: boolean }) => {
      if (!user) return;
      const stamp = sessionStampRef.current;
      setProjectResolving(true);
      ensureAttemptKeyRef.current = null;
      try {
        let p = await api.getProject(user.id, id);
        if (dropStaleWrite(stamp, 'loadProject')) return;
        if (user.role === 'contractor' && !p) throw new Error('not found');
        // Исполнитель больше не «назначает себя» при открытии объекта (ROLE-028):
        // желание вести объект — заявка, которую подтверждает заказчик.
        p = await syncCustomerBudgetOnLoad(user, p);
        // Последняя проверка перед публикацией: дальше идут глобальное
        // состояние, постоянное хранилище и рассылка по шине.
        if (dropStaleWrite(stamp, 'loadProject')) return;
        setActiveProject(p);
        setReadOnly(!!p?.read_only);
        await AsyncStorage.setItem(KEYS.projectId, id);
        await AsyncStorage.setItem(SESSION_KEYS.projectExplicitlyPicked, '1');
        await AsyncStorage.removeItem(SESSION_KEYS.pendingProjectPick);
        notifyProjectDataChanged();
        // Inbox/чат — не блокируем вход в объект (раньше ждал buildInboxItems → «Выберите объект» висел)
        void reloadInboxSync({
          userId: user.id,
          userRole: user.role,
          projectId: id,
          project: p,
          osRole: user.role === 'contractor' ? 'contractor' : 'customer',
        }).catch(reportCatch('renovaContext'));
      } catch (e) {
        // Duck-typed rate_limit (HMR) — не роняем UI, оставляем текущий activeProject
        const limited = isRateLimitError(e) || (e instanceof Error && /rate_limit/i.test(e.message));
        if (limited) {
          if (opts?.strict) throw new Error('Слишком много запросов. Подождите минуту и откройте объект ещё раз.');
          return;
        }
        throw e;
      } finally {
        setProjectResolving(false);
      }
    },
    [user, dropStaleWrite],
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
      /* silent-catch-ok: keep ref to avoid infinite retry; explicit project selection resets it */
    }
  }, [user, activeProject, projects, projectResolving, loadProject]);

  useEffect(() => {
    ensureAttemptKeyRef.current = null;
  }, [projects.map((p) => p.id).join('|')]);

  /** Применить пользователя + проекты + активный объект после bootstrap/recovery */
  const applySession = useCallback(async (u: User, list: ProjectSummary[]) => {
    await persistUserSession(u);
    beginSession(u.id);
    setUser(u);
    setReadOnly(false);
    const enriched = await enrichProjectsPendingPayments(u.id, list, u.role);
    setProjects(enriched);
    await refreshTeamAccess(u);
    const pendingPick = await AsyncStorage.getItem(SESSION_KEYS.pendingProjectPick);
    // pendingProjectPick=1 — только явный экран выбора (onboarding); demo auto-load ниже
    if (pendingPick === '1') {
      setActiveProject(null);
      setReadOnly(false);
      return;
    }
    const pid = await AsyncStorage.getItem(KEYS.projectId);
    const role = inferDemoRole(u, await AsyncStorage.getItem(KEYS.userRole));
    const demoPick =
      isDemoPhone(u.phone) && enriched.length > 0
        ? pickPrimaryDemoProject(enriched)?.id ?? enriched[0]?.id
        : null;
    let p = await loadActiveProject(u.id, enriched, demoPick ?? pid, role);
    if (p) {
      p = await syncCustomerBudgetOnLoad(u, p);
      setReadOnly(!!p.read_only);
      setActiveProject(p);
      if (isDemoPhone(u.phone)) {
        await AsyncStorage.setItem(SESSION_KEYS.projectExplicitlyPicked, '1');
        await AsyncStorage.removeItem(SESSION_KEYS.pendingProjectPick);
      }
    } else {
      setActiveProject(null);
      setReadOnly(false);
    }
  }, [refreshTeamAccess, beginSession]);

  /** Перезагрузка проектов/активного объекта текущего пользователя (CMP-008). */
  const recoverSession = useCallback(async () => {
    const reachable = await pingApi();
    setApiReachable(reachable);
    if (!reachable || !user) return;
    const storedRole = await AsyncStorage.getItem(KEYS.userRole);
    const role = inferDemoRole(user, storedRole);
    await invalidateProjectsCache(user.id);
    await refreshTeamAccess(user);
    const raw = await listProjectsWithRetry(user.id, 4);
    const list = await enrichProjectsPendingPayments(user.id, raw, user.role);
    setProjects(list);
    const pending = await AsyncStorage.getItem(SESSION_KEYS.pendingProjectPick);
    if (pending === '1') {
      setActiveProject(null);
      setReadOnly(false);
      return;
    }
    if (list.length) {
      let p = await loadActiveProject(user.id, list, await AsyncStorage.getItem(KEYS.projectId), role);
      if (p) {
        p = await syncCustomerBudgetOnLoad(user, p);
        setActiveProject(p);
        setReadOnly(!!p.read_only);
      }
    }
  }, [user, refreshTeamAccess]);

  /** Явное действие «Демо»: подменяет сессию демо-аккаунтом, поэтому только при EXPO_PUBLIC_DEMO=1. */
  const recoverDemo = useCallback(async () => {
    if (!isDemoEnabled()) return;
    const reachable = await pingApi();
    setApiReachable(reachable);
    if (!reachable) return;
    const storedRole = await AsyncStorage.getItem(KEYS.userRole);
    const recovered = await recoverDemoSession(inferDemoRole(user, storedRole));
    await applySession(recovered.user, recovered.projects);
  }, [user, applySession]);

  useEffect(() => {
    (async () => {
      try {
        const reachable = await pingApi();
        setApiReachable(reachable);

        const [uid, storedRole, storedSnapshot, storedTok, storedRefresh] = await Promise.all([
          AsyncStorage.getItem(KEYS.userId),
          AsyncStorage.getItem(KEYS.userRole),
          secureGet(KEYS.userSnapshot),
          secureGet(KEYS.accessToken),
          secureGet(KEYS.refreshToken),
        ]);
        if (storedTok) setAccessToken(storedTok);
        if (storedRefresh) setRefreshToken(storedRefresh);

        // Preview iframe: автодемо без ручного онбординга
        if (!uid && isPreviewFrame() && reachable) {
          const preview = await bootstrapPreviewDemo();
          if (preview) {
            await applySession(preview.user, preview.projects);
            return;
          }
        }

        if (!uid) return;

        // Холодный старт: метка сессии должна знать userId ДО api.me(uid), иначе
        // authHeaders() (#315) не приложит Bearer к запросу с чужим/пустым userId
        // и восстановление сессии заканчивается 401 → выходом.
        if (storedTok) beginSession(uid);

        const expectedRole = storedRole === 'customer' || storedRole === 'contractor' ? storedRole : null;
        const snapshot = parseSessionUserSnapshot(storedSnapshot, { id: uid, role: expectedRole });

        // Known-offline cold start must never probe /me and convert transport failure into logout.
        // Restore identity only; contractor writes remain fail-closed until team access is revalidated.
        if (!reachable) {
          if (snapshot) applyDegradedIdentity(snapshot);
          return;
        }

        let u: User;
        try {
          u = await api.me(uid);
          await persistUserSession(u);
          // Establish identity before secondary project/team loads so a later transient
          // dependency failure cannot make the app look logged out.
          applyDegradedIdentity(u);
        } catch (error) {
          if (!isAuthoritativeSessionFailure(error)) {
            setApiReachable(false);
            reportError('renovaContext.sessionBootstrapTransient', error, { userId: uid });
            if (snapshot) applyDegradedIdentity(snapshot);
            return;
          }

          await AsyncStorage.multiRemove([
            KEYS.userId,
            KEYS.userRole,
            KEYS.projectId,
            KEYS.accessToken,
            KEYS.refreshToken,
          ]);
          await secureMultiRemove([KEYS.userSnapshot]);
          await clearAccessToken();
          // Без EXPO_PUBLIC_DEMO сессия окончена: остаёмся на экране входа, а не
          // стучимся в demo-login, который в prod отвечает 404 (CMP-008).
          if (!isDemoEnabled()) return;
          const recovered = await recoverDemoSession(inferDemoRole(null, storedRole));
          if (recovered) await applySession(recovered.user, recovered.projects);
          return;
        }

        deferPushRegistration(u.id);

        let list = await listProjectsWithRetry(u.id);

        // Пустой список или устаревший userId — пересинхронизация с демо
        if (list.length === 0) {
          const role = inferDemoRole(u, storedRole);
          if (isDemoEnabled() && (isDemoPhone(u.phone) || storedRole === 'customer' || storedRole === 'contractor')) {
            const recovered = await recoverDemoSession(role);
            if (recovered) {
              u = recovered.user;
              list = recovered.projects;
            }
          }
        }

        await applySession(u, list);
      } catch (error) {
        // Environment/secondary bootstrap failure keeps persisted session intact.
        setApiReachable(false);
        reportError('renovaContext.bootstrap', error);
      } finally {
        try {
          await flushOfflineOutbox();  // W93: session boot → канон flush + buses
        } catch (error) {
          reportError('renovaContext.bootstrap.flushOfflineOutbox', error);
        }
        setLoading(false);
        signalPreviewReady();
      }
    })();
  }, [applySession, applyDegradedIdentity]);


  const demoLogin = useCallback(async (role: UserRole): Promise<User> => {
    const u = await withTimeout(api.demoLogin(role), LOGIN_TIMEOUT_MS, 'Превышено время ожидания сервера');
    await persistUserSession(u);
    beginSession(u.id);
    setUser(u);
    setReadOnly(false);
    await refreshTeamAccess(u);
    deferPushRegistration(u.id);
    let list: ProjectSummary[] = [];
    try {
      const raw = await withTimeout(listProjectsWithRetry(u.id, 4), LOGIN_TIMEOUT_MS, 'Превышено время ожидания загрузки проектов');
      list = await enrichProjectsPendingPayments(u.id, raw, role);
    } catch (error) {
      reportError('renovaContext.demoLogin.projects', error, { userId: u.id, role });
      list = [];
    }
    setProjects(list);
    setActiveProject(null);
    setReadOnly(false);
    await AsyncStorage.removeItem(KEYS.projectId);
    await AsyncStorage.removeItem(SESSION_KEYS.projectExplicitlyPicked);
    await AsyncStorage.setItem(SESSION_KEYS.pendingProjectPick, '1');
    return u;
  }, [refreshTeamAccess, beginSession]);


  const loginWithSms = useCallback(async (phone: string, code: string, role: UserRole, extra?: { full_name?: string; inn?: string }): Promise<User> => {
    const u = await api.verifySmsCode(phone, code, role, extra);
    await persistUserSession(u);
    beginSession(u.id);
    setUser(u);
    setReadOnly(false);
    await refreshTeamAccess(u);
    const raw = await api.listProjects(u.id);
    const list = await enrichProjectsPendingPayments(u.id, raw, role);
    setProjects(list);
    const saved = await AsyncStorage.getItem(KEYS.projectId);
    const pickId = saved ? resolveActiveProjectId(list, saved) : null;
    if (pickId) {
      let detail = await api.getProject(u.id, pickId);
      detail = await syncCustomerBudgetOnLoad(u, detail);
      setActiveProject(detail);
      setReadOnly(!!detail.read_only);
      await AsyncStorage.setItem(KEYS.projectId, pickId);
      await AsyncStorage.removeItem(SESSION_KEYS.pendingProjectPick);
    } else {
      setActiveProject(null);
      setReadOnly(false);
      await AsyncStorage.removeItem(KEYS.projectId);
      await AsyncStorage.setItem(SESSION_KEYS.pendingProjectPick, '1');
    }
    deferPushRegistration(u.id);
    return u;
  }, [refreshTeamAccess, beginSession]);

  const register = useCallback(async (phone: string, role: UserRole, extra?: { full_name?: string; inn?: string }) => {
    const u = await api.register({ phone, role, ...extra });
    await persistUserSession(u);
    beginSession(u.id);
    setUser(u);
    setReadOnly(false);
    await refreshTeamAccess(u);
    deferPushRegistration(u.id);
    if (role === 'contractor') {
      const raw = await api.listProjects(u.id);
      const list = await enrichProjectsPendingPayments(u.id, raw, role);
      setProjects(list);
    }
  }, [refreshTeamAccess, beginSession]);

  const createProjectFromWizard = useCallback(async (extra?: Partial<WizardDraft>): Promise<CreateProjectResult> => {
    if (!user) throw new Error('no user');
    const draft = { ...wizard, ...extra };
    if (!draft.name.trim()) throw new Error('Укажите название проекта');
    const body = buildProjectCreatePayload(draft);
    const created = await api.createProject(user.id, body);
    let detail = created;
    const requestedLimit = normalizeCustomerBudget(draft.customer_budget);
    if (requestedLimit) {
      try {
        detail = await api.patchProject(user.id, created.id, { customer_budget: requestedLimit });
      } catch (error) {
        // Project creation already committed. Preserve the local draft limit and
        // report unsynced budget instead of turning the whole creation into a
        // false failure.
        reportError('projectWizard.customerBudget.persist', error, { projectId: created.id });
      }
      try {
        await setCustomerBudget(created.id, normalizeCustomerBudget(detail.customer_budget) ?? requestedLimit);
      } catch (error) {
        reportError('projectWizard.customerBudget.cache', error, { projectId: created.id });
      }
    }
    try {
      detail = await api.getProject(user.id, created.id);
    } catch {
      /* silent-catch-ok: POST/PATCH response is sufficient as the committed project fallback */
    }
    // HOM-02: объект уже создан — ни один шаг ниже не должен бросить исключение,
    // иначе «Повторить» в мастере создаст второй такой же объект.
    try {
      const refreshed = await enrichProjectsPendingPayments(user.id, await api.listProjects(user.id), user.role as UserRole);
      setProjects(refreshed);
      const junkWizard = isDemoPhone(user.phone) && isJunkProjectName(created.name);
      if (junkWizard) {
        const primary = pickPrimaryDemoProject(refreshed);
        const primaryId = primary?.id;
        if (primaryId) {
          const primaryDetail = await api.getProject(user.id, primaryId);
          setActiveProject(primaryDetail);
          setReadOnly(!!primaryDetail.read_only);
          await AsyncStorage.setItem(KEYS.projectId, primaryId);
          await AsyncStorage.removeItem(SESSION_KEYS.pendingProjectPick);
          setWizardState(defaultWizard);
          return {
            id: created.id,
            demoKeptPrimary: { createdName: created.name, activeName: primary?.name || primaryDetail.name },
          };
        }
      }
    } catch (error) {
      reportError('projectWizard.afterCreate.refreshList', error, { projectId: created.id });
    }
    setActiveProject(detail);
    setReadOnly(!!detail.read_only);
    try {
      await AsyncStorage.setItem(KEYS.projectId, created.id);
      await AsyncStorage.setItem(SESSION_KEYS.projectExplicitlyPicked, '1');
      await AsyncStorage.removeItem(SESSION_KEYS.pendingProjectPick);
    } catch (error) {
      reportError('projectWizard.afterCreate.persistActive', error, { projectId: created.id });
    }
    await refreshProjects().catch((error: unknown) => {
      reportError('projectWizard.afterCreate.refreshProjects', error, { projectId: created.id });
    });
    // HOM-19: черновик мастера не должен переходить в следующий «Новый проект».
    setWizardState(defaultWizard);
    return { id: created.id };
  }, [user, wizard, refreshProjects]);

  const updateProjectProfile = useCallback(async (patch: ProjectProfilePatch) => {
    if (!user || !activeProject) throw new Error('no project');
    const body: Record<string, unknown> = { ...patch };
    if (patch.address === undefined) delete body.address;
    if (patch.customer_budget === undefined) delete body.customer_budget;

    // This is the commit boundary. Everything below must be non-destructive
    // follow-up work so a successful PATCH is never reported as failed.
    const p = await api.patchProject(user.id, activeProject.id, body);

    if (patch.customer_budget !== undefined) {
      const limit = normalizeCustomerBudget(p.customer_budget) ?? normalizeCustomerBudget(patch.customer_budget);
      try {
        await setCustomerBudget(activeProject.id, limit);
      } catch (error) {
        reportError('projectProfile.cacheBudget', error, { projectId: activeProject.id });
      }
    }
    setActiveProject(p);
    setReadOnly(!!p.read_only);

    try {
      await refreshProjects();
    } catch (error) {
      reportError('projectProfile.refreshProjects', error, { projectId: activeProject.id });
    }

    // W88: профиль/бюджет объекта → home insights + inbox
    try {
      await syncProjectSideEffects({ user, project: p });
    } catch (error) {
      reportError('projectProfile.sideEffects', error, { projectId: activeProject.id });
    }
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
      // offline_queued пробрасываем: приёмка поставлена в очередь, а не выполнена —
      // экран не должен говорить «Этап принят» и открывать оплату (REP-03).
      await api.acceptStage(user.id, activeProject.id, stageId, opts);
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
      ensureActiveProject().catch(reportCatch('renovaContext'));
    });
  }, [loading, user?.id, activeProject?.id, projects.length, ensureActiveProject]);

  const endReasonRef = useRef<'user' | 'expired'>('user');
  const logoutRef = useRef<() => Promise<void>>(async () => undefined);

  const logout = useCallback(async () => {
    const expired = endReasonRef.current === 'expired';
    endReasonRef.current = 'user';
    // Серверный отзыв — ДО очистки локальных токенов (после неё refresh уже не достать).
    // Токен и поколение берём синхронно: если за время запроса вошёл другой аккаунт,
    // локальную очистку пропускаем — иначе снесём чужую новую сессию (#315).
    const refresh = getRefreshToken();
    const stamp = getSessionStamp();
    if (refresh && !expired) {
      // CMP-016: задания выходящего пользователя после выхода удаляются — даём очереди
      // короткий шанс уйти на сервер (офлайн/сбой не задерживает выход дольше окна).
      await Promise.race([
        flushOfflineOutbox().catch(reportCatch('renovaContext.logoutFlush')),
        new Promise<void>((resolve) => setTimeout(resolve, LOGOUT_FLUSH_GRACE_MS)),
      ]);
    }
    if (stamp.userId && !expired && supportsNativeNotifications()) {
      // COM-017: отвязать push-токен ДО очистки токенов сессии (нужен действующий access).
      // Сбой/таймаут отвязки не блокирует выход.
      await detachPushToken({
        storage: AsyncStorage,
        unregister: (token) => api.unregisterPushToken(stamp.userId as string, token),
        onError: (error) => reportError('renovaContext.logoutPushDetach', error, { userId: stamp.userId }),
      });
    }
    if (refresh) {
      try {
        await api.logout(refresh);
      } catch (error) {
        // Сбой отзыва не блокирует локальный выход, но не теряется молча.
        reportError('renovaContext.logoutRevoke', error, { userId: stamp.userId });
      }
    }
    if (getSessionStamp().generation !== stamp.generation) return;
    await AsyncStorage.multiRemove([
      KEYS.userId,
      KEYS.userRole,
      KEYS.projectId,
      KEYS.accessToken,
      KEYS.refreshToken,
      SESSION_KEYS.pendingProjectPick,
      SESSION_KEYS.projectExplicitlyPicked,
    ]);
    await secureMultiRemove([KEYS.userSnapshot]);
    await clearAccessToken();
    // CMP-016: durable-кэш GET и очередь вышедшего пользователя не доживают до следующего аккаунта.
    // При истечении сессии очередь сохраняем: после повторного входа владельца она уйдёт (#315).
    await clearAllCachedGets();
    if (!expired && stamp.userId) {
      try {
        await dropJobsForUser(stamp.userId);
      } catch (error) {
        reportError('renovaContext.logoutDropQueue', error, { userId: stamp.userId });
      }
    }
    beginSession(null);
    setUser(null);
    setProjects([]);
    setActiveProject(null);
    setReadOnly(false);
    setTeamAccess(NOT_APPLICABLE_TEAM_ACCESS);
    setWizardState(defaultWizard);
  }, []);

  logoutRef.current = logout;

  // CMP-002/CMP-003: клиент сообщает о ротации токенов и об окончательном отказе авторизации.
  useEffect(() => setSessionHooks({
    onTokensRotated: async (tokens, stamp) => {
      if (getSessionStamp().generation !== stamp.generation) return;
      // Сначала refresh: если запись оборвётся, пара «старый access + новый refresh» восстановима.
      if (tokens.refresh) await secureSet(KEYS.refreshToken, tokens.refresh);
      if (getSessionStamp().generation !== stamp.generation) return;
      await secureSet(KEYS.accessToken, tokens.access);
    },
    onSessionExpired: async (stamp) => {
      if (getSessionStamp().generation !== stamp.generation) return;
      endReasonRef.current = 'expired';
      await logoutRef.current();
      showActionConfirm({ title: 'Сессия истекла', message: 'Сессия истекла. Войдите снова' });
      try {
        router.replace('/onboarding/role' as never);
      } catch (error) {
        reportError('renovaContext.sessionExpiredNav', error);
      }
    },
  }), []);

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
      recoverDemo,
      createProjectFromWizard,
      updateProjectProfile,
      submitStage,
      acceptStage,
      rejectStage,
      logout,
      paywallVisible,
      // ROLE-011: покупать Pro может только исполнитель; заказчику — объяснение без кнопки покупки.
      showPaywall: () => {
        if (canPurchasePro(user?.role)) setPaywallVisible(true);
        else showActionConfirm({ ...CUSTOMER_PRO_LIMIT_NOTICE, primaryLabel: 'Понятно', onPrimary: () => undefined });
      },
      hidePaywall: () => setPaywallVisible(false),
      readOnly: effectiveReadOnly,
      teamRole,
      isContractorOwner: Boolean(
        user?.role === 'contractor'
        && teamAccess.ownerLike
        && activeProject
        && activeProject.contractor_id === user.id
      ),
    }),
    [loading, apiReachable, user, projects, activeProject, projectResolving, wizard, setWizard, demoLogin, register, loginWithSms, refreshProjects, refreshMe, clearActiveProject, loadProject, ensureActiveProject, recoverSession, recoverDemo, createProjectFromWizard, updateProjectProfile, submitStage, acceptStage, rejectStage, logout, paywallVisible, effectiveReadOnly, teamRole, teamAccess.ownerLike],
  );

  return (
    <RenovaContext.Provider value={value}>
      {children}
      {/* Clarity E: post-action sheet для offline / warranty / closeout */}
      <ActionConfirmHost />
      {paywallVisible && user && (
        <PaywallModal
          visible={paywallVisible}
          onClose={() => setPaywallVisible(false)}
          onUpgrade={async () => {
            await api.checkoutPro(user.id);
            setPaywallVisible(false);
            replaceOsNav('/subscription', undefined, 'contractor');
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