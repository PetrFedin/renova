/** Логотип RENOVA — слева в шапке, тап → главная */
import { Pressable, Text, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { RenovaTheme } from '@/constants/Theme';
import { tabsRoute, type OsRole } from '@/constants/osSections';

export function OsRenovaLogo({ role }: { role: OsRole }) {
  const goHome = () => router.replace(tabsRoute(role, 'index') as any);

  return (
    <Pressable
      onPress={goHome}
      style={s.wrap}
      accessibilityRole="button"
      accessibilityLabel="Renova — на главную"
      hitSlop={8}
    >
      <Text style={s.brand}>RENOVA</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  wrap: { marginRight: 10, paddingVertical: 2 },
  brand: {
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: 1.2,
    color: RenovaTheme.colors.text,
  },
});
