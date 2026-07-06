/** Горизонтальные вкладки внутри hub-раздела (Объект / Ремонт / Бюджет) */
import { ScrollView, Pressable, Text, StyleSheet, View } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';

export type HubTab = { id: string; label: string; badge?: number };

type Props = {
  tabs: HubTab[];
  value: string;
  onChange: (id: string) => void;
};

export function OsHubTabs({ tabs, value, onChange }: Props) {
  return (
    <View style={s.wrap}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.row}>
        {tabs.map((t) => {
          const on = t.id === value;
          return (
            <Pressable
              key={t.id}
              style={[s.tab, on && s.tabOn]}
              onPress={() => onChange(t.id)}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
            >
              <Text style={[s.label, on && s.labelOn]}>{t.label}</Text>
              {t.badge != null && t.badge > 0 ? (
                <View style={s.badge}><Text style={s.badgeT}>{t.badge > 9 ? '9+' : t.badge}</Text></View>
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    borderBottomWidth: 1,
    borderBottomColor: RenovaTheme.colors.border,
    backgroundColor: RenovaTheme.colors.surface,
  },
  row: { paddingHorizontal: 12, paddingVertical: 8, gap: 8 },
  tab: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: RenovaTheme.colors.background,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  tabOn: { backgroundColor: RenovaTheme.colors.infoBg, borderColor: RenovaTheme.colors.accent },
  label: { fontSize: 13, fontWeight: '600', color: RenovaTheme.colors.textMuted },
  labelOn: { color: RenovaTheme.colors.accent },
  badge: { minWidth: 18, height: 18, borderRadius: 9, backgroundColor: RenovaTheme.colors.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  badgeT: { fontSize: 10, fontWeight: '800', color: RenovaTheme.colors.surface },
});
