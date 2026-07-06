/** Ссылки «Ещё» в профиле — замена удалённого MoreMenu */
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { RenovaTheme, card } from '@/constants/Theme';
import { pushOsNav } from '@/lib/pushOsNav';

export type ProfileExtraItem = {
  label: string;
  desc?: string;
  href: string;
};

export function ProfileExtraLinks({
  items,
  returnTo,
}: {
  items: ProfileExtraItem[];
  returnTo?: string;
}) {
  return (
    <View style={s.wrap}>
      {items.map((item) => (
        <Pressable
          key={item.href}
          style={[s.row, card]}
          onPress={() => pushOsNav(item.href, returnTo)}
        >
          <View style={s.meta}>
            <Text style={s.label}>{item.label}</Text>
            {item.desc ? <Text style={s.desc}>{item.desc}</Text> : null}
          </View>
          <Text style={s.chev}>›</Text>
        </Pressable>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 4 },
  meta: { flex: 1 },
  label: { fontSize: 15, fontWeight: '600', color: RenovaTheme.colors.text },
  desc: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginTop: 2 },
  chev: { fontSize: 20, color: RenovaTheme.colors.textSubtle, fontWeight: '300' },
});
