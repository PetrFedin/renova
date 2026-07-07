/** Возврат на экран «Заказчик / Исполнитель» */
import { Pressable, Text, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { RenovaTheme, card } from '@/constants/Theme';
import { useRenova } from '@/lib/context/RenovaContext';
import type { UserRole } from '@/lib/api';

export function roleDisplayLabel(role?: UserRole | string | null): string {
  return role === 'contractor' ? 'Исполнитель' : 'Заказчик';
}

export function RoleSwitchButton({ compact }: { compact?: boolean }) {
  const { user, logout } = useRenova();
  const roleLabel = roleDisplayLabel(user?.role);

  async function onPress() {
    await logout();
    router.replace('/onboarding/role');
  }

  if (compact) {
    return (
      <Pressable style={s.compact} onPress={onPress}>
        <Text style={s.compactText}>← Выбор роли</Text>
        <Text style={s.compactSub}>{roleLabel} · сменить →</Text>
      </Pressable>
    );
  }

  return (
    <Pressable style={s.btn} onPress={onPress} accessibilityRole="button">
      <Text style={s.btnText}>← Выбор роли</Text>
      <Text style={s.btnSub}>Заказчик · Исполнитель</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  btn: { ...card, paddingVertical: 12, marginBottom: 16 },
  btnText: { fontSize: 15, fontWeight: '700', color: RenovaTheme.colors.primary },
  btnSub: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginTop: 2 },
  compact: {
    ...card,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: '#bfdbfe',
    backgroundColor: '#eff6ff',
    marginBottom: 16,
  },
  compactText: { fontSize: 15, fontWeight: '700', color: RenovaTheme.colors.text },
  compactSub: { fontSize: 13, color: RenovaTheme.colors.primary, fontWeight: '600' },
});
