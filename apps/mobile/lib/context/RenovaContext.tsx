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

import { ApiError, api, isRateLimitError, ProjectDetail, ProjectSummary, User, UserRole } from '@/lib/api';
import {
  clearSessionTokens,
  getRefreshToken,
  persistSessionTokens,
  setAccessToken,
  setRefreshToken,
} from '@/lib/api/client';
import { isAuthoritativeSessionFailure } from '@/lib/api/failurePolicy';
import { secureGet, secureMultiRemove, secureSet } from '@/lib/secureTokenStore';
import {
  assertSessionAuthorityCurrent,
  beginSessionAuthority,
  captureSessionAuthority,
  invalidateSessionAuthority,
  isSessionAuthorityCurrent,
  restoreSessionAuthority,
  type SessionAuthoritySnapshot,
  withSessionAuthorityWrite,
} from '@/lib/sessionAuthority';
import {
  SESSION_USER_SNAPSHOT_KEY,
  parseSessionUserSnapshot,
  serializeSessionUserSnapshot,
} from '@/lib/sessionSnapshot';
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
import { registerNativePushToken } from '@/lib/nativeNotifications';
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
    void registerNativePushToken((token) => api.registerPushToken(userId, token))
      .catch(reportCatch('renovaContext.pushRegistration', { userId }));
  }, 0);
}

import { syncCustomerBudgetOnLoad } from '@/lib/customerBudgetMigrate';
import { buildProjectCreatePayload } from '@/lib/wizard/buildProjectCreatePayload';

const KEYS = {
  userId: SESSION_KEYS.userId,
  userRole: SESSION_KEYS.userRole,
  userSnapshot: SESSION_USER_SNAPSHOT_KEY,
  projectId: SESSION_KEYS.projectId,
  accessToken: SESSION_KEYS.accessToken,
  refreshToken: SESSION_KEYS.refreshToken,
  sessionAuthorityId: SESSION_KEYS.sessionAuthorityId,
};

function isSessionGenerationChanged(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  return (error as { code?: unknown }).code === 'session_generation_changed';
}

async function persistAccessToken(
  user: { access_token?: string | null; refresh_token?: string | null },
  authority: SessionAuthoritySnapshot,
) {
  const tok = user.access_token?.trim() || null;
  const refresh = user.refresh_token?.trim() || null;
  if (!tok && !refresh) return;
  const published = await persistSessionTokens(tok, refresh, authority);
  if (!published) throw new Error('session_generation_changed');
}

async function persistUserSession(
  user: User,
  authority: SessionAuthoritySnapshot = captureSessionAuthority(),
) {
  if (authority.userId !== user.id || !authority.sessionId) throw new Error('session_generation_changed');
  await persistAccessToken(user, authority);
  await withSessionAuthorityWrite(authority, async () => {
    await AsyncStorage.multiSet([
      [KEYS.userId, user.id],
      [KEYS.userRole, user.role],
      [KEYS.sessionAuthorityId, authority.sessionId!],
    ]);
    await secureSet(KEYS.userSnapshot, serializeSessionUserSnapshot(user));
  });
}

async function persistRestoredAuthority(authority: SessionAuthoritySnapshot) {
  if (!authority.sessionId) return;
  await withSessionAuthorityWrite(authority, () =>
    AsyncStorage.setItem(KEYS.sessionAuthorityId, authority.sessionId!),
  );
}

async function clearAccessToken(authority: SessionAuthoritySnapshot = captureSessionAuthority()) {
  await clearSessionTokens(authority);
}


import type { WizardRoomDraft } from '@/constants/roomTypes';

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

