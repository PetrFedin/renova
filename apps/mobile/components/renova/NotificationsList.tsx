/** Legacy twin ленты уведомлений — канон: /inbox (Investor P2: не плодить второй канал). */
import { useEffect } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { pushOsNav } from '@/lib/pushOsNav';
import type { OsRole } from '@/constants/osSections';
import { useRenova } from '@/lib/context/RenovaContext';

/**
 * W118 / DD: NotificationsList больше не дублирует inbox.
 * Оставлен как thin redirect для старых entryPoints / тестов journeyUnify.
 */
export function NotificationsList({
  userId: _userId,
  defaultReturn,
}: {
  userId: string;
  defaultReturn?: string;
}) {
  const { user } = useRenova();
  const role: OsRole = user?.role === 'contractor' ? 'contractor' : 'customer';
  const back = defaultReturn || (role === 'contractor' ? '/(contractor)/(tabs)/profile' : '/(customer)/(tabs)/profile');

  useEffect(() => {
    // Авто-редирект в канон — без второй ленты
    pushOsNav('/inbox', back, role);
  }, [back, role]);

  return (
    <View style={s.wrap}>
      <Text style={s.title}>Уведомления перенесены во «Входящие»</Text>
      <Text style={s.body}>Один канал внимания: задачи + сообщения. Открываем /inbox…</Text>
      <Pressable
        style={s.btn}
        onPress={() => pushOsNav('/inbox', back, role)}
        accessibilityRole="button"
      >
        <Text style={s.btnT}>Открыть входящие</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 8, paddingVertical: 8 },
  title: { fontWeight: '700', color: RenovaTheme.colors.text },
  body: { fontSize: 13, color: RenovaTheme.colors.textMuted },
  btn: {
    alignSelf: 'flex-start',
    backgroundColor: RenovaTheme.colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    marginTop: 4,
  },
  btnT: { color: RenovaTheme.colors.surface, fontWeight: '700', fontSize: 13 },
});
