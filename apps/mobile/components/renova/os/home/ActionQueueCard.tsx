import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { RenovaTheme } from '@/constants/Theme';
import type { ResponsibilityBucketKey, ResponsibilityItem, ResponsibilityQueue } from '@/lib/api';
import {
  filterActionQueueRows,
  getActionQueueRows,
  type ActionQueueFilter,
} from '@/lib/domain/actionQueuePrimary';

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

const PERSONA_LABEL: Record<string, string> = {
  owner: 'владелец',
  lead: 'ведущий исполнитель',
  foreman: 'прораб',
  member: 'исполнитель',
  participant: 'участник работ',
  supervisor: 'технадзор',
  guest: 'наблюдатель',
};

const PAGE_SIZE = 5;
const actionLabel = (action: string) => ACTION_LABEL[action] ?? 'Действие по проекту';

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
  const [expanded, setExpanded] = useState(false);
  const [scope, setScope] = useState<ActionQueueFilter>('all');
  const [selectedBucket, setSelectedBucket] = useState<ResponsibilityBucketKey | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  if (!queue || queue.count === 0) return null;
  const rows = getActionQueueRows(queue, userId, readOnly);
  const primary = rows[0];
  if (!primary) return null;
  const mineCount = rows.filter((row) => row.isMine).length;
  const waitingCount = rows.length - mineCount;
  const filtered = filterActionQueueRows(rows, scope)
    .filter((row) => !selectedBucket || row.bucket === selectedBucket);
  const visible = filtered.slice(0, visibleCount);
  const remaining = filtered.length - visible.length;

  const toggleExpanded = () => {
    if (expanded) {
      setScope('all');
      setSelectedBucket(null);
      setVisibleCount(PAGE_SIZE);
    }
    setExpanded(!expanded);
  };

  const selectScope = (next: ActionQueueFilter) => {
    setScope(next);
    setSelectedBucket(null);
    setVisibleCount(PAGE_SIZE);
  };

  return (
    <View style={s.card}>
      <View style={s.heading}>
        <Text style={s.eyebrow}>Очередь действий</Text>
        <Text style={s.total}>{queue.count} всего</Text>
      </View>
      {queue.buckets ? (
        <View style={s.bucketGrid}>
          {BUCKETS.map(({ key, label }) => {
            const count = queue.bucket_counts?.[key] ?? queue.buckets?.[key]?.length ?? 0;
            const selected = expanded && selectedBucket === key;
            return (
              <Pressable
                key={key}
                accessibilityRole="button"
                accessibilityLabel={label + ', ' + count}
                accessibilityState={{ selected, disabled: count === 0 }}
                disabled={count === 0}
                onPress={() => {
                  setExpanded(true);
                  setSelectedBucket((current) => current === key ? null : key);
                  setVisibleCount(PAGE_SIZE);
                }}
                style={[s.bucket, selected ? s.bucketSelected : null]}
              >
                <Text style={s.bucketCount}>{count}</Text>
                <Text style={s.bucketLabel}>{label}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {!expanded ? (
        <Pressable
          accessibilityRole={primary.isMine ? 'button' : undefined}
          accessibilityLabel={primary.isMine ? actionLabel(primary.item.action) : undefined}
          accessibilityState={{ disabled: !primary.isMine }}
          disabled={!primary.isMine}
          onPress={() => onOpenItem(primary.item)}
          style={s.primary}
        >
          <View style={s.primaryCopy}>
            <Text style={s.primaryTitle}>
              {primary.isMine ? actionLabel(primary.item.action) : 'Ожидаем действие другого участника'}
            </Text>
            <Text numberOfLines={2} style={s.primaryMeta}>{primary.item.resource_title}</Text>
            {!primary.isMine ? (
              <Text style={s.primaryMeta}>{actionLabel(primary.item.action)}</Text>
            ) : null}
          </View>
          {primary.isMine ? <Text style={s.arrow}>→</Text> : null}
        </Pressable>
      ) : (
        <View style={s.expanded}>
          <View style={s.scopeFilters}>
            {([
              { key: 'all', title: 'Все', count: rows.length },
              { key: 'mine', title: 'Мои', count: mineCount },
              { key: 'waiting', title: 'Ожидание', count: waitingCount },
            ] as Array<{ key: ActionQueueFilter; title: string; count: number }>).map((option) => (
              <Pressable
                key={option.key}
                accessibilityRole="button"
                accessibilityState={{ selected: scope === option.key }}
                onPress={() => selectScope(option.key)}
                style={[s.filter, scope === option.key ? s.filterActive : null]}
              >
                <Text style={[s.filterText, scope === option.key ? s.filterTextActive : null]}>
                  {option.title} {option.count}
                </Text>
              </Pressable>
            ))}
          </View>
          {selectedBucket ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setSelectedBucket(null);
                setVisibleCount(PAGE_SIZE);
              }}
              style={s.clearBucket}
            >
              <Text style={s.clearBucketText}>Сбросить фильтр категории</Text>
            </Pressable>
          ) : null}
          {visible.length === 0 ? (
            <Text style={s.empty}>
              {scope === 'mine' ? 'Нет действий, назначенных вам' : 'В этой категории пока нет действий'}
            </Text>
          ) : visible.map((row) => (
            <Pressable
              key={row.key}
              accessibilityRole={row.isMine ? 'button' : undefined}
              accessibilityLabel={row.isMine ? actionLabel(row.item.action) + ': ' + row.item.resource_title : undefined}
              accessibilityState={{ disabled: !row.isMine }}
              disabled={!row.isMine}
              onPress={() => onOpenItem(row.item)}
              style={[s.actionRow, row.isMine ? s.actionMine : null]}
            >
              <View style={s.primaryCopy}>
                <Text style={s.actionTitle}>{actionLabel(row.item.action)}</Text>
                <Text style={s.actionResource} numberOfLines={2}>{row.item.resource_title}</Text>
                <Text style={s.actionMeta}>
                  {row.isMine
                    ? 'Ваше действие'
                    : 'Ожидаем: ' + (PERSONA_LABEL[row.item.responsible_persona] ?? 'участник проекта')}
                  {row.bucket ? ' · ' + (BUCKETS.find((b) => b.key === row.bucket)?.label ?? '') : ''}
                </Text>
              </View>
              {row.isMine ? <Text style={s.arrow}>→</Text> : null}
            </Pressable>
          ))}
          {remaining > 0 ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setVisibleCount((count) => count + PAGE_SIZE)}
              style={s.more}
            >
              <Text style={s.moreText}>Показать ещё {Math.min(PAGE_SIZE, remaining)} из {remaining}</Text>
            </Pressable>
          ) : null}
        </View>
      )}

      {rows.length > 1 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          onPress={toggleExpanded}
          style={s.expandToggle}
        >
          <Text style={s.expandText}>{expanded ? 'Свернуть очередь' : 'Показать все действия'}</Text>
        </Pressable>
      ) : null}
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
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  eyebrow: {
    fontSize: RenovaTheme.fontSize.caption,
    color: RenovaTheme.colors.infoText,
    fontWeight: RenovaTheme.fontWeight.semibold,
  },
  total: { fontSize: RenovaTheme.fontSize.caption, color: RenovaTheme.colors.textMuted },
  bucketGrid: { marginTop: 10, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  bucket: {
    minHeight: RenovaTheme.minTouch,
    flexGrow: 1,
    flexBasis: 112,
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: RenovaTheme.radius.md,
    backgroundColor: RenovaTheme.colors.surface,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
  },
  bucketSelected: {
    backgroundColor: RenovaTheme.colors.accentMuted,
    borderColor: RenovaTheme.colors.accent,
  },
  bucketCount: {
    fontSize: RenovaTheme.fontSize.h3,
    color: RenovaTheme.colors.text,
    fontWeight: RenovaTheme.fontWeight.bold,
  },
  bucketLabel: {
    marginTop: 2,
    fontSize: RenovaTheme.fontSize.tiny,
    lineHeight: 15,
    color: RenovaTheme.colors.textMuted,
    fontWeight: RenovaTheme.fontWeight.semibold,
  },
  primary: {
    marginTop: 12,
    minHeight: RenovaTheme.minTouch,
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
    marginTop: 4,
    fontSize: RenovaTheme.fontSize.caption,
    color: RenovaTheme.colors.textMuted,
  },
  arrow: { fontSize: RenovaTheme.fontSize.h3, color: RenovaTheme.colors.primary },
  expanded: { marginTop: 12, gap: 8 },
  scopeFilters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  filter: {
    minHeight: RenovaTheme.minTouch,
    flexGrow: 1,
    borderRadius: RenovaTheme.radius.md,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
    backgroundColor: RenovaTheme.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  filterActive: {
    borderColor: RenovaTheme.colors.accent,
    backgroundColor: RenovaTheme.colors.accentMuted,
  },
  filterText: {
    fontSize: RenovaTheme.fontSize.caption,
    color: RenovaTheme.colors.textMuted,
    fontWeight: RenovaTheme.fontWeight.medium,
  },
  filterTextActive: { color: RenovaTheme.colors.infoText, fontWeight: RenovaTheme.fontWeight.semibold },
  clearBucket: { minHeight: RenovaTheme.minTouch, justifyContent: 'center', alignSelf: 'flex-start' },
  clearBucketText: { color: RenovaTheme.colors.infoText, fontSize: RenovaTheme.fontSize.caption },
  actionRow: {
    minHeight: RenovaTheme.minTouch,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: RenovaTheme.colors.surface,
    borderColor: RenovaTheme.colors.border,
    borderWidth: 1,
    borderRadius: RenovaTheme.radius.md,
    padding: 12,
    gap: 8,
  },
  actionMine: { borderColor: RenovaTheme.colors.infoBorder },
  actionTitle: {
    fontSize: RenovaTheme.fontSize.body,
    color: RenovaTheme.colors.text,
    fontWeight: RenovaTheme.fontWeight.semibold,
  },
  actionResource: {
    marginTop: 4,
    fontSize: RenovaTheme.fontSize.bodySmall,
    color: RenovaTheme.colors.text,
  },
  actionMeta: { marginTop: 5, fontSize: RenovaTheme.fontSize.caption, color: RenovaTheme.colors.textMuted },
  empty: { paddingVertical: 14, color: RenovaTheme.colors.textMuted, fontSize: RenovaTheme.fontSize.bodySmall },
  more: { minHeight: RenovaTheme.minTouch, justifyContent: 'center', alignItems: 'center' },
  moreText: { fontSize: RenovaTheme.fontSize.bodySmall, color: RenovaTheme.colors.infoText },
  expandToggle: {
    marginTop: 8,
    minHeight: RenovaTheme.minTouch,
    justifyContent: 'center',
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: RenovaTheme.colors.border,
  },
  expandText: { fontSize: RenovaTheme.fontSize.bodySmall, color: RenovaTheme.colors.infoText },
});
