/**
 * Badge Calendar / overdue — единый SoT: GET /api/v1/tasks/counters.
 * «Сегодня» считается в timezone устройства, не через UTC toISOString().
 *
 * Семантика (не переносить между кнопками dock без явного решения):
 * - calendar badge → dueToday
 * - inbox tasks → actionRequired (см. useActionRequiredCount / useInboxTasks)
 * - overdue → отдельный индикатор, не смешивать с dueToday
 */
import { useCallback, useEffect } from 'react';
import { useFocusEffect } from 'expo-router';
import { useSyncExternalStore } from 'react';
import type { OsRole } from '@/constants/osSections';
import { getDeviceTimezone } from '@/lib/i18n';
import {
  getTaskCountersSnapshot,
  reconcileTaskCounters,
  subscribeTaskCounters,
} from '@/lib/taskCountersStore';
import { taskCountersContextKey } from '@/lib/domain/taskCounters';

function useTaskCountersSnap() {
  return useSyncExternalStore(subscribeTaskCounters, getTaskCountersSnapshot, getTaskCountersSnapshot);
}

function contextMatches(projectId?: string, role?: string, timezone?: string, contextKey?: string | null) {
  if (!contextKey || !projectId) return false;
  const tz = timezone || getDeviceTimezone();
  return contextKey === taskCountersContextKey(projectId, role, tz);
}

/**
 * Ошибка API ≠ 0 задач.
 * `count` — только при успешных/stale данных; `reliable` — можно ли доверять числу.
 */
export function useTodayTaskCount(userId?: string, projectId?: string, role: OsRole = 'customer') {
  const snap = useTaskCountersSnap();
  const tz = getDeviceTimezone();

  const reload = useCallback(
    async (_opts?: { soft?: boolean }) => {
      if (!userId || !projectId) return;
      await reconcileTaskCounters({
        userId,
        projectId,
        role,
        timezone: tz,
      });
    },
    [userId, projectId, role, tz],
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  useFocusEffect(
    useCallback(() => {
      void reload({ soft: true });
    }, [reload]),
  );

  const matched = Boolean(
    userId && projectId && snap.counters && contextMatches(projectId, role, tz, snap.contextKey),
  );
  const failed = Boolean(snap.error && !snap.counters);
  /** Snapshot есть (в т.ч. soft reload / stale) — badge можно показывать */
  const reliable = matched && !failed;

  return {
    count: reliable ? snap.counters!.dueToday : 0,
    overdue: reliable ? snap.counters!.overdue : 0,
    reliable,
    failed,
    stale: matched && snap.stale,
    reload,
  };
}

/** Inbox / «Ещё» amber: actionRequired (не dueToday). */
export function useActionRequiredCount(userId?: string, projectId?: string, role: OsRole = 'customer') {
  const snap = useTaskCountersSnap();
  const tz = getDeviceTimezone();

  useEffect(() => {
    if (!userId || !projectId) return;
    void reconcileTaskCounters({ userId, projectId, role, timezone: tz });
  }, [userId, projectId, role, tz]);

  const matched = Boolean(
    userId && projectId && snap.counters && contextMatches(projectId, role, tz, snap.contextKey),
  );
  const failed = Boolean(snap.error && !snap.counters);
  const reliable = matched && !failed;

  return {
    count: reliable ? snap.counters!.actionRequired : 0,
    reliable,
    failed,
    stale: matched && snap.stale,
  };
}

export function useOverdueCount(userId?: string, projectId?: string, role: OsRole = 'customer') {
  const snap = useTaskCountersSnap();
  const tz = getDeviceTimezone();
  const matched = Boolean(
    userId && projectId && snap.counters && contextMatches(projectId, role, tz, snap.contextKey),
  );
  if (!matched || !snap.counters) return 0;
  return snap.counters.overdue;
}
