/** API: calendar */
import { req, cachedGet, API_BASE } from './client';
import type { CalendarData, OsScheduleSummary, User } from './types';
export const calendarApi = {
  getCalendar: (userId: string, projectId: string) => cachedGet<CalendarData>(`/api/v1/projects/${projectId}/calendar`, userId),
  updateStageDates: (userId: string, projectId: string, body: object) =>
    req<CalendarData>(`/api/v1/projects/${projectId}/calendar/stages`, { method: 'PATCH', body: JSON.stringify(body) }, userId),
  importIcal: (userId: string, projectId: string, content: string) => req(`/api/v1/projects/${projectId}/calendar/import`, { method: 'POST', body: JSON.stringify({ content }) }, userId),
  exportIcal: async (userId: string, projectId: string) => { const base = process.env.EXPO_PUBLIC_API_URL ?? 'http://127.0.0.1:8100'; const r = await fetch(`${base}/api/v1/projects/${projectId}/calendar.ics`, { headers: { 'X-User-Id': userId } }); if (!r.ok) throw new Error('ical'); const blob = await r.blob(); if (typeof window !== 'undefined') { const u = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = u; a.download = 'renova.ics'; a.click(); URL.revokeObjectURL(u); } },
  osSchedule: (userId: string, projectId: string) => req<OsScheduleSummary>(`/api/v1/projects/${projectId}/os/schedule`, {}, userId),
};
