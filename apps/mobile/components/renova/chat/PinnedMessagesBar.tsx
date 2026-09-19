/**
 * Шапка переписки с закреплёнными сообщениями.
 *
 * Сообщение остаётся на своём месте в истории — здесь только ссылка на него.
 * Раньше закреплённые переставлялись в начало массива сообщений, то есть в
 * самое начало истории, куда переписка не прокручивается: закрепление не
 * поднимало сообщение, а прятало его.
 *
 * Весь расчёт текста и порядка — в `lib/domain/pinnedMessages`.
 */
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { pinnedLabel, type PinnedEntry } from '@/lib/domain/pinnedMessages';

export function PinnedMessagesBar({
  entries,
  onJump,
}: {
  entries: PinnedEntry[];
  onJump: (messageId: string) => void;
}) {
  if (!entries.length) return null;

  return (
    <View style={s.wrap} accessibilityRole="summary">
      <Text style={s.label}>📌 {pinnedLabel(entries.length)}</Text>
      <ScrollView
        horizontal={entries.length > 1}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.row}
      >
        {entries.map((entry) => (
          <Pressable
            key={entry.id}
            style={s.chip}
            accessibilityRole="button"
            accessibilityLabel={`Перейти к закреплённому сообщению: ${entry.preview}`}
            onPress={() => onJump(entry.id)}
          >
            <Text style={s.chipText} numberOfLines={1}>
              {entry.preview}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    paddingHorizontal: RenovaTheme.spacing.lg,
    paddingVertical: RenovaTheme.spacing.sm,
    backgroundColor: RenovaTheme.colors.surfaceMuted,
    borderBottomWidth: 1,
    borderBottomColor: RenovaTheme.colors.border,
    gap: RenovaTheme.spacing.xs,
  },
  label: {
    fontSize: RenovaTheme.fontSize.caption,
    color: RenovaTheme.colors.textMuted,
  },
  row: {
    flexDirection: 'row',
    gap: RenovaTheme.spacing.sm,
  },
  chip: {
    maxWidth: 260,
    paddingHorizontal: RenovaTheme.spacing.md,
    paddingVertical: RenovaTheme.spacing.sm,
    borderRadius: RenovaTheme.radius.sm,
    backgroundColor: RenovaTheme.colors.surface,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
  },
  chipText: {
    fontSize: RenovaTheme.fontSize.bodySmall,
    color: RenovaTheme.colors.text,
  },
});
