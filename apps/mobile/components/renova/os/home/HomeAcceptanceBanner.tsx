/** «N ждут приёмки» на главной — роль-зависимый CTA (W56/W107) */
import { Text, StyleSheet, Pressable } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { repairTabRoute, type OsRole } from '@/constants/osSections';
import { useOsNavFromHere } from '@/lib/navigation';
import { pushOsNav, type OsNavHref } from '@/lib/pushOsNav';

type Props = {
  count: number;
  role: OsRole;
  /** W107: прямой /stage/{id} если известен этап в review */
  href?: OsNavHref;
};

export function HomeAcceptanceBanner({ count, role, href }: Props) {
  const { returnTo } = useOsNavFromHere(role);
  if (count <= 0) return null;

  const isContractor = role === 'contractor';
  const head = isContractor
    ? `${count} этап(ов) ждут ответа заказчика`
    : `${count} этап(ов) ждут вашей приёмки`;
  const link = isContractor ? 'Статус →' : 'Проверить →';

  return (
    <Pressable
      style={s.box}
      onPress={() => {
        // W107: этап → decide CTA; иначе hub control (inline accept)
        pushOsNav(href || repairTabRoute(role, 'control'), returnTo);
      }}
      accessibilityRole="button"
      accessibilityLabel={head}
    >
      <Text style={s.head}>{head}</Text>
      <Text style={s.link}>{link}</Text>
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
