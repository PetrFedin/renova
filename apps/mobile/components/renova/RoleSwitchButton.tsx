/** Возврат на экран «Заказчик / Исполнитель» */
import { Pressable, Text, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { RenovaTheme, card } from '@/constants/Theme';
import { useRenova } from '@/lib/context/RenovaContext';

export function RoleSwitchButton({ compact }: { compact?: boolean }) {
  const { user, logout } = useRenova();
  const roleLabel = user?.role === 'contractor' ? 'Исполнитель' : 'Заказчик';

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
    <View style={s.wrap}>
      <Text style={s.hint}>Сейчас: {roleLabel}</Text>
      <Pressable style={s.btn} onPress={onPress}>
        <Text style={s.btnText}>← Выбор роли</Text>
        <Text style={s.btnSub}>Заказчик · Исполнитель</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginBottom: 12 },
  hint: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginBottom: 6 },
  btn: { ...card, paddingVertical: 12 },
  btnText: { fontSize: 15, fontWeight: '700', color: RenovaTheme.colors.primary },
  btnSub: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginTop: 2 },
  compact: { ...card, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, borderWidth: 1, borderColor: '#bfdbfe', backgroundColor: '#eff6ff' },
  compactText: { fontSize: 15, fontWeight: '700', color: RenovaTheme.colors.text },
  compactSub: { fontSize: 13, color: RenovaTheme.colors.primary, fontWeight: '600' },
});
