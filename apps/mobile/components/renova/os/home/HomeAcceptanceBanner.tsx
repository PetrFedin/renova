/** «N ждут приёмки» на главной — 1 tap до очереди решений */
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { repairTabRoute, type OsRole } from '@/constants/osSections';
import { useOsNavFromHere } from '@/lib/navigation';

export function HomeAcceptanceBanner({ count, role }: { count: number; role: OsRole }) {
  const { pushNav } = useOsNavFromHere(role);
  if (count <= 0) return null;

  return (
    <Pressable
      style={s.box}
      onPress={() => pushNav(repairTabRoute(role, 'control'))}
      accessibilityRole="button"
    >
      <Text style={s.head}>{count} этап(ов) ждут вашей приёмки</Text>
      <Text style={s.link}>Проверить →</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  box: {
    marginBottom: 12,
    padding: 12,
    borderRadius: RenovaTheme.radius.md,
    backgroundColor: RenovaTheme.colors.warningBg,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.warningBorder,
  },
  head: { fontSize: 14, fontWeight: '700', color: RenovaTheme.colors.warningText },
  link: { fontSize: 13, fontWeight: '600', color: RenovaTheme.colors.accent, marginTop: 4 },
});
