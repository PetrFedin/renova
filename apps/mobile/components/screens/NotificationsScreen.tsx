import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';

import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { RenovaTheme, card } from '@/constants/Theme';
import { api } from '@/lib/api';
import type { AppNotification } from '@/lib/api/types';
import { useRenova } from '@/lib/context/RenovaContext';

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function typeLabel(type: string) {
  switch (type) {
    case 'materials': return 'Материалы';
    case 'payment_pending': return 'Оплата';
    case 'stage_review': return 'Приёмка';
    case 'change_order': return 'Изменения';
    case 'chat_message': return 'Чат';
    case 'budget_alert': return 'Бюджет';
    default: return 'Событие';
  }
}

function openNotification(notification: AppNotification) {
  if (!notification.link_path) return;
  router.push(notification.link_path as never);
}

function NotificationCard({ item, onRead }: { item: AppNotification; onRead: (id: string) => void }) {
  return (
    <Pressable
      style={[styles.notificationCard, !item.read && styles.unreadCard]}
      accessibilityRole="button"
      onPress={() => {
        if (!item.read) onRead(item.id);
        openNotification(item);
      }}
    >
      <View style={styles.cardHeader}>
        <View style={styles.typePill}>
          <Text style={styles.typeText}>{typeLabel(item.notification_type)}</Text>
        </View>
        <Text style={styles.dateText}>{formatDate(item.created_at)}</Text>
      </View>
      <Text style={styles.notificationTitle}>{item.title}</Text>
      <Text style={styles.notificationBody}>{item.body}</Text>
      <View style={styles.cardFooter}>
        {!item.read ? <Text style={styles.unreadText}>Новое</Text> : <Text style={styles.readText}>Прочитано</Text>}
        {item.link_path ? <Text style={styles.openText}>Открыть →</Text> : null}
      </View>
    </Pressable>
  );
}

export function NotificationsScreen() {
  const { user } = useRenova();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [acting, setActing] = useState(false);

  const unreadCount = useMemo(() => items.filter((item) => !item.read).length, [items]);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const result = await api.listNotifications(user.id);
      setItems(result);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const markRead = async (id: string) => {
    if (!user) return;
    setItems((prev) => prev.map((item) => item.id === id ? { ...item, read: true } : item));
    try { await api.readNotification(user.id, id); } catch { await load(); }
  };

  const markAll = async () => {
    if (!user || !unreadCount) return;
    setActing(true);
    setItems((prev) => prev.map((item) => ({ ...item, read: true })));
    try { await api.markAllNotifications(user.id); } catch { await load(); }
    finally { setActing(false); }
  };

  if (!user) {
    return (
      <View style={styles.center}>
        <Text style={styles.stateTitle}>Нет пользователя</Text>
        <Text style={styles.stateText}>Уведомления появятся после выбора рабочего профиля.</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={RenovaTheme.colors.primaryMuted} />
        <Text style={styles.stateText}>Загружаем уведомления...</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
    >
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}><Text style={styles.back}>‹ Назад</Text></Pressable>
        <Text style={styles.title}>Уведомления</Text>
        <Text style={styles.subtitle}>Важные изменения проекта: материалы, приёмки, оплаты и сообщения.</Text>
      </View>

      <View style={styles.summaryCard}>
        <View>
          <Text style={styles.summaryTitle}>{unreadCount ? `${unreadCount} новых` : 'Всё прочитано'}</Text>
          <Text style={styles.summaryText}>Открывайте событие сразу в нужном разделе проекта.</Text>
        </View>
        <PrimaryButton title="Прочитать всё" variant="outline" compact onPress={markAll} disabled={!unreadCount || acting} loading={acting} />
      </View>

      {items.length ? (
        <View style={styles.list}>
          {items.map((item) => <NotificationCard key={item.id} item={item} onRead={markRead} />)}
        </View>
      ) : (
        <View style={styles.emptyCard}>
          <Text style={styles.stateTitle}>Пока тихо</Text>
          <Text style={styles.stateText}>Когда доставка, приёмка или оплата потребуют внимания, они появятся здесь.</Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: RenovaTheme.colors.background },
  content: { padding: RenovaTheme.spacing.lg, paddingBottom: 32, gap: RenovaTheme.spacing.md },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 8, backgroundColor: RenovaTheme.colors.background },
  header: { gap: 4 },
  back: { fontSize: RenovaTheme.fontSize.body, color: RenovaTheme.colors.primaryMuted, fontWeight: RenovaTheme.fontWeight.semibold },
  title: { fontSize: RenovaTheme.fontSize.h1, fontWeight: RenovaTheme.fontWeight.bold, color: RenovaTheme.colors.text },
  subtitle: { fontSize: RenovaTheme.fontSize.body, lineHeight: 20, color: RenovaTheme.colors.textMuted },
  summaryCard: { ...card, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: RenovaTheme.spacing.md },
  summaryTitle: { fontSize: RenovaTheme.fontSize.h3, fontWeight: RenovaTheme.fontWeight.extrabold, color: RenovaTheme.colors.text },
  summaryText: { marginTop: 2, fontSize: RenovaTheme.fontSize.bodySmall, color: RenovaTheme.colors.textMuted, lineHeight: 18 },
  list: { gap: RenovaTheme.spacing.sm },
  notificationCard: { ...card, gap: RenovaTheme.spacing.sm, borderColor: RenovaTheme.colors.border },
  unreadCard: { borderColor: RenovaTheme.colors.primaryMuted, backgroundColor: RenovaTheme.colors.infoBg },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: RenovaTheme.spacing.sm, alignItems: 'center' },
  typePill: { borderWidth: 1, borderColor: RenovaTheme.colors.border, borderRadius: RenovaTheme.radius.pill, paddingHorizontal: 8, paddingVertical: 3, backgroundColor: RenovaTheme.colors.surface },
  typeText: { fontSize: RenovaTheme.fontSize.tiny, fontWeight: RenovaTheme.fontWeight.extrabold, color: RenovaTheme.colors.textMuted },
  dateText: { fontSize: RenovaTheme.fontSize.caption, color: RenovaTheme.colors.textMuted },
  notificationTitle: { fontSize: RenovaTheme.fontSize.body, fontWeight: RenovaTheme.fontWeight.extrabold, color: RenovaTheme.colors.text },
  notificationBody: { fontSize: RenovaTheme.fontSize.bodySmall, color: RenovaTheme.colors.textMuted, lineHeight: 18 },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  unreadText: { fontSize: RenovaTheme.fontSize.caption, fontWeight: RenovaTheme.fontWeight.extrabold, color: RenovaTheme.colors.primaryMuted },
  readText: { fontSize: RenovaTheme.fontSize.caption, color: RenovaTheme.colors.textMuted },
  openText: { fontSize: RenovaTheme.fontSize.caption, fontWeight: RenovaTheme.fontWeight.semibold, color: RenovaTheme.colors.primaryMuted },
  emptyCard: { ...card, alignItems: 'center', gap: 6 },
  stateTitle: { fontSize: RenovaTheme.fontSize.h3, fontWeight: RenovaTheme.fontWeight.bold, color: RenovaTheme.colors.text, textAlign: 'center' },
  stateText: { fontSize: RenovaTheme.fontSize.bodySmall, color: RenovaTheme.colors.textMuted, textAlign: 'center', lineHeight: 18 },
});
