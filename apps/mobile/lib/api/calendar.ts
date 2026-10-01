/** API: calendar — даты этапов в офлайн-очереди (график golden path) */
import { req, cachedGet, ApiError } from './client';
import { exceedsQueueBodyLimit, isQueueableWriteError } from './queueableError';
import { OFFLINE_UPLOAD_BLOCKED } from '@/lib/offlineErrors';
import { createClientRequestId } from '@/lib/clientRequestId';
import type { CalendarData, OsScheduleSummary } from './types';

export type IcalImportResult = {
  ok: boolean;
  parsed: number;
  updated_stages: number;
};

export const calendarApi = {
  getCalendar: (userId: string, projectId: string) =>
    cachedGet<CalendarData>(`/api/v1/projects/${projectId}/calendar`, userId),

  /** State-sensitive screens preserve their own stale data and must see real load errors. */
  getCalendarFresh: (
    userId: string,
    projectId: string,
    options?: { signal?: AbortSignal },
  ) => req<CalendarData>(
    `/api/v1/projects/${projectId}/calendar`,
    { signal: options?.signal, cacheFallback: false },
    userId,
  ),

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
      if (!isQueueableWriteError(e)) throw e;
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
    // CMP-014: сервер принимает client_request_id (calendar.py IcalImportIn).
    const payload = JSON.stringify({ content, client_request_id: createClientRequestId('ical-import') });
    try {
      return await req<IcalImportResult>(
        `/api/v1/projects/${projectId}/calendar/import`,
        { method: 'POST', body: payload },
        userId,
      );
    } catch (e) {
      if (!isQueueableWriteError(e)) throw e;
      if (exceedsQueueBodyLimit(payload)) throw new Error(OFFLINE_UPLOAD_BLOCKED);
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
