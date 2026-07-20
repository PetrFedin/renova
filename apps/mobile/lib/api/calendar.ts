/** API: calendar — даты этапов в офлайн-очереди (график golden path) */
import { req, cachedGet, ApiError } from './client';
import type { CalendarData, OsScheduleSummary } from './types';

export const calendarApi = {
  getCalendar: (userId: string, projectId: string) =>
    cachedGet<CalendarData>(`/api/v1/projects/${projectId}/calendar`, userId),

  /** W116: перенос дат этапа — очередь офлайн */
  updateStageDates: async (userId: string, projectId: string, body: object) => {
    const payload = JSON.stringify(body);
    try {
      return await req<CalendarData>(
        `/api/v1/projects/${projectId}/calendar/stages`,
        { method: 'PATCH', body: payload },
        userId,
      );
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) throw e;
      const { enqueue } = await import('@/lib/offlineQueue');
      await enqueue({
        path: `/api/v1/projects/${projectId}/calendar/stages`,
        method: 'PATCH',
        body: payload,
        userId,
      });
      throw new Error('offline_queued');
    }
  },

  /** W116: импорт ICS — очередь офлайн (метаданные; большой файл — online only через 4xx) */
  importIcal: async (userId: string, projectId: string, content: string) => {
    const payload = JSON.stringify({ content });
    try {
      return await req(
        `/api/v1/projects/${projectId}/calendar/import`,
        { method: 'POST', body: payload },
        userId,
      );
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) throw e;
      const { enqueue } = await import('@/lib/offlineQueue');
      await enqueue({
        path: `/api/v1/projects/${projectId}/calendar/import`,
        method: 'POST',
        body: payload,
        userId,
      });
      throw new Error('offline_queued');
    }
  },

  exportIcal: async (userId: string, projectId: string) => {
    const base = process.env.EXPO_PUBLIC_API_URL ?? 'http://127.0.0.1:8100';
    const r = await fetch(`${base}/api/v1/projects/${projectId}/calendar.ics`, {
      headers: { 'X-User-Id': userId },
    });
    if (!r.ok) throw new Error('ical');
    const blob = await r.blob();
    if (typeof window !== 'undefined') {
      const u = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = u;
      a.download = 'renova.ics';
      a.click();
      URL.revokeObjectURL(u);
    }
  },

  osSchedule: (userId: string, projectId: string) =>
    req<OsScheduleSummary>(`/api/v1/projects/${projectId}/os/schedule`, {}, userId),
};
