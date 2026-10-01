/** API: notifications — W113 mark/snooze offline (бейджи после flush) */
import { req, ApiError } from './client';
import { isQueueableWriteError } from './queueableError';
import type { AppNotification } from './types';

async function withOffline(
  run: () => Promise<unknown>,
  path: string,
  method: 'POST',
  body: string,
  userId: string,
) {
  try {
    return await run();
  } catch (e) {
    if (!isQueueableWriteError(e)) throw e;
    const { enqueue } = await import('@/lib/offlineQueue');
    await enqueue({ path, method, body, userId });
    throw new Error('offline_queued');
  }
}

export const notificationsApi = {
  snoozeNotification: (userId: string, id: string, hours = 24) =>
    withOffline(
      () => req(`/api/v1/notifications/${id}/snooze?hours=${hours}`, { method: 'POST' }, userId),
      `/api/v1/notifications/${id}/snooze?hours=${hours}`,
      'POST',
      '{}',
      userId,
    ),
  snoozeNotificationUntil: (userId: string, id: string, untilIso: string) =>
    withOffline(
      () =>
        req(`/api/v1/notifications/${id}/snooze-until`, {
          method: 'POST',
          body: JSON.stringify({ until_iso: untilIso }),
        }, userId),
      `/api/v1/notifications/${id}/snooze-until`,
      'POST',
      JSON.stringify({ until_iso: untilIso }),
      userId,
    ),
  markAllNotifications: (userId: string) =>
    withOffline(
      () => req(`/api/v1/notifications/mark-all-read`, { method: 'POST' }, userId),
      `/api/v1/notifications/mark-all-read`,
      'POST',
      '{}',
      userId,
    ),
  reactionDigest: (userId: string) =>
    req<{ count: number; items: AppNotification[] }>(`/api/v1/notifications/reaction-digest`, {}, userId),
  unreadNotifications: (userId: string) => req<{ count: number }>(`/api/v1/notifications/unread-count`, {}, userId),
  /** Страница ленты (новые сверху). Сервер ограничивает limit до 100. */
  listNotifications: (userId: string, page: { limit?: number; offset?: number } = {}) =>
    req<AppNotification[]>(
      `/api/v1/notifications?limit=${page.limit ?? 30}&offset=${page.offset ?? 0}`,
      {},
      userId,
    ),
  readNotification: (userId: string, id: string) =>
    withOffline(
      () => req(`/api/v1/notifications/${id}/read`, { method: 'POST' }, userId),
      `/api/v1/notifications/${id}/read`,
      'POST',
      '{}',
      userId,
    ),
  approvalDigest: (userId: string) =>
    req<{ count: number; items: AppNotification[] }>('/api/v1/notifications/approval-digest', {}, userId),
};
