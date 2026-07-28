/** Горизонтальные вкладки hub — Clarity C: underline, не pill-карточки */
import { useMemo, useState } from 'react';
import { ScrollView, Pressable, Text, StyleSheet, View } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';

export type HubTab = {
  id: string;
  label: string;
  badge?: number;
  /** Progressive disclosure — вторичные вкладки за «Все» */
  secondary?: boolean;
};

type Props = {
  tabs: HubTab[];
  value: string;
  onChange: (id: string) => void;
};

export function OsHubTabs({ tabs, value, onChange }: Props) {
  const primary = useMemo(() => tabs.filter((t) => !t.secondary), [tabs]);
  const secondary = useMemo(() => tabs.filter((t) => t.secondary), [tabs]);
  const valueIsSecondary = secondary.some((t) => t.id === value);
  const [moreOpen, setMoreOpen] = useState(valueIsSecondary);

  const expanded = moreOpen || valueIsSecondary;
  const visible = expanded || secondary.length === 0 ? tabs : primary;

  return (
    <View style={s.wrap}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.row}>
        {visible.map((t) => {
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
                <View style={s.badge}>
                  <Text style={s.badgeT}>{t.badge > 9 ? '9+' : t.badge}</Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
        {secondary.length > 0 && !expanded ? (
          <Pressable
            style={s.tab}
            onPress={() => setMoreOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Все вкладки"
          >
            <Text style={s.label}>Все</Text>
            {secondary.some((t) => (t.badge ?? 0) > 0) ? (
              <View style={s.badge}>
                <Text style={s.badgeT}>
                  {(() => {
                    const n = secondary.reduce((sum, t) => sum + (t.badge ?? 0), 0);
                    return n > 9 ? '9+' : String(n);
                  })()}
                </Text>
              </View>
            ) : null}
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: RenovaTheme.colors.border,
    backgroundColor: RenovaTheme.colors.surface,
  },
  row: { paddingHorizontal: 8, paddingTop: 4, gap: 4 },
  tab: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabOn: { borderBottomColor: RenovaTheme.colors.primary },
  label: { fontSize: 14, fontWeight: '500', color: RenovaTheme.colors.textMuted },
  labelOn: { color: RenovaTheme.colors.text, fontWeight: '700' },
  badge: {
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: RenovaTheme.colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeT: { fontSize: 9, fontWeight: '800', color: RenovaTheme.colors.surface },
});
