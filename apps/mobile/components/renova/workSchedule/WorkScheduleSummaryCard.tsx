import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { calendarTabRoute, type OsRole } from '@/constants/osSections';

import { api } from '@/lib/api';
import type { WorkSchedule, WorkScheduleItem } from '@/lib/api/workSchedule';
import { RenovaTheme, card } from '@/constants/Theme';

type Props = {
  userId: string;
  projectId: string;
  role?: OsRole;
  /** Факт исполнения по этапам (Stage / OS snapshot) — не путать с планом графика. */
  projectComplete?: boolean;
  /** Фактический % по этапам (0–100), если известен. */
  stageFactPercent?: number | null;
};

function statusLabel(status?: string | null) {
  switch (status) {
    case 'draft':
      return 'Черновик плана';
    case 'submitted':
      return 'План на согласовании';
    case 'confirmed':
      return 'План согласован';
    case 'rejected':
      return 'План возвращён';
    default:
      return 'План не создан';
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

/**
 * Карточка = ПЛАН (Work Schedule).
 * Факт этапов (Stage / projectComplete) показывается отдельно — иначе KPI «100%»
 * конфликтует с «0% / не создан» (A-03).
 */
export function WorkScheduleSummaryCard({
  userId,
  projectId,
  role = 'customer',
  projectComplete = false,
  stageFactPercent = null,
}: Props) {
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

  const hasPlan = Boolean(schedule);
  const planProgress = stats.total ? Math.round((stats.accepted / stats.total) * 100) : null;
  const factPercent = projectComplete
    ? 100
    : typeof stageFactPercent === 'number'
      ? Math.max(0, Math.min(100, Math.round(stageFactPercent)))
      : null;

  const subtitle = loading
    ? 'Загрузка...'
    : hasPlan
      ? statusLabel(schedule?.status)
      : 'План не создан';

  // Полоска прогресса отражает только план; без плана — не рисуем «0% работ».
  const progressBarWidth = hasPlan ? (planProgress ?? 0) : 0;
  const showPlanBar = hasPlan && stats.total > 0;

  const progressText = !hasPlan
    ? (
      factPercent != null
        ? `План не заведён · факт по этапам ${factPercent}%`
        : 'План не заведён — прогресс графика не считается'
    )
    : stats.total === 0
      ? (
        factPercent != null
          ? `В плане нет пунктов · факт по этапам ${factPercent}%`
          : 'В плане пока нет пунктов'
      )
      : (
        factPercent != null && factPercent !== planProgress
          ? `План ${planProgress}% принято · факт этапов ${factPercent}%`
          : `План ${planProgress}% принято · ${stats.accepted}/${stats.total}`
      );

  const tone = stats.delayed > 0 ? RenovaTheme.colors.dangerText : RenovaTheme.colors.textMuted;

  return (
    <Pressable
      style={styles.card}
      onPress={() => router.push(calendarTabRoute(role) as never)}
      accessibilityRole="button"
    >
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.title}>График работ</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>
        <Text style={styles.link}>Открыть →</Text>
      </View>

      <View style={styles.progressBox}>
        {showPlanBar ? (
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progressBarWidth}%` }]} />
          </View>
        ) : (
          <View style={[styles.progressTrack, styles.progressTrackMuted]} />
        )}
        <Text style={styles.progressText}>{progressText}</Text>
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
        <Text style={styles.emptyText}>
          {!hasPlan
            ? (projectComplete
              ? 'Проект по этапам завершён. Создайте или откройте график, если нужен план.'
              : 'Создайте график из этапов проекта — это план, а не факт исполнения.')
            : stats.total === 0
              ? 'График создан, но пункты ещё не добавлены.'
              : 'Все пункты графика закрыты.'}
        </Text>
      )}

      {stats.delayed > 0 ? <Text style={[styles.warning, { color: tone }]}>Есть риск по срокам плана: {stats.delayed}</Text> : null}
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
  progressTrackMuted: { opacity: 0.45 },
  progressFill: { height: 6, borderRadius: RenovaTheme.radius.pill, backgroundColor: RenovaTheme.colors.primaryMuted },
  progressText: { fontSize: RenovaTheme.fontSize.caption, color: RenovaTheme.colors.textMuted },
  list: { gap: 6 },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', gap: RenovaTheme.spacing.sm },
  itemTitle: { flex: 1, fontSize: RenovaTheme.fontSize.bodySmall, color: RenovaTheme.colors.text },
  itemDate: { fontSize: RenovaTheme.fontSize.caption, color: RenovaTheme.colors.textMuted },
  emptyText: { fontSize: RenovaTheme.fontSize.bodySmall, color: RenovaTheme.colors.textMuted, lineHeight: 18 },
  warning: { fontSize: RenovaTheme.fontSize.caption, fontWeight: RenovaTheme.fontWeight.semibold },
});