export type ProjectLoadOutcome =
  | { status: 'loaded'; projectId: string }
  | { status: 'cancelled'; projectId: string }
  | { status: 'degraded'; projectId: string; reason: 'rate_limit' };

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
  loadProject: (id: string) => Promise<ProjectLoadOutcome>;
  /** Подхват сохранённого объекта — один раз на все разделы OS */
  ensureActiveProject: () => Promise<void>;
  /** Идёт загрузка/восстановление активного объекта */
  projectResolving: boolean;
  recoverSession: () => Promise<void>;
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
  const loginAttemptRef = useRef(0);
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
    const authority = captureSessionAuthority();
    if (authority.userId !== u.id || !authority.sessionId) return;
    setUser(u);
    setReadOnly(false);
    setTeamAccess(u.role === 'contractor' ? UNRESOLVED_TEAM_ACCESS : NOT_APPLICABLE_TEAM_ACCESS);
  }, []);

  const refreshTeamAccess = useCallback(async (u: User) => {
    const authority = captureSessionAuthority();
    if (authority.userId !== u.id || !authority.sessionId) return;
    if (u.role !== 'contractor') {
      if (isSessionAuthorityCurrent(authority)) setTeamAccess(NOT_APPLICABLE_TEAM_ACCESS);
      return;
    }

    if (isSessionAuthorityCurrent(authority)) setTeamAccess(UNRESOLVED_TEAM_ACCESS);
    try {
      const team = await api.getTeam(u.id);
      if (!isSessionAuthorityCurrent(authority)) return;
      setTeamAccess(resolveTeamAccess({ userId: u.id, userRole: u.role, team }));
    } catch (error) {
      if (!isSessionAuthorityCurrent(authority)) return;
      setTeamAccess(UNRESOLVED_TEAM_ACCESS);
      reportError('renovaContext.teamAccess', error, { userId: u.id });
    }
  }, []);

  const refreshProjects = useCallback(async () => {
    if (!user) return;
    const authority = captureSessionAuthority();
    if (authority.userId !== user.id || !authority.sessionId) return;
    const raw = await api.listProjects(user.id);
    const list = await enrichProjectsPendingPayments(user.id, raw, user.role);
    if (!isSessionAuthorityCurrent(authority)) return;
    setProjects(list);
  }, [user]);

  const clearActiveProject = useCallback(async () => {
    const authority = captureSessionAuthority();
    if (!authority.sessionId) return;
    setActiveProject(null);
    setReadOnly(false);
    await withSessionAuthorityWrite(authority, async () => {
      await AsyncStorage.removeItem(KEYS.projectId);
      await AsyncStorage.removeItem(SESSION_KEYS.projectExplicitlyPicked);
      await AsyncStorage.setItem(SESSION_KEYS.pendingProjectPick, '1');
    });
  }, []);

  const refreshMe = useCallback(async () => {
    if (!user) return;
    const authority = captureSessionAuthority();
    if (authority.userId !== user.id || !authority.sessionId) return;
    const u = await api.me(user.id);
    assertSessionAuthorityCurrent(authority);
    await persistUserSession(u, authority);
    assertSessionAuthorityCurrent(authority);
    setUser(u);
    await refreshTeamAccess(u);
  }, [user?.id, refreshTeamAccess]);

  const loadProject = useCallback(
    async (id: string): Promise<ProjectLoadOutcome> => {
      if (!user) return { status: 'cancelled', projectId: id };
      const authority = captureSessionAuthority();
      if (authority.userId !== user.id || !authority.sessionId) {
        return { status: 'cancelled', projectId: id };
      }
      setProjectResolving(true);
      ensureAttemptKeyRef.current = null;
      try {
        let p = await api.getProject(user.id, id);
        assertSessionAuthorityCurrent(authority);
        if (user.role === 'contractor' && !p) throw new Error('not found');
        // Read selection must stay read-only. Contractor assignment is an explicit
        // business mutation elsewhere; selecting a readable project cannot assign it.
        p = await syncCustomerBudgetOnLoad(user, p);
        assertSessionAuthorityCurrent(authority);
        setActiveProject(p);
        setReadOnly(!!p?.read_only);
        await withSessionAuthorityWrite(authority, async () => {
          await AsyncStorage.setItem(KEYS.projectId, id);
          await AsyncStorage.setItem(SESSION_KEYS.projectExplicitlyPicked, '1');
          await AsyncStorage.removeItem(SESSION_KEYS.pendingProjectPick);
        });
        assertSessionAuthorityCurrent(authority);
        notifyProjectDataChanged();
        void reloadInboxSync({
          userId: user.id,
          userRole: user.role,
          projectId: id,
          project: p,
          osRole: user.role === 'contractor' ? 'contractor' : 'customer',
        }).catch((error) => {
          if (isSessionAuthorityCurrent(authority)) reportError('renovaContext.inboxReload', error, { projectId: id });
        });
        return { status: 'loaded', projectId: id };
      } catch (e) {
        if (isSessionGenerationChanged(e) || !isSessionAuthorityCurrent(authority)) {
          return { status: 'cancelled', projectId: id };
        }
        if (isRateLimitError(e) || (e instanceof Error && /rate_limit/i.test(e.message))) {
          return { status: 'degraded', projectId: id, reason: 'rate_limit' };
        }
        throw e;
      } finally {
        if (isSessionAuthorityCurrent(authority)) setProjectResolving(false);
      }
    },
    [user],
  );

  const ensureActiveProject = useCallback(async () => {
    if (!user || activeProject || !projects.length || projectResolving) return;
    const authority = captureSessionAuthority();
    if (authority.userId !== user.id || !authority.sessionId) return;
    const pending = await AsyncStorage.getItem(SESSION_KEYS.pendingProjectPick);
    if (!isSessionAuthorityCurrent(authority) || pending === '1') return;
    const saved = await AsyncStorage.getItem(KEYS.projectId);
    if (!isSessionAuthorityCurrent(authority)) return;
    const pickId = resolveActiveProjectId(projects, saved);
    if (!pickId) return;
    const attemptKey = `${authority.sessionId}:${pickId}`;
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
    const hasFreshCredentials = Boolean(u.access_token?.trim() || u.refresh_token?.trim());
    let authority = captureSessionAuthority();
    if (hasFreshCredentials || authority.userId !== u.id || !authority.sessionId) {
      authority = beginSessionAuthority(u.id);
    }
    await persistUserSession(u, authority);
    assertSessionAuthorityCurrent(authority);
    setUser(u);
    setReadOnly(false);
    const enriched = await enrichProjectsPendingPayments(u.id, list, u.role);
    assertSessionAuthorityCurrent(authority);
    setProjects(enriched);
    await refreshTeamAccess(u);
    assertSessionAuthorityCurrent(authority);
    const pendingPick = await AsyncStorage.getItem(SESSION_KEYS.pendingProjectPick);
    assertSessionAuthorityCurrent(authority);
    if (pendingPick === '1') {
      setActiveProject(null);
      setReadOnly(false);
      return;
    }
    const pid = await AsyncStorage.getItem(KEYS.projectId);
    assertSessionAuthorityCurrent(authority);
    const role = inferDemoRole(u, await AsyncStorage.getItem(KEYS.userRole));
    assertSessionAuthorityCurrent(authority);
    const demoPick =
      isDemoPhone(u.phone) && enriched.length > 0
        ? pickPrimaryDemoProject(enriched)?.id ?? enriched[0]?.id
        : null;
    let p = await loadActiveProject(u.id, enriched, demoPick ?? pid, role);
    assertSessionAuthorityCurrent(authority);
    if (p) {
      p = await syncCustomerBudgetOnLoad(u, p);
      assertSessionAuthorityCurrent(authority);
      setReadOnly(!!p.read_only);
      setActiveProject(p);
      if (isDemoPhone(u.phone)) {
        await withSessionAuthorityWrite(authority, async () => {
          await AsyncStorage.setItem(SESSION_KEYS.projectExplicitlyPicked, '1');
          await AsyncStorage.removeItem(SESSION_KEYS.pendingProjectPick);
        });
      }
    } else {
      setActiveProject(null);
      setReadOnly(false);
    }
  }, [refreshTeamAccess]);

  const recoverSession = useCallback(async () => {
    const reachable = await pingApi();
    setApiReachable(reachable);
    if (!reachable) return;
    const storedRole = await AsyncStorage.getItem(KEYS.userRole);
    const role = inferDemoRole(user, storedRole);
    const recovered = await recoverDemoSession(role);
    if (recovered) {
      await applySession(recovered.user, recovered.projects);
      return;
    }
    if (user) {
      const authority = captureSessionAuthority();
      await refreshTeamAccess(user);
      const raw = await listProjectsWithRetry(user.id, 4);
      const list = await enrichProjectsPendingPayments(user.id, raw, user.role);
      if (!isSessionAuthorityCurrent(authority)) return;
      setProjects(list);
      const pending = await AsyncStorage.getItem(SESSION_KEYS.pendingProjectPick);
      if (!isSessionAuthorityCurrent(authority) || pending === '1') {
        if (isSessionAuthorityCurrent(authority)) {
          setActiveProject(null);
          setReadOnly(false);
        }
        return;
      }
      if (list.length) {
        let p = await loadActiveProject(user.id, list, await AsyncStorage.getItem(KEYS.projectId), role);
        if (!isSessionAuthorityCurrent(authority)) return;
        if (p) {
          p = await syncCustomerBudgetOnLoad(user, p);
          if (!isSessionAuthorityCurrent(authority)) return;
          setActiveProject(p);
          setReadOnly(!!p.read_only);
        }
      }
    }
  }, [user, applySession, refreshTeamAccess]);

  useEffect(() => {
    (async () => {
      try {
        const reachable = await pingApi();
        setApiReachable(reachable);

        const [uid, storedRole, storedSnapshot, storedTok, storedRefresh, storedAuthorityId] = await Promise.all([
          AsyncStorage.getItem(KEYS.userId),
          AsyncStorage.getItem(KEYS.userRole),
          secureGet(KEYS.userSnapshot),
          secureGet(KEYS.accessToken),
          secureGet(KEYS.refreshToken),
          AsyncStorage.getItem(KEYS.sessionAuthorityId),
        ]);

        let bootstrapAuthority: SessionAuthoritySnapshot | null = null;
        if (uid) {
          bootstrapAuthority = restoreSessionAuthority(uid, storedAuthorityId);
          if (!storedAuthorityId) await persistRestoredAuthority(bootstrapAuthority);
          if (storedTok) setAccessToken(storedTok);
          if (storedRefresh) setRefreshToken(storedRefresh);
        } else {
          invalidateSessionAuthority();
          setAccessToken(null);
          setRefreshToken(null);
        }

        if (!uid && isPreviewFrame() && reachable) {
          const preview = await bootstrapPreviewDemo();
          if (preview) {
            await applySession(preview.user, preview.projects);
            return;
          }
        }

        if (!uid) return;
        if (!bootstrapAuthority) return;

        const expectedRole = storedRole === 'customer' || storedRole === 'contractor' ? storedRole : null;
        const snapshot = parseSessionUserSnapshot(storedSnapshot, { id: uid, role: expectedRole });

        if (!reachable) {
          if (snapshot && isSessionAuthorityCurrent(bootstrapAuthority)) applyDegradedIdentity(snapshot);
          return;
        }

        let u: User;
        try {
          u = await api.me(uid);
          assertSessionAuthorityCurrent(bootstrapAuthority);
          await persistUserSession(u, bootstrapAuthority);
          assertSessionAuthorityCurrent(bootstrapAuthority);
          applyDegradedIdentity(u);
        } catch (error) {
          if (isSessionGenerationChanged(error) || !isSessionAuthorityCurrent(bootstrapAuthority)) return;
          if (!isAuthoritativeSessionFailure(error)) {
            setApiReachable(false);
            reportError('renovaContext.sessionBootstrapTransient', error, { userId: uid });
            if (snapshot) applyDegradedIdentity(snapshot);
            return;
          }

          invalidateSessionAuthority();
          setAccessToken(null);
          setRefreshToken(null);
          setUser(null);
          setProjects([]);
          setActiveProject(null);
          const clearedAuthority = captureSessionAuthority();
          await withSessionAuthorityWrite(clearedAuthority, async () => {
            await AsyncStorage.multiRemove([
              KEYS.userId,
              KEYS.userRole,
              KEYS.projectId,
              KEYS.accessToken,
              KEYS.refreshToken,
              KEYS.sessionAuthorityId,
            ]);
            await secureMultiRemove([KEYS.userSnapshot]);
          });
          await clearAccessToken(clearedAuthority);
          const recovered = await recoverDemoSession(inferDemoRole(null, storedRole));
          if (recovered) await applySession(recovered.user, recovered.projects);
          return;
        }

        deferPushRegistration(u.id);
        let list = await listProjectsWithRetry(u.id);
        assertSessionAuthorityCurrent(bootstrapAuthority);

        if (list.length === 0) {
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
      } catch (error) {
        if (!isSessionGenerationChanged(error)) {
          setApiReachable(false);
          reportError('renovaContext.bootstrap', error);
        }
      } finally {
        try {
          await flushOfflineOutbox();
        } catch (error) {
          reportError('renovaContext.bootstrap.flushOfflineOutbox', error);
        }
        setLoading(false);
        signalPreviewReady();
      }
    })();
  }, [applySession, applyDegradedIdentity]);


  const demoLogin = useCallback(async (role: UserRole) => {
    const attempt = ++loginAttemptRef.current;
    const u = await withTimeout(api.demoLogin(role), LOGIN_TIMEOUT_MS, 'Превышено время ожидания сервера');
    if (attempt !== loginAttemptRef.current) return;
    const authority = beginSessionAuthority(u.id);
    await persistUserSession(u, authority);
    assertSessionAuthorityCurrent(authority);
    setUser(u);
    setReadOnly(false);
    await refreshTeamAccess(u);
    assertSessionAuthorityCurrent(authority);
    deferPushRegistration(u.id);
    let list: ProjectSummary[] = [];
    try {
      const raw = await withTimeout(listProjectsWithRetry(u.id, 4), LOGIN_TIMEOUT_MS, 'Превышено время ожидания загрузки проектов');
      list = await enrichProjectsPendingPayments(u.id, raw, role);
    } catch (error) {
      if (!isSessionAuthorityCurrent(authority)) return;
      reportError('renovaContext.demoLogin.projects', error, { userId: u.id, role });
      list = [];
    }
    if (!isSessionAuthorityCurrent(authority)) return;
    setProjects(list);
    setActiveProject(null);
    setReadOnly(false);
    await withSessionAuthorityWrite(authority, async () => {
      await AsyncStorage.removeItem(KEYS.projectId);
      await AsyncStorage.removeItem(SESSION_KEYS.projectExplicitlyPicked);
      await AsyncStorage.setItem(SESSION_KEYS.pendingProjectPick, '1');
    });
  }, [refreshTeamAccess]);


  const loginWithSms = useCallback(async (phone: string, code: string, role: UserRole, extra?: { full_name?: string; inn?: string }) => {
    const attempt = ++loginAttemptRef.current;
    const u = await api.verifySmsCode(phone, code, role, extra);
    if (attempt !== loginAttemptRef.current) return;
    const authority = beginSessionAuthority(u.id);
    await persistUserSession(u, authority);
    assertSessionAuthorityCurrent(authority);
    setUser(u);
    setReadOnly(false);
    await refreshTeamAccess(u);
    const raw = await api.listProjects(u.id);
    const list = await enrichProjectsPendingPayments(u.id, raw, role);
    assertSessionAuthorityCurrent(authority);
    setProjects(list);
    const saved = await AsyncStorage.getItem(KEYS.projectId);
    assertSessionAuthorityCurrent(authority);
    const pickId = saved ? resolveActiveProjectId(list, saved) : null;
    if (pickId) {
      let detail = await api.getProject(u.id, pickId);
      detail = await syncCustomerBudgetOnLoad(u, detail);
      assertSessionAuthorityCurrent(authority);
      setActiveProject(detail);
      setReadOnly(!!detail.read_only);
      await withSessionAuthorityWrite(authority, async () => {
        await AsyncStorage.setItem(KEYS.projectId, pickId);
        await AsyncStorage.removeItem(SESSION_KEYS.pendingProjectPick);
      });
    } else {
      setActiveProject(null);
      setReadOnly(false);
      await withSessionAuthorityWrite(authority, async () => {
        await AsyncStorage.removeItem(KEYS.projectId);
        await AsyncStorage.setItem(SESSION_KEYS.pendingProjectPick, '1');
      });
    }
    if (isSessionAuthorityCurrent(authority)) deferPushRegistration(u.id);
  }, [refreshTeamAccess]);

  const register = useCallback(async (phone: string, role: UserRole, extra?: { full_name?: string; inn?: string }) => {
    const attempt = ++loginAttemptRef.current;
    const u = await api.register({ phone, role, ...extra });
    if (attempt !== loginAttemptRef.current) return;
    const authority = beginSessionAuthority(u.id);
    await persistUserSession(u, authority);
    assertSessionAuthorityCurrent(authority);
    setUser(u);
    setReadOnly(false);
    await refreshTeamAccess(u);
    if (isSessionAuthorityCurrent(authority)) deferPushRegistration(u.id);
    if (role === 'contractor') {
      const raw = await api.listProjects(u.id);
      const list = await enrichProjectsPendingPayments(u.id, raw, role);
      if (isSessionAuthorityCurrent(authority)) setProjects(list);
    }
  }, [refreshTeamAccess]);

  const createProjectFromWizard = useCallback(async (extra?: Partial<WizardDraft>): Promise<CreateProjectResult> => {
    if (!user) throw new Error('no user');
    const authority = captureSessionAuthority();
    if (authority.userId !== user.id || !authority.sessionId) throw new Error('session_generation_changed');
    const draft = { ...wizard, ...extra };
    if (!draft.name.trim()) throw new Error('Укажите название проекта');
    const body = buildProjectCreatePayload(draft);
    const created = await api.createProject(user.id, body);
    assertSessionAuthorityCurrent(authority);
    let detail = created;
    const requestedLimit = normalizeCustomerBudget(draft.customer_budget);
    if (requestedLimit) {
      try {
        detail = await api.patchProject(user.id, created.id, { customer_budget: requestedLimit });
      } catch (error) {
        if (isSessionGenerationChanged(error) || !isSessionAuthorityCurrent(authority)) throw error;
        reportError('projectWizard.customerBudget.persist', error, { projectId: created.id });
      }
      assertSessionAuthorityCurrent(authority);
      try {
        await setCustomerBudget(created.id, normalizeCustomerBudget(detail.customer_budget) ?? requestedLimit);
      } catch (error) {
        if (isSessionAuthorityCurrent(authority)) reportError('projectWizard.customerBudget.cache', error, { projectId: created.id });
      }
    }
    try {
      detail = await api.getProject(user.id, created.id);
    } catch (error) {
      if (isSessionGenerationChanged(error) || !isSessionAuthorityCurrent(authority)) throw error;
      /* POST/PATCH response is sufficient as the committed project fallback */
    }
    assertSessionAuthorityCurrent(authority);
    const refreshed = await enrichProjectsPendingPayments(user.id, await api.listProjects(user.id), user.role as UserRole);
    assertSessionAuthorityCurrent(authority);
    setProjects(refreshed);
    const junkWizard = isDemoPhone(user.phone) && isJunkProjectName(created.name);
    if (junkWizard) {
      const primary = pickPrimaryDemoProject(refreshed);
      const primaryId = primary?.id;
      if (primaryId) {
        const primaryDetail = await api.getProject(user.id, primaryId);
        assertSessionAuthorityCurrent(authority);
        setActiveProject(primaryDetail);
        setReadOnly(!!primaryDetail.read_only);
        await withSessionAuthorityWrite(authority, async () => {
          await AsyncStorage.setItem(KEYS.projectId, primaryId);
          await AsyncStorage.removeItem(SESSION_KEYS.pendingProjectPick);
        });
        return {
          id: created.id,
          demoKeptPrimary: { createdName: created.name, activeName: primary?.name || primaryDetail.name },
        };
      }
    }
    setActiveProject(detail);
    setReadOnly(!!detail.read_only);
    await withSessionAuthorityWrite(authority, async () => {
      await AsyncStorage.setItem(KEYS.projectId, created.id);
      await AsyncStorage.setItem(SESSION_KEYS.projectExplicitlyPicked, '1');
      await AsyncStorage.removeItem(SESSION_KEYS.pendingProjectPick);
    });
    await refreshProjects();
    return { id: created.id };
  }, [user, wizard, refreshProjects]);

  const updateProjectProfile = useCallback(async (patch: ProjectProfilePatch) => {
    if (!user || !activeProject) throw new Error('no project');
    const authority = captureSessionAuthority();
    const body: Record<string, unknown> = { ...patch };
    if (patch.address === undefined) delete body.address;
    if (patch.customer_budget === undefined) delete body.customer_budget;

    const p = await api.patchProject(user.id, activeProject.id, body);
    assertSessionAuthorityCurrent(authority);

    if (patch.customer_budget !== undefined) {
      const limit = normalizeCustomerBudget(p.customer_budget) ?? normalizeCustomerBudget(patch.customer_budget);
      try {
        await setCustomerBudget(activeProject.id, limit);
      } catch (error) {
        if (isSessionAuthorityCurrent(authority)) reportError('projectProfile.cacheBudget', error, { projectId: activeProject.id });
      }
    }
    assertSessionAuthorityCurrent(authority);
    setActiveProject(p);
    setReadOnly(!!p.read_only);

    try {
      await refreshProjects();
    } catch (error) {
      if (isSessionAuthorityCurrent(authority)) reportError('projectProfile.refreshProjects', error, { projectId: activeProject.id });
    }

    if (!isSessionAuthorityCurrent(authority)) return;
    try {
      await syncProjectSideEffects({ user, project: p });
    } catch (error) {
      if (isSessionAuthorityCurrent(authority)) reportError('projectProfile.sideEffects', error, { projectId: activeProject.id });
    }
  }, [user, activeProject, refreshProjects]);

  const submitStage = useCallback(
    async (stageId: string) => {
      if (!user || !activeProject) return;
      const authority = captureSessionAuthority();
      await api.submitStage(user.id, activeProject.id, stageId);
      assertSessionAuthorityCurrent(authority);
      await loadProject(activeProject.id);
      if (!isSessionAuthorityCurrent(authority)) return;
      await syncProjectSideEffects({ user, project: activeProject });
    },
    [user, activeProject, loadProject],
  );

  const rejectStage = useCallback(async (stageId: string, reason: string, opts?: { qualityScore?: number | null }) => {
    if (!user || !activeProject) return;
    const authority = captureSessionAuthority();
    await api.rejectStage(user.id, activeProject.id, stageId, reason, opts);
    assertSessionAuthorityCurrent(authority);
    await loadProject(activeProject.id);
    if (!isSessionAuthorityCurrent(authority)) return;
    await syncProjectSideEffects({ user, project: activeProject });
  }, [user, activeProject, loadProject]);

  const acceptStage = useCallback(
    async (stageId: string, opts?: { qualityScore?: number | null }) => {
      if (!user || !activeProject) return;
      const authority = captureSessionAuthority();
      try {
        await api.acceptStage(user.id, activeProject.id, stageId, opts);
      } catch (e: any) {
        if (isSessionGenerationChanged(e) || !isSessionAuthorityCurrent(authority)) return;
        if (e?.message === 'offline_queued') {
          /* queued */
        } else throw e;
      }
      if (!isSessionAuthorityCurrent(authority)) return;
      await loadProject(activeProject.id);
      if (!isSessionAuthorityCurrent(authority)) return;
      await syncProjectSideEffects({ user, project: activeProject });
    },
    [user, activeProject, loadProject],
  );

  useEffect(() => {
    if (loading || !user || activeProject || !projects.length) return;
    AsyncStorage.getItem(SESSION_KEYS.pendingProjectPick).then((pending) => {
      if (pending === '1') return;
      ensureActiveProject().catch(reportCatch('renovaContext'));
    });
  }, [loading, user?.id, activeProject?.id, projects.length, ensureActiveProject]);

  const logout = useCallback(async () => {
    const refreshToken = getRefreshToken();
    loginAttemptRef.current += 1;

    // Local authority is revoked synchronously before ANY storage/network await.
    invalidateSessionAuthority();
    setAccessToken(null);
    setRefreshToken(null);
    setUser(null);
    setProjects([]);
    setActiveProject(null);
    setReadOnly(false);
    setTeamAccess(NOT_APPLICABLE_TEAM_ACCESS);
    setWizardState(defaultWizard);
    ensureAttemptKeyRef.current = null;

    const clearedAuthority = captureSessionAuthority();
    const localCleanup = withSessionAuthorityWrite(clearedAuthority, async () => {
      await AsyncStorage.multiRemove([
        KEYS.userId,
        KEYS.userRole,
        KEYS.projectId,
        KEYS.accessToken,
        KEYS.refreshToken,
        KEYS.sessionAuthorityId,
        SESSION_KEYS.pendingProjectPick,
        SESSION_KEYS.projectExplicitlyPicked,
      ]);
      await secureMultiRemove([KEYS.userSnapshot]);
    });
    const tokenCleanup = clearAccessToken(clearedAuthority);
    const serverRevoke = refreshToken
      ? api.logoutRefreshSession(refreshToken).catch((error) => {
          reportError('renovaContext.logout.serverRevoke', error, { revoked: false });
          return { ok: false };
        })
      : Promise.resolve({ ok: false });

    await Promise.allSettled([localCleanup, tokenCleanup, serverRevoke]);
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
      readOnly: effectiveReadOnly,
      teamRole,
      isContractorOwner: Boolean(
        user?.role === 'contractor'
        && teamAccess.ownerLike
        && activeProject
        && activeProject.contractor_id === user.id
      ),
    }),
    [loading, apiReachable, user, projects, activeProject, projectResolving, wizard, setWizard, demoLogin, register, loginWithSms, refreshProjects, refreshMe, clearActiveProject, loadProject, ensureActiveProject, recoverSession, createProjectFromWizard, updateProjectProfile, submitStage, acceptStage, rejectStage, logout, paywallVisible, effectiveReadOnly, teamRole, teamAccess.ownerLike],
  );

  return (
    <RenovaContext.Provider value={value}>
      {children}
      <ActionConfirmHost />
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
