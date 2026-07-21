import { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { api, AppNotification } from '@/lib/api';
import { useRenova } from '@/lib/context/RenovaContext';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import { useProjectDataReload } from '@/lib/useProjectDataReload';
import { resolveNotificationLink, changeOrderEstimateRoute } from '@/lib/pushLinks';
import { pushOsNav } from '@/lib/pushOsNav';
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
  const { user, activeProject } = useRenova();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [onlyUnread, setOnlyUnread] = useState(false);
  const reload = useCallback(() => {
    api.listNotifications(userId).then(setItems).catch(() => {});
  }, [userId]);
  useEffect(() => { reload(); }, [reload]);
  // W95: CO/оплата/приёмка → список уведомлений без remount профиля
  useProjectDataReload(reload);
  const list = items.filter(n => !onlyUnread || !n.read).slice(0, compact ? 3 : 15);
  const unread = items.filter(n => !n.read).length;
  const snooze = async (e: any, id: string, h: number) => { e.stopPropagation?.(); await api.snoozeNotification(userId, id, h); await syncProjectSideEffects({ user: user ?? ({ id: userId } as any), project: activeProject }); reload(); };
  return (
    <View>
      {!hideHeader ? (
        <View style={s.row}>
          <Text style={s.head}>Уведомления {unread ? `(${unread})` : ''}</Text>
          <Pressable onPress={async () => { await api.markAllNotifications(userId); await syncProjectSideEffects({ user: user ?? ({ id: userId } as any), project: activeProject }); reload(); }}><Text style={s.filter}>Все прочит.</Text></Pressable>
          <Pressable onPress={() => setOnlyUnread(u => !u)}><Text style={s.filter}>{onlyUnread ? 'Все' : 'Непрочит.'}</Text></Pressable>
        </View>
      ) : (
        <View style={s.row}>
          <Text style={s.subHead}>Лента {unread ? `· ${unread} непрочит.` : ''}</Text>
          <Pressable onPress={async () => { await api.markAllNotifications(userId); await syncProjectSideEffects({ user: user ?? ({ id: userId } as any), project: activeProject }); reload(); }}><Text style={s.filter}>Все прочит.</Text></Pressable>
          <Pressable onPress={() => setOnlyUnread(u => !u)}><Text style={s.filter}>{onlyUnread ? 'Все' : 'Непрочит.'}</Text></Pressable>
        </View>
      )}
      {!list.length && <Text style={s.empty}>Пусто</Text>}
      {list.map(n => (
        <Pressable key={n.id} style={[s.item, !n.read && s.unread]} onPress={async () => {
          await api.readNotification(userId, n.id);
          await syncProjectSideEffects({ user: user ?? ({ id: userId } as any), project: activeProject });
          const back = role === 'contractor' ? '/(contractor)/(tabs)/profile' : '/(customer)/(tabs)/profile';
          // W118: все переходы через pushOsNav SoT
          if (n.notification_type === 'change_order') {
            pushOsNav(changeOrderEstimateRoute(role, back), undefined, role);
            reload();
            return;
          }
          if (n.link_path) {
            pushOsNav(n.link_path, back, role);
            reload();
            return;
          }
          const fallback = resolveNotificationLink(n.notification_type, role);
          if (fallback) {
            pushOsNav({ pathname: fallback.pathname, params: fallback.params }, undefined, role);
          }
          reload();
        }}>
          <Text style={s.title}>{n.title}</Text>
          <Text style={s.body}>{n.body}</Text>
          <View style={s.snoozeRow}>
            <Pressable onPress={(e) => snooze(e, n.id, 1)}><Text style={s.snooze}>1ч</Text></Pressable>
            <Pressable onPress={(e) => snooze(e, n.id, 24)}><Text style={s.snooze}>24ч</Text></Pressable>
            <Pressable onPress={(e) => snooze(e, n.id, 72)}><Text style={s.snooze}>3д</Text></Pressable>
          </View>
          <SnoozeUntilPicker userId={userId} notificationId={n.id} onDone={async () => reload()} />
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
