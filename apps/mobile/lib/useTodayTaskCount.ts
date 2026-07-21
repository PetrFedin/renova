/** Число задач на сегодня — badge на dock «Календарь» */
import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { api } from '@/lib/api';
import { dayTaskCount, filterCalendarEventsForRole } from '@/lib/domain/calendarEvents';
import type { OsRole } from '@/constants/osSections';
import { reportCatch } from '@/lib/reportError';

export function useTodayTaskCount(userId?: string, projectId?: string, role: OsRole = 'customer') {
  const [count, setCount] = useState(0);

  const reload = useCallback(async () => {
    if (!userId || !projectId) {
      setCount(0);
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    try {
      const cal = await api.getCalendar(userId, projectId);
      const events = filterCalendarEventsForRole(cal.events, role).filter(
        (e) => e.date === today || (e.end_date && e.date <= today && today <= e.end_date),
      );
      setCount(dayTaskCount(events));
    } catch {
      setCount(0);
    }
  }, [userId, projectId, role]);

  useFocusEffect(useCallback(() => { reload().catch(reportCatch('todayTasks.reload')); }, [reload]));

  return { count, reload };
}
