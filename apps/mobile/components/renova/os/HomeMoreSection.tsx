/** Сворачиваемый блок «Ещё» — площадки, риски, бюджет, документы, архив */
import { useState, type ReactNode } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { RenovaTheme } from '@/constants/Theme';
import { homeLayout, homeTypography } from '@/constants/homeTypography';

export function HomeMoreSection({
  children,
  summary,
  defaultOpen = false,
}: {
  children: ReactNode;
  summary?: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const title = !open && summary ? `Ещё · ${summary}` : 'Ещё';

  return (
    <View style={s.wrap}>
      <Pressable style={s.head} onPress={() => setOpen((v) => !v)} accessibilityRole="button">
        <Text style={[homeTypography.zoneLabel, s.title]} numberOfLines={1}>{title}</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={RenovaTheme.colors.textMuted} />
      </Pressable>
      {open ? <View style={s.body}>{children}</View> : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginTop: homeLayout.innerGap, marginBottom: homeLayout.sectionGap },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderTopWidth: 1,
    borderTopColor: RenovaTheme.colors.border,
  },
  title: { flex: 1, textTransform: 'none', letterSpacing: 0, marginRight: 8 },
  body: { paddingTop: homeLayout.innerGap },
});
