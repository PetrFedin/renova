import { Pressable, StyleSheet, Text, View } from 'react-native';

import { RenovaTheme } from '@/constants/Theme';
import type { ResponsibilityQueue } from '@/lib/api';

const ACTION_LABEL: Record<string, string> = {
  resolve_issue: 'Устранить замечание',
  verify_remediation: 'Проверить исправление',
  resubmit_stage: 'Повторно сдать этап',
  decide_work_acceptance: 'Принять решение по работе',
};

export function RepairResponsibilityStrip({
  queue,
  userId,
  onOpenControl,
}: {
  queue: ResponsibilityQueue | null;
  userId: string;
  onOpenControl: () => void;
}) {
  const item = queue?.items?.find((candidate) => candidate.resource_type === 'issue');
  if (!item) return null;

  const mine = item.responsible_user_id === userId;
  return (
    <Pressable accessibilityRole="button" onPress={onOpenControl} style={s.wrap}>
      <View style={s.copy}>
        <Text style={s.kicker}>{mine ? 'МОЁ СЕЙЧАС' : 'ЖДУ ДРУГОГО'}</Text>
        <Text style={s.title}>{ACTION_LABEL[item.action] || item.action}</Text>
        <Text numberOfLines={1} style={s.meta}>{item.resource_title}</Text>
      </View>
      <Text style={s.arrow}>→</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  wrap: {
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 4,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
    borderRadius: RenovaTheme.radius.md,
    backgroundColor: RenovaTheme.colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  copy: { flex: 1 },
  kicker: {
    fontSize: RenovaTheme.fontSize.caption,
    color: RenovaTheme.colors.textMuted,
    fontWeight: RenovaTheme.fontWeight.semibold,
  },
  title: {
    marginTop: 2,
    fontSize: RenovaTheme.fontSize.body,
    color: RenovaTheme.colors.text,
    fontWeight: RenovaTheme.fontWeight.semibold,
  },
  meta: {
    marginTop: 2,
    fontSize: RenovaTheme.fontSize.caption,
    color: RenovaTheme.colors.textMuted,
  },
  arrow: {
    fontSize: RenovaTheme.fontSize.h3,
    color: RenovaTheme.colors.primary,
  },
});
