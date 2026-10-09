import { Pressable, StyleSheet, Text, View } from 'react-native';

import { RenovaTheme } from '@/constants/Theme';
import type { ResponsibilityBucketKey, ResponsibilityItem, ResponsibilityQueue } from '@/lib/api';

const BUCKETS: Array<{ key: ResponsibilityBucketKey; label: string }> = [
  { key: 'mine_now', label: 'МОЁ СЕЙЧАС' },
  { key: 'waiting_other', label: 'ЖДУ ДРУГОГО' },
  { key: 'overdue', label: 'ПРОСРОЧЕНО' },
  { key: 'needs_evidence', label: 'НУЖНО ДОКАЗАТЕЛЬСТВО' },
  { key: 'waiting_review', label: 'ЖДЁТ ПРОВЕРКИ' },
  { key: 'waiting_owner_decision', label: 'ЖДЁТ РЕШЕНИЯ ВЛАДЕЛЬЦА' },
];

const PERSONA_LABEL: Record<string, string> = {
  owner: 'Владелец',
  lead: 'Ведущий исполнитель',
  foreman: 'Прораб',
  member: 'Исполнитель',
  participant: 'Участник работ',
  supervisor: 'Технадзор',
  guest: 'Наблюдатель',
};

const ACTION_LABEL: Record<string, string> = {
  resolve_issue: 'Устранить замечание',
  verify_remediation: 'Проверить исправление',
  decide_work_acceptance: 'Принять решение по работе',
  resubmit_stage: 'Повторно сдать этап',
  pay_invoice: 'Оплатить счёт',
  confirm_payment_received: 'Подтвердить получение денег',
};

const PRIORITY: ResponsibilityBucketKey[] = [
  'overdue',
  'needs_evidence',
  'waiting_review',
  'waiting_owner_decision',
  'mine_now',
  'waiting_other',
];

function firstPriority(queue: ResponsibilityQueue): ResponsibilityItem | null {
  if (queue.buckets) {
    for (const key of PRIORITY) {
      const item = queue.buckets[key]?.[0];
      if (item) return item;
    }
  }
  return queue.items[0] ?? null;
}

export function ActionQueueCard({
  queue,
  onOpenItem,
}: {
  queue: ResponsibilityQueue | null;
  onOpenItem: (item: ResponsibilityItem) => void;
}) {
  if (!queue || queue.count === 0) return null;
  const primary = firstPriority(queue);
  if (!primary) return null;

  return (
    <View style={s.card}>
      <Text style={s.eyebrow}>ACTION QUEUE</Text>
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
      {queue.parallel && queue.parallel.active_actor_count > 1 ? (
        <View style={s.parallel}>
          <Text style={s.parallelTitle}>Сейчас действуют параллельно</Text>
          {queue.parallel.lanes.slice(0, 3).map((lane) => (
            <Pressable
              accessibilityRole="button"
              key={lane.actor_key}
              onPress={() => onOpenItem(lane.top_item)}
              style={s.parallelLane}
            >
              <View style={s.parallelCopy}>
                <Text style={s.parallelPersona}>
                  {lane.is_current_actor ? 'Вы' : (PERSONA_LABEL[lane.persona] || lane.persona)}
                </Text>
                <Text numberOfLines={1} style={s.parallelAction}>
                  {ACTION_LABEL[lane.top_item.action] || lane.top_item.action}
                </Text>
              </View>
              <Text style={s.parallelCount}>{lane.count}</Text>
            </Pressable>
          ))}
          {queue.parallel.active_actor_count > 3 ? (
            <Text style={s.parallelMore}>Ещё участников: {queue.parallel.active_actor_count - 3}</Text>
          ) : null}
        </View>
      ) : null}
      <Pressable accessibilityRole="button" onPress={() => onOpenItem(primary)} style={s.primary}>
        <View style={s.primaryCopy}>
          <Text style={s.primaryTitle}>{ACTION_LABEL[primary.action] || primary.action}</Text>
          <Text numberOfLines={1} style={s.primaryMeta}>{primary.resource_title}</Text>
        </View>
        <Text style={s.arrow}>→</Text>
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
  parallel: {
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: RenovaTheme.colors.border,
    gap: 8,
  },
  parallelTitle: {
    fontSize: RenovaTheme.fontSize.caption,
    color: RenovaTheme.colors.textMuted,
    fontWeight: RenovaTheme.fontWeight.semibold,
  },
  parallelLane: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
  },
  parallelCopy: { flex: 1 },
  parallelPersona: {
    fontSize: RenovaTheme.fontSize.caption,
    color: RenovaTheme.colors.text,
    fontWeight: RenovaTheme.fontWeight.semibold,
  },
  parallelAction: {
    marginTop: 1,
    fontSize: RenovaTheme.fontSize.caption,
    color: RenovaTheme.colors.textMuted,
  },
  parallelCount: {
    minWidth: 20,
    textAlign: 'right',
    fontSize: RenovaTheme.fontSize.body,
    color: RenovaTheme.colors.text,
    fontWeight: RenovaTheme.fontWeight.bold,
  },
  parallelMore: {
    fontSize: RenovaTheme.fontSize.caption,
    color: RenovaTheme.colors.textMuted,
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
