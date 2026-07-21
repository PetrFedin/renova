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

  /** W124: .ics → Share/download (native + web); не live Google/Apple sync */
  exportIcal: async (userId: string, projectId: string) => {
    const { exportIcalFile } = await import('@/lib/exportIcalFile');
    await exportIcalFile(userId, projectId, `renova-${projectId.slice(0, 8)}.ics`);
  },

  osSchedule: (userId: string, projectId: string) =>
    req<OsScheduleSummary>(`/api/v1/projects/${projectId}/os/schedule`, {}, userId),
};
