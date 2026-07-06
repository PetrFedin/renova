/** API: notifications */
import { req, cachedGet, API_BASE } from './client';
import type { AppNotification } from './types';
export const notificationsApi = {
  snoozeNotification: (userId: string, id: string, hours = 24) => req(`/api/v1/notifications/${id}/snooze?hours=${hours}`, { method: 'POST' }, userId),
  snoozeNotificationUntil: (userId: string, id: string, untilIso: string) => req(`/api/v1/notifications/${id}/snooze-until`, { method: 'POST', body: JSON.stringify({ until_iso: untilIso }) }, userId),
  markAllNotifications: (userId: string) => req(`/api/v1/notifications/mark-all-read`, { method: 'POST' }, userId),
  reactionDigestPush: (userId: string) => req(`/api/v1/notifications/reaction-digest?push=1`, {}, userId),
  reactionDigest: (userId: string) => req<{ count: number; items: AppNotification[] }>(`/api/v1/notifications/reaction-digest`, {}, userId),
  unreadNotifications: (userId: string) => req<{ count: number }>(`/api/v1/notifications/unread-count`, {}, userId),
  listNotifications: (userId: string) => req<AppNotification[]>('/api/v1/notifications', {}, userId),
  readNotification: (userId: string, id: string) => req(`/api/v1/notifications/${id}/read`, { method: 'POST' }, userId),
  approvalDigest: (userId: string) => req<{ count: number; items: AppNotification[] }>('/api/v1/notifications/approval-digest', {}, userId),
};
