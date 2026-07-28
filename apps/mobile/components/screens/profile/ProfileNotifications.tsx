/**
 * Уведомления в профиле — deep-link во Входящие (канон /inbox),
 * без параллельного NotificationCenter / NotificationsList.
 */
import { Text, View, StyleSheet } from 'react-native';
import { usePathname } from 'expo-router';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { RenovaTheme } from '@/constants/Theme';
import type { OsRole } from '@/constants/osSections';
import { pushOsNav } from '@/lib/pushOsNav';

type Props = {
  role: OsRole;
  /** returnTo для стека inbox */
  returnTo?: string;
};

export function ProfileNotifications({ role, returnTo }: Props) {
  const pathname = usePathname() ?? '';
  const from = returnTo || pathname;

  return (
    <View style={s.wrap}>
      <Text style={s.hint}>Задачи, чат и системные уведомления — в одном канале «Входящие».</Text>
      <PrimaryButton
        title="Открыть входящие"
        variant="outline"
        onPress={() => pushOsNav('/inbox', from, role)}
      />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 10 },
  hint: {
    fontSize: 13,
    lineHeight: 18,
    color: RenovaTheme.colors.textMuted,
  },
});
