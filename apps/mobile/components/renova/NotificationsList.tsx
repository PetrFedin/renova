import { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { RenovaTheme } from '@/constants/Theme';
import { api, AppNotification } from '@/lib/api';

import { resolvePushLink } from '@/lib/pushLinks';

export function NotificationsList({ userId, defaultReturn }: { userId: string; defaultReturn?: string }) {
  const [items, setItems] = useState<AppNotification[]>([]);
  useEffect(() => { api.listNotifications(userId).then(setItems).catch(() => {}); }, [userId]);
  if (!items.length) return <Text style={s.empty}>Нет уведомлений</Text>;
  return (
    <View style={s.wrap}>
      {items.slice(0, 10).map((n) => (
        <Pressable key={n.id} style={[s.row, !n.read && s.unread]} onPress={async () => {
          await api.readNotification(userId, n.id);
          const back = (n as any).return_to || defaultReturn || '/(customer)/(tabs)/profile';
          const target = resolvePushLink(n.link_path, back);
          if (target) router.push({ pathname: target.pathname, params: target.params } as any);
          setItems(await api.listNotifications(userId));
        }}>
          <Text style={s.title}>{n.title}</Text><Text style={s.body}>{n.body}</Text>
        </Pressable>
      ))}
    </View>
  );
}
const s = StyleSheet.create({
  wrap:{ gap:8 }, row:{ backgroundColor:RenovaTheme.colors.surface, padding:12, borderRadius:10 },
  unread:{ borderLeftWidth:3, borderLeftColor: RenovaTheme.colors.primary },
  title:{ fontWeight:'700' }, body:{ fontSize:13, color: RenovaTheme.colors.textMuted, marginTop:2 },
  empty:{ color: RenovaTheme.colors.textMuted, marginVertical:8 },
});
