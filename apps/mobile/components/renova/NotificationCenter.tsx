/** Лента in-app уведомлений (COM-001): список по дням, «прочитано», «Отметить все», честные ошибки. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { screenTypography } from '@/constants/screenTypography';
import { api, type AppNotification } from '@/lib/api';
import { useRenova } from '@/lib/context/RenovaContext';
import { useProjectDataReload } from '@/lib/useProjectDataReload';
import { pushOsNav } from '@/lib/pushOsNav';
import type { OsRole } from '@/constants/osSections';
import { EmptyActionState } from '@/components/ui/EmptyActionState';
import { setNotificationUnread } from '@/lib/inboxSyncStore';
import {
  NOTIFICATIONS_PAGE_SIZE,
  countUnread,
  groupNotificationsByDay,
  markAllReadLocal,
  markReadLocal,
  mergeNotificationPages,
  resolveNotificationTarget,
} from '@/lib/notificationsFeed';
import { reportCatch, reportError } from '@/lib/reportError';

type LoadState = 'loading' | 'ready' | 'error';

function isQueued(error: unknown): boolean {
  return error instanceof Error && error.message === 'offline_queued';
}

export function NotificationCenter({ userId, role = 'customer' }: { userId: string; role?: OsRole }) {
  const { user } = useRenova();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [state, setState] = useState<LoadState>('loading');
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyAll, setBusyAll] = useState(false);
  const generation = useRef(0);
  // Роль — из сессии пользователя; проп — только запасной вариант.
  const effectiveRole: OsRole = user?.role === 'contractor' ? 'contractor' : user?.role === 'customer' ? 'customer' : role;

  const syncBadge = useCallback(async () => {
    try {
      const { count } = await api.unreadNotifications(userId);
      setNotificationUnread(count);
    } catch (error) {
      reportError('notifications.unreadCount', error, { userId });
    }
  }, [userId]);

  const load = useCallback(async () => {
    const gen = ++generation.current;
    try {
      const page = await api.listNotifications(userId, { limit: NOTIFICATIONS_PAGE_SIZE, offset: 0 });
      if (gen !== generation.current) return;
      setItems(page);
      setHasMore(page.length >= NOTIFICATIONS_PAGE_SIZE);
      setState('ready');
      setNotice(null);
    } catch (error) {
      if (gen !== generation.current) return;
      reportError('notifications.list', error, { userId });
      // Ошибка не превращается в «нет уведомлений»: прежний список остаётся, пока он есть.
      setState((prev) => (prev === 'ready' ? 'ready' : 'error'));
      setNotice('Не удалось обновить уведомления.');
    }
  }, [userId]);

  useEffect(() => { load().catch(reportCatch('notifications.load')); }, [load]);
  // W95: CO/оплата/приёмка → лента обновляется без remount
  useProjectDataReload(load);

  const loadMore = async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await api.listNotifications(userId, { limit: NOTIFICATIONS_PAGE_SIZE, offset: items.length });
      setItems((prev) => mergeNotificationPages(prev, page));
      setHasMore(page.length >= NOTIFICATIONS_PAGE_SIZE);
    } catch (error) {
      reportError('notifications.loadMore', error, { userId });
      setNotice('Не удалось загрузить ещё.');
    } finally {
      setLoadingMore(false);
    }
  };

  const markOne = async (n: AppNotification) => {
    if (n.read) return;
    setItems((prev) => markReadLocal(prev, n.id));
    try {
      await api.readNotification(userId, n.id);
    } catch (error) {
      if (!isQueued(error)) {
        reportError('notifications.read', error, { userId, id: n.id });
        setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: false } : x)));
        setNotice('Не удалось отметить прочитанным.');
        return;
      }
    }
    await syncBadge();
  };

  const open = async (n: AppNotification) => {
    await markOne(n);
    const target = resolveNotificationTarget(n, effectiveRole);
    pushOsNav({ pathname: target.pathname, params: target.params }, undefined, effectiveRole);
  };

  const markAll = async () => {
    if (busyAll) return;
    setBusyAll(true);
    const before = items;
    setItems(markAllReadLocal(before));
    try {
      await api.markAllNotifications(userId);
      setNotice(null);
    } catch (error) {
      if (!isQueued(error)) {
        reportError('notifications.markAll', error, { userId });
        setItems(before);
        setNotice('Не удалось отметить все прочитанными.');
        setBusyAll(false);
        return;
      }
    }
    await syncBadge();
    setBusyAll(false);
  };

  if (state === 'loading') {
    return <View style={s.center}><ActivityIndicator color={RenovaTheme.colors.primary} /></View>;
  }

  if (state === 'error') {
    return (
      <EmptyActionState
        icon="cloud-offline-outline"
        title="Не удалось загрузить"
        hint="Уведомления сейчас недоступны. Это не значит, что их нет."
        actionLabel="Повторить"
        actionVariant="accent"
        onAction={() => { setState('loading'); load().catch(reportCatch('notifications.retry')); }}
      />
    );
  }

  const unread = countUnread(items);
  const groups = groupNotificationsByDay(items);

  return (
    <View>
      {notice ? (
        <View style={s.notice} accessibilityRole="alert">
          <Text style={s.noticeText}>{notice}</Text>
          <Pressable onPress={() => load().catch(reportCatch('notifications.retry'))} accessibilityRole="button" hitSlop={8}>
            <Text style={s.link}>Повторить</Text>
          </Pressable>
        </View>
      ) : null}
      {!items.length ? (
        <EmptyActionState
          icon="notifications-outline"
          title="Пока нет уведомлений"
          hint="Здесь появятся оплаты, согласования, приёмка и другие события по вашим объектам."
        />
      ) : (
        <>
          <View style={s.toolbar}>
            <Text style={s.count}>{unread ? `Непрочитанных: ${unread}` : 'Все прочитано'}</Text>
            {unread > 0 ? (
              <Pressable onPress={markAll} disabled={busyAll} accessibilityRole="button" hitSlop={8}>
                <Text style={[s.link, busyAll && s.dim]}>Отметить все прочитанными</Text>
              </Pressable>
            ) : null}
          </View>
          {groups.map((group) => (
            <View key={group.key} style={s.group}>
              <Text style={s.groupHead}>{group.label}</Text>
              {group.items.map((n) => (
                <Pressable
                  key={n.id}
                  style={[s.row, !n.read && s.unread]}
                  onPress={() => { open(n).catch(reportCatch('notifications.open')); }}
                  accessibilityRole="button"
                  accessibilityLabel={`${n.read ? '' : 'Непрочитанное. '}${n.title}`}
                >
                  <Text style={[s.title, !n.read && s.titleUnread]}>{n.title}</Text>
                  {n.body ? <Text style={s.body}>{n.body}</Text> : null}
                </Pressable>
              ))}
            </View>
          ))}
          {hasMore ? (
            <Pressable onPress={loadMore} disabled={loadingMore} accessibilityRole="button" style={s.more}>
              <Text style={s.link}>{loadingMore ? 'Загружаем…' : 'Показать ещё'}</Text>
            </Pressable>
          ) : null}
        </>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  center: { paddingVertical: 32, alignItems: 'center' },
  toolbar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  count: { ...screenTypography.listMeta },
  link: { color: RenovaTheme.colors.primary, fontWeight: '600', fontSize: 13 },
  dim: { opacity: 0.5 },
  group: { marginBottom: 12 },
  groupHead: { fontWeight: '700', fontSize: 12, color: RenovaTheme.colors.textMuted, marginBottom: 4, textTransform: 'uppercase' },
  row: {
    backgroundColor: RenovaTheme.colors.surface,
    borderColor: RenovaTheme.colors.border,
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 6,
    minHeight: RenovaTheme.minTouch,
  },
  unread: { borderLeftWidth: 3, borderLeftColor: RenovaTheme.colors.primary },
  title: { ...screenTypography.listTitle },
  titleUnread: { fontWeight: '700' },
  body: { ...screenTypography.listMeta, marginTop: 2 },
  more: { alignItems: 'center', paddingVertical: 12 },
  notice: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: RenovaTheme.colors.warningBg,
    borderColor: RenovaTheme.colors.warningBorder,
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
  },
  noticeText: { color: RenovaTheme.colors.warningText, fontSize: 13, flex: 1, marginRight: 8 },
});
