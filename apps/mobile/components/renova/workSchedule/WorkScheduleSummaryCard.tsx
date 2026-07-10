import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';

import { api } from '@/lib/api';
import type { WorkSchedule, WorkScheduleItem } from '@/lib/api/workSchedule';
import { RenovaTheme, card } from '@/constants/Theme';

type Props = {
  userId: string;
  projectId: string;
};

function statusLabel(status?: string | null) {
  switch (status) {
    case 'draft':
      return 'Черновик';
    case 'submitted':
      return 'На согласовании';
    case 'confirmed':
      return 'Согласован';
    case 'rejected':
      return 'Возвращён';
    default:
      return 'Не создан';
  }
}

function formatShortDate(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' });
}

function pickNextItems(items: WorkScheduleItem[]) {
  return items
    .filter((item) => !['accepted', 'cancelled'].includes(item.status))
    .sort((a, b) => String(a.planned_start_date).localeCompare(String(b.planned_start_date)))
    .slice(0, 3);
}

export function WorkScheduleSummaryCard({ userId, projectId }: Props) {
  const [schedule, setSchedule] = useState<WorkSchedule | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    api.getActiveWorkSchedule(userId, projectId)
      .then((result) => {
        if (mounted) setSchedule(result);
      })
      .catch(() => {
        if (mounted) setSchedule(null);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [userId, projectId]);

  const stats = useMemo(() => {
    const items = schedule?.items ?? [];
    const total = items.length;
    const accepted = items.filter((item) => item.status === 'accepted').length;
    const delayed = items.filter((item) => (item.delay_days || 0) > 0 || item.status === 'delayed' || item.status === 'blocked').length;
    const next = pickNextItems(items);
    return { total, accepted, delayed, next };
  }, [schedule]);

  const progress = stats.total ? Math.round((stats.accepted / stats.total) * 100) : 0;
  const tone = stats.delayed > 0 ? RenovaTheme.colors.dangerText : RenovaTheme.colors.textMuted;

  return (
    <Pressable style={styles.card} onPress={() => router.push('/work-schedule')} accessibilityRole="button">
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.title}>График работ</Text>
          <Text style={styles.subtitle}>{loading ? 'Загрузка...' : statusLabel(schedule?.status)}</Text>
        </View>
        <Text style={styles.link}>Открыть →</Text>
      </View>

      <View style={styles.progressBox}>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progress}%` }]} />
        </View>
        <Text style={styles.progressText}>{progress}% принято · {stats.accepted}/{stats.total || 0}</Text>
      </View>

      {stats.next.length ? (
        <View style={styles.list}>
          {stats.next.map((item) => (
            <View key={item.id} style={styles.itemRow}>
              <Text style={styles.itemTitle} numberOfLines={1}>{item.title}</Text>
              <Text style={styles.itemDate}>{formatShortDate(item.planned_finish_date)}</Text>
            </View>
          ))}
        </View>
      ) : (
        <Text style={styles.emptyText}>{schedule ? 'Все пункты графика закрыты.' : 'Создайте график из этапов проекта.'}</Text>
      )}

      {stats.delayed > 0 ? <Text style={[styles.warning, { color: tone }]}>Есть риск по срокам: {stats.delayed}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { ...card, gap: RenovaTheme.spacing.sm },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', gap: RenovaTheme.spacing.md, alignItems: 'flex-start' },
  title: { fontSize: RenovaTheme.fontSize.h3, fontWeight: RenovaTheme.fontWeight.extrabold, color: RenovaTheme.colors.text },
  subtitle: { marginTop: 2, fontSize: RenovaTheme.fontSize.bodySmall, color: RenovaTheme.colors.textMuted },
  link: { fontSize: RenovaTheme.fontSize.bodySmall, fontWeight: RenovaTheme.fontWeight.semibold, color: RenovaTheme.colors.primaryMuted },
  progressBox: { gap: 6 },
  progressTrack: { height: 6, borderRadius: RenovaTheme.radius.pill, backgroundColor: RenovaTheme.colors.surfaceMuted, overflow: 'hidden' },
  progressFill: { height: 6, borderRadius: RenovaTheme.radius.pill, backgroundColor: RenovaTheme.colors.primaryMuted },
  progressText: { fontSize: RenovaTheme.fontSize.caption, color: RenovaTheme.colors.textMuted },
  list: { gap: 6 },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', gap: RenovaTheme.spacing.sm },
  itemTitle: { flex: 1, fontSize: RenovaTheme.fontSize.bodySmall, color: RenovaTheme.colors.text },
  itemDate: { fontSize: RenovaTheme.fontSize.caption, color: RenovaTheme.colors.textMuted },
  emptyText: { fontSize: RenovaTheme.fontSize.bodySmall, color: RenovaTheme.colors.textMuted, lineHeight: 18 },
  warning: { fontSize: RenovaTheme.fontSize.caption, fontWeight: RenovaTheme.fontWeight.semibold },
});
