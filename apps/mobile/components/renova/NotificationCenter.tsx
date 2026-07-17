import { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { RenovaTheme } from '@/constants/Theme';
import { api, AppNotification } from '@/lib/api';
import { resolveNotificationLink, resolvePushLink } from '@/lib/pushLinks';
import type { OsRole } from '@/constants/osSections';
import { SnoozeUntilPicker } from '@/components/renova/SnoozeUntilPicker';

export function NotificationCenter({
  userId,
  role = 'customer',
  compact,
  hideHeader,
}: {
  userId: string;
  role?: OsRole;
  compact?: boolean;
  /** Без заголовка — когда секция уже озаглавлена в профиле */
  hideHeader?: boolean;
}) {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [onlyUnread, setOnlyUnread] = useState(false);
  useEffect(() => { api.listNotifications(userId).then(setItems).catch(() => {}); }, [userId]);
  const list = items.filter(n => !onlyUnread || !n.read).slice(0, compact ? 3 : 15);
  const unread = items.filter(n => !n.read).length;
  const snooze = async (e: any, id: string, h: number) => { e.stopPropagation?.(); await api.snoozeNotification(userId, id, h); setItems(await api.listNotifications(userId)); };
  return (
    <View>
      {!hideHeader ? (
        <View style={s.row}>
          <Text style={s.head}>Уведомления {unread ? `(${unread})` : ''}</Text>
          <Pressable onPress={async () => { await api.markAllNotifications(userId); setItems(await api.listNotifications(userId)); }}><Text style={s.filter}>Все прочит.</Text></Pressable>
          <Pressable onPress={() => setOnlyUnread(u => !u)}><Text style={s.filter}>{onlyUnread ? 'Все' : 'Непрочит.'}</Text></Pressable>
        </View>
      ) : (
        <View style={s.row}>
          <Text style={s.subHead}>Лента {unread ? `· ${unread} непрочит.` : ''}</Text>
          <Pressable onPress={async () => { await api.markAllNotifications(userId); setItems(await api.listNotifications(userId)); }}><Text style={s.filter}>Все прочит.</Text></Pressable>
          <Pressable onPress={() => setOnlyUnread(u => !u)}><Text style={s.filter}>{onlyUnread ? 'Все' : 'Непрочит.'}</Text></Pressable>
        </View>
      )}
      {!list.length && <Text style={s.empty}>Пусто</Text>}
      {list.map(n => (
        <Pressable key={n.id} style={[s.item, !n.read && s.unread]} onPress={async () => {
          await api.readNotification(userId, n.id);
          const back = role === 'contractor' ? '/(contractor)/(tabs)/profile' : '/(customer)/(tabs)/profile';
          if (n.link_path) {
            const target = resolvePushLink(n.link_path, back, role);
            if (target) {
              router.push({ pathname: target.pathname, params: target.params } as any);
              setItems(await api.listNotifications(userId));
              return;
            }
          }
          const fallback = resolveNotificationLink(n.notification_type, role);
          if (fallback) {
            router.push({ pathname: fallback.pathname, params: fallback.params } as any);
          }
          setItems(await api.listNotifications(userId));
        }}>
          <Text style={s.title}>{n.title}</Text>
          <Text style={s.body}>{n.body}</Text>
          <View style={s.snoozeRow}>
            <Pressable onPress={(e) => snooze(e, n.id, 1)}><Text style={s.snooze}>1ч</Text></Pressable>
            <Pressable onPress={(e) => snooze(e, n.id, 24)}><Text style={s.snooze}>24ч</Text></Pressable>
            <Pressable onPress={(e) => snooze(e, n.id, 72)}><Text style={s.snooze}>3д</Text></Pressable>
          </View>
          <SnoozeUntilPicker userId={userId} notificationId={n.id} onDone={async () => setItems(await api.listNotifications(userId))} />
        </Pressable>
      ))}
    </View>
  );
}
const s = StyleSheet.create({
  row:{ flexDirection:'row', flexWrap:'wrap', gap:8, marginBottom:8, alignItems:'center' },
  head:{ fontWeight:'800' },
  subHead:{ fontWeight:'700', fontSize:13, color: RenovaTheme.colors.text },
  filter:{ color: RenovaTheme.colors.primary, fontWeight:'600', fontSize:12 },
  item:{ backgroundColor:RenovaTheme.colors.surface, padding:10, borderRadius:8, marginBottom:6 },
  unread:{ borderLeftWidth:3, borderLeftColor: RenovaTheme.colors.primary },
  title:{ fontWeight:'700' }, body:{ fontSize:12, color: RenovaTheme.colors.textMuted },
  snoozeRow:{ flexDirection:'row', gap:12, marginTop:6 },
  snooze:{ fontSize:11, color:'#6366f1' }, empty:{ color: RenovaTheme.colors.textMuted },
});
