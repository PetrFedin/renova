/** Число задач на сегодня — badge на dock «Календарь» */
import { useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import { api } from '@/lib/api';
import { dayTaskCount, filterCalendarEventsForRole } from '@/lib/domain/calendarEvents';
import type { OsRole } from '@/constants/osSections';
import { useAsyncResource, asyncShowError } from '@/lib/async';

/**
 * Ошибка API ≠ 0 задач.
 * `count` — только при успешных/stale данных; `reliable` — можно ли доверять числу.
 */
export function useTodayTaskCount(userId?: string, projectId?: string, role: OsRole = 'customer') {
  const { resource, data, reload } = useAsyncResource<number>({
    contextKey: `today-tasks:${projectId || ''}:${role}`,
    enabled: Boolean(userId && projectId),
    scope: 'todayTasks',
    fetcher: async () => {
      if (!userId || !projectId) return 0;
      const today = new Date().toISOString().slice(0, 10);
      const cal = await api.getCalendar(userId, projectId);
      const events = filterCalendarEventsForRole(cal.events, role).filter(
        (e) => e.date === today || (e.end_date && e.date <= today && today <= e.end_date),
      );
      return dayTaskCount(events);
    },
    isEmpty: (n) => n === 0,
  });

  useFocusEffect(
    useCallback(() => {
      void reload({ soft: true });
    }, [reload]),
  );

  const reliable = !asyncShowError(resource) && resource.status !== 'loading' && resource.status !== 'idle';
  return {
    /** Для badge: при ошибке не подставляем ложный 0 */
    count: reliable ? (data ?? 0) : 0,
    reliable,
    failed: asyncShowError(resource),
    resource,
    reload,
  };
}
