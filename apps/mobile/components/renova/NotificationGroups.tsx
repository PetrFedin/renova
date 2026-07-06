import { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { AppNotification } from '@/lib/api';
import { RenovaTheme } from '@/constants/Theme';

const LBL: Record<string, string> = { stage_review:'Этапы', payment_pending:'Оплаты', room_updated:'Комнаты', chat_message:'Чаты' };

export function NotificationGroups({ items, onRead }: { items: AppNotification[]; onRead: (id: string, n: AppNotification) => void }) {
  const groups = useMemo(() => {
    const m: Record<string, AppNotification[]> = {};
    for (const n of items) { const k = n.notification_type; (m[k] ||= []).push(n); }
    return Object.entries(m);
  }, [items]);
  return (
    <View>{groups.map(([k, list]) => (
      <View key={k} style={s.grp}>
        <Text style={s.head}>{LBL[k] || k} ({list.length})</Text>
        {list.slice(0, 3).map(n => (
          <Pressable key={n.id} style={[s.row, !n.read && s.unread]} onPress={() => onRead(n.id, n)}>
            <Text style={s.t}>{n.title}</Text><Text style={s.b}>{n.body}</Text>
          </Pressable>
        ))}
      </View>
    ))}</View>
  );
}
const s = StyleSheet.create({
  grp:{ marginBottom:12 },
  head:{ fontWeight:'800', fontSize:13, color: RenovaTheme.colors.text, marginBottom:6 },
  row:{ backgroundColor:'#F8FAFC', padding:10, borderRadius:8, marginBottom:4, borderWidth:1, borderColor: RenovaTheme.colors.border },
  unread:{ borderLeftWidth:3, borderLeftColor: RenovaTheme.colors.primary },
  t:{ fontWeight:'600' }, b:{ fontSize:12, color: RenovaTheme.colors.textMuted },
});
