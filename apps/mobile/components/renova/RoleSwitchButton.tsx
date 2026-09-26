/** Возврат на экран «Заказчик / Исполнитель» */
import { Pressable, Text, StyleSheet } from 'react-native';
import { replaceOsNav } from '@/lib/pushOsNav';
import { RenovaTheme, card } from '@/constants/Theme';
import { useRenova } from '@/lib/context/RenovaContext';
import type { UserRole } from '@/lib/api';

export function roleDisplayLabel(role?: UserRole | string | null): string {
  return role === 'contractor' ? 'Исполнитель' : 'Заказчик';
}

/**
 * Имя кнопки смены роли.
 *
 * Нажатие вызывает `logout()` и уводит на выбор роли — то есть выходит из
 * учётной записи. Видимая подпись «Заказчик · Исполнитель» об этом молчит и
 * читается как переключатель; читалке мы обязаны сказать прямо.
 */
const ROLE_SWITCH_A11Y = (roleLabel: string) =>
  `Сменить роль. Сейчас ${roleLabel}. Выход из учётной записи`;

export function RoleSwitchButton({ compact }: { compact?: boolean }) {
  const { user, logout } = useRenova();
  const roleLabel = roleDisplayLabel(user?.role);

  async function onPress() {
    await logout();
    replaceOsNav('/onboarding/role');
  }

  if (compact) {
    return (
      <Pressable
        style={s.compact}
        onPress={onPress}
        accessibilityRole="button"
        // Кнопка выходит из учётной записи, а подпись читается как
        // переключатель. Имя должно называть последствие, а не намёк.
        accessibilityLabel={ROLE_SWITCH_A11Y(roleLabel)}
      >
        <Text style={s.compactText}>← Выбор роли</Text>
        <Text style={s.compactSub}>{roleLabel} · сменить →</Text>
      </Pressable>
    );
  }

  return (
    <Pressable
      style={s.btn}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={ROLE_SWITCH_A11Y(roleLabel)}
    >
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
