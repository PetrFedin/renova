import { Pressable, StyleSheet, Text, View } from 'react-native';

import { RenovaTheme } from '@/constants/Theme';
import type { ResponsibilityBucketKey, ResponsibilityItem, ResponsibilityQueue } from '@/lib/api';
import { selectActionQueueFocus } from '@/lib/domain/actionQueuePrimary';

const BUCKETS: Array<{ key: ResponsibilityBucketKey; label: string }> = [
  { key: 'mine_now', label: 'МОЁ СЕЙЧАС' },
  { key: 'waiting_other', label: 'ЖДУ ДРУГОГО' },
  { key: 'overdue', label: 'ПРОСРОЧЕНО' },
  { key: 'needs_evidence', label: 'НУЖНО ДОКАЗАТЕЛЬСТВО' },
  { key: 'waiting_review', label: 'ЖДЁТ ПРОВЕРКИ' },
  { key: 'waiting_owner_decision', label: 'ЖДЁТ РЕШЕНИЯ ВЛАДЕЛЬЦА' },
];

const ACTION_LABEL: Record<string, string> = {
  resolve_issue: 'Устранить замечание',
  verify_remediation: 'Проверить исправление',
  decide_work_acceptance: 'Принять решение по работе',
  resubmit_stage: 'Повторно сдать этап',
  pay_invoice: 'Оплатить счёт',
  confirm_payment_received: 'Подтвердить получение денег',
};

export function ActionQueueCard({
  queue,
  userId,
  readOnly,
  onOpenItem,
}: {
  queue: ResponsibilityQueue | null;
  userId: string;
  readOnly: boolean;
  onOpenItem: (item: ResponsibilityItem) => void;
}) {
  if (!queue || queue.count === 0) return null;
  const focus = selectActionQueueFocus(queue, userId, readOnly);
  if (!focus) return null;
  const { item: primary, isMine } = focus;

  return (
    <View style={s.card}>
      <Text style={s.eyebrow}>Очередь действий</Text>
      <View style={s.bucketGrid}>
        {BUCKETS.map(({ key, label }) => {
          const count = queue.bucket_counts?.[key] ?? queue.buckets?.[key]?.length ?? 0;
          return (
            <View key={key} style={s.bucket}>
              <Text style={s.bucketCount}>{count}</Text>
              <Text style={s.bucketLabel}>{label}</Text>
            </View>
          );
        })}
      </View>
      <Pressable
        accessibilityRole={isMine ? 'button' : undefined}
        accessibilityState={{ disabled: !isMine }}
        disabled={!isMine}
        onPress={() => onOpenItem(primary)}
        style={s.primary}
      >
        <View style={s.primaryCopy}>
          <Text style={s.primaryTitle}>{isMine ? ACTION_LABEL[primary.action] || primary.action : 'Ожидаем действие другого участника'}</Text>
          <Text numberOfLines={1} style={s.primaryMeta}>{primary.resource_title}</Text>
          {!isMine ? <Text style={s.primaryMeta}>{ACTION_LABEL[primary.action] || 'Действие участника'}</Text> : null}
        </View>
        {isMine ? <Text style={s.arrow}>→</Text> : null}
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    marginTop: 10,
    marginBottom: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.infoBorder,
    borderRadius: RenovaTheme.radius.lg,
    backgroundColor: RenovaTheme.colors.infoBg,
  },
  eyebrow: {
    fontSize: RenovaTheme.fontSize.caption,
    color: RenovaTheme.colors.infoText,
    fontWeight: RenovaTheme.fontWeight.semibold,
  },
  bucketGrid: {
    marginTop: 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  bucket: {
    width: '31%',
    minWidth: 96,
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: RenovaTheme.radius.md,
    backgroundColor: RenovaTheme.colors.surface,
  },
  bucketCount: {
    fontSize: RenovaTheme.fontSize.h3,
    color: RenovaTheme.colors.text,
    fontWeight: RenovaTheme.fontWeight.bold,
  },
  bucketLabel: {
    marginTop: 2,
    fontSize: 10,
    lineHeight: 13,
    color: RenovaTheme.colors.textMuted,
    fontWeight: RenovaTheme.fontWeight.semibold,
  },
  primary: {
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: RenovaTheme.colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  primaryCopy: { flex: 1 },
  primaryTitle: {
    fontSize: RenovaTheme.fontSize.body,
    color: RenovaTheme.colors.text,
    fontWeight: RenovaTheme.fontWeight.semibold,
  },
  primaryMeta: {
    marginTop: 2,
    fontSize: RenovaTheme.fontSize.caption,
    color: RenovaTheme.colors.textMuted,
  },
  arrow: {
    fontSize: RenovaTheme.fontSize.h3,
    color: RenovaTheme.colors.primary,
  },
});
