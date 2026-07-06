/** Сворачиваемая секция — вторичный контент ниже fold */
import { useState, type ReactNode } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { RenovaTheme, card } from '@/constants/Theme';

type Props = {
  title: string;
  summary?: string;
  defaultOpen?: boolean;
  children: ReactNode;
};

export function StageDetailAccordion({ title, summary, defaultOpen = false, children }: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <View style={s.wrap}>
      <Pressable style={s.head} onPress={() => setOpen((v) => !v)} accessibilityRole="button">
        <View style={s.headText}>
          <Text style={s.title}>{title}</Text>
          {!open && summary ? <Text style={s.summary}>{summary}</Text> : null}
        </View>
        <Ionicons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={RenovaTheme.colors.textMuted}
        />
      </Pressable>
      {open ? <View style={s.body}>{children}</View> : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginTop: RenovaTheme.spacing.md },
  head: {
    ...card,
    flexDirection: 'row',
    alignItems: 'center',
    padding: RenovaTheme.spacing.md,
    gap: 8,
  },
  headText: { flex: 1, minWidth: 0 },
  title: { fontSize: RenovaTheme.fontSize.h3, fontWeight: RenovaTheme.fontWeight.bold, color: RenovaTheme.colors.text },
  summary: { fontSize: RenovaTheme.fontSize.caption, color: RenovaTheme.colors.textMuted, marginTop: 2 },
  body: { marginTop: 8, gap: 8 },
});
