import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';

import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { RenovaTheme, card } from '@/constants/Theme';
import { api } from '@/lib/api';
import type { WorkSchedule, WorkScheduleItem, WorkScheduleItemStatus } from '@/lib/api/workSchedule';
import { useRenova } from '@/lib/context/RenovaContext';

function statusLabel(status?: string | null) {
  switch (status) {
    case 'draft': return 'Черновик';
    case 'submitted': return 'На согласовании';
    case 'confirmed': return 'Согласован';
    case 'rejected': return 'Возвращён';
    case 'planned': return 'Запланировано';
    case 'ready': return 'Готово к старту';
    case 'in_progress': return 'В работе';
    case 'accepted': return 'Принято';
    case 'delayed': return 'Просрочка';
    case 'blocked': return 'Блокер';
    case 'cancelled': return 'Отменено';
    default: return 'Не создан';
  }
}

function statusTone(status?: string | null) {
  if (['confirmed', 'accepted'].includes(status || '')) {
    return { bg: RenovaTheme.colors.successBg, border: RenovaTheme.colors.successBorder, text: RenovaTheme.colors.successText };
  }
  if (['submitted', 'ready', 'in_progress'].includes(status || '')) {
    return { bg: RenovaTheme.colors.infoBg, border: RenovaTheme.colors.infoBorder, text: RenovaTheme.colors.infoText };
  }
  if (['rejected', 'delayed', 'blocked'].includes(status || '')) {
    return { bg: RenovaTheme.colors.dangerBg, border: RenovaTheme.colors.dangerBorder, text: RenovaTheme.colors.dangerText };
  }
  return { bg: RenovaTheme.colors.neutralBg, border: RenovaTheme.colors.neutralBorder, text: RenovaTheme.colors.neutralText };
}

function formatDate(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' });
}

function itemMeta(item: WorkScheduleItem) {
  const range = `${formatDate(item.planned_start_date)} — ${formatDate(item.planned_finish_date)}`;
  if ((item.delay_days || 0) > 0) return `${range} · задержка ${item.delay_days} дн.`;
  return range;
}

function openStageFromSchedule(stageId: string) {
  router.push(`/stage/${stageId}?returnTo=${encodeURIComponent('/work-schedule')}`);
}

type ItemCardProps = {
  item: WorkScheduleItem;
  canEdit: boolean;
  onStatus: (item: WorkScheduleItem, status: WorkScheduleItemStatus) => void;
};

function WorkScheduleItemCard({ item, canEdit, onStatus }: ItemCardProps) {
  const tone = statusTone((item.delay_days || 0) > 0 ? 'delayed' : item.status);
  const canChangeStatus = canEdit && !['accepted', 'cancelled'].includes(item.status);

  return (
    <View style={styles.itemCard}>
      <View style={styles.itemHeader}>
        <View style={styles.itemTextBlock}>
          <Text style={styles.itemTitle}>{item.title}</Text>
          <Text style={styles.itemMeta}>{itemMeta(item)}</Text>
        </View>
        <View style={[styles.badge, { backgroundColor: tone.bg, borderColor: tone.border }]}>
          <Text style={[styles.badgeText, { color: tone.text }]}>{statusLabel((item.delay_days || 0) > 0 ? 'delayed' : item.status)}</Text>
        </View>
      </View>

      {item.description ? <Text style={styles.itemDescription}>{item.description}</Text> : null}

      <View style={styles.progressLine}>
        <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${Math.max(0, Math.min(100, item.progress_percent || 0))}%` }]} /></View>
        <Text style={styles.progressText}>{Math.round(item.progress_percent || 0)}%</Text>
      </View>

      <View style={styles.itemActions}>
        {item.stage_id ? (
          <PrimaryButton title="Этап" variant="outline" compact onPress={() => openStageFromSchedule(item.stage_id!)} />
        ) : null}
        {canChangeStatus ? (
          <>
            <PrimaryButton title="В работе" variant="outline" compact onPress={() => onStatus(item, 'in_progress')} />
            <PrimaryButton title="Принято" compact onPress={() => onStatus(item, 'accepted')} />
          </>
        ) : null}
      </View>
    </View>
  );
}

export function WorkScheduleScreen() {
  const { user, activeProject, readOnly } = useRenova();
  const [schedule, setSchedule] = useState<WorkSchedule | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const canEdit = Boolean(user && activeProject && !readOnly);

  const load = useCallback(async () => {
    if (!user || !activeProject) return;
    try {
      setLoading(true);
      setSchedule(await api.getActiveWorkSchedule(user.id, activeProject.id));
    } catch {
      setSchedule(null);
    } finally {
      setLoading(false);
    }
  }, [user, activeProject]);

  useEffect(() => { load(); }, [load]);

  const stats = useMemo(() => {
    const items = schedule?.items ?? [];
    const total = items.length;
    const accepted = items.filter((item) => item.status === 'accepted').length;
    const blocked = items.filter((item) => item.status === 'blocked' || (item.delay_days || 0) > 0).length;
    const progress = total ? Math.round((accepted / total) * 100) : 0;
    return { total, accepted, blocked, progress };
  }, [schedule]);

  const createFromStages = async () => {
    if (!user || !activeProject || !canEdit) return;
    try {
      setActing(true);
      const result = await api.createWorkSchedule(user.id, activeProject.id, { title: 'План-график работ' });
      setSchedule(result);
    } catch {
      Alert.alert('Не удалось создать график', 'Проверьте, что в проекте есть этапы работ.');
    } finally {
      setActing(false);
    }
  };

  const submit = async () => {
    if (!user || !activeProject || !schedule || !canEdit) return;
    try {
      setActing(true);
      setSchedule(await api.submitWorkSchedule(user.id, activeProject.id, schedule.id));
    } finally { setActing(false); }
  };

  const confirm = async () => {
    if (!user || !activeProject || !schedule || !canEdit) return;
    try {
      setActing(true);
      setSchedule(await api.confirmWorkSchedule(user.id, activeProject.id, schedule.id));
    } finally { setActing(false); }
  };

  const updateItemStatus = async (item: WorkScheduleItem, status: WorkScheduleItemStatus) => {
    if (!user || !activeProject || !schedule || !canEdit) return;
    try {
      await api.updateWorkScheduleItemStatus(user.id, activeProject.id, schedule.id, item.id, { status, progress_percent: status === 'accepted' ? 100 : undefined });
      await load();
    } catch {
      Alert.alert('Не удалось обновить статус', 'Попробуйте ещё раз.');
    }
  };

  if (!user || !activeProject) {
    return (
      <View style={styles.center}>
        <Text style={styles.stateTitle}>Нет активного проекта</Text>
        <Text style={styles.stateText}>Выберите проект, чтобы открыть график работ.</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={RenovaTheme.colors.primaryMuted} />
        <Text style={styles.stateText}>Загружаем график работ...</Text>
      </View>
    );
  }

  const tone = statusTone(schedule?.status);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}><Text style={styles.back}>‹ Назад</Text></Pressable>
        <Text style={styles.title}>График работ</Text>
        <Text style={styles.subtitle}>Прогресс графика по срокам и задержкам — не путать с приёмкой работ (Control / work-acceptance).</Text>
      </View>

      {readOnly ? (
        <View style={styles.readOnlyNote}>
          <Text style={styles.readOnlyText}>Режим просмотра: можно открыть этапы и проверить сроки, но нельзя менять график.</Text>
        </View>
      ) : null}

      <View style={[styles.statusCard, { backgroundColor: tone.bg, borderColor: tone.border }]}>
        <Text style={[styles.statusText, { color: tone.text }]}>{statusLabel(schedule?.status)}</Text>
        <Text style={styles.statusDescription}>{stats.progress}% принято · {stats.accepted}/{stats.total} этапов · рисков по срокам: {stats.blocked}</Text>
      </View>

      {!schedule ? (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>График ещё не создан</Text>
          <Text style={styles.meta}>Создайте график из существующих этапов проекта. Это свяжет сроки, статусы и дальнейшую приёмку в один маршрут.</Text>
          <PrimaryButton title={acting ? 'Создаём...' : 'Создать из этапов'} onPress={createFromStages} loading={acting} disabled={!canEdit} fullWidth />
        </View>
      ) : (
        <>
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>{schedule.title}</Text>
            <Text style={styles.meta}>{formatDate(schedule.planned_start_date)} — {formatDate(schedule.planned_finish_date)}</Text>
            <View style={styles.progressTrackLarge}><View style={[styles.progressFillLarge, { width: `${stats.progress}%` }]} /></View>
            <View style={styles.actionRow}>
              {schedule.status === 'draft' || schedule.status === 'rejected' ? <PrimaryButton title="На согласование" onPress={submit} loading={acting} disabled={!canEdit} fullWidth /> : null}
              {schedule.status === 'submitted' ? <PrimaryButton title="Согласовать график" onPress={confirm} loading={acting} disabled={!canEdit} fullWidth /> : null}
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Этапы графика</Text>
            <View style={styles.list}>
              {schedule.items.map((item) => <WorkScheduleItemCard key={item.id} item={item} canEdit={canEdit} onStatus={updateItemStatus} />)}
            </View>
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: RenovaTheme.colors.background },
  content: { padding: RenovaTheme.spacing.lg, paddingBottom: 32, gap: RenovaTheme.spacing.md },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 8, backgroundColor: RenovaTheme.colors.background },
  header: { gap: 4 },
  back: { fontSize: RenovaTheme.fontSize.body, color: RenovaTheme.colors.primaryMuted, fontWeight: RenovaTheme.fontWeight.semibold },
  title: { fontSize: RenovaTheme.fontSize.h1, fontWeight: RenovaTheme.fontWeight.bold, color: RenovaTheme.colors.text },
  subtitle: { fontSize: RenovaTheme.fontSize.body, lineHeight: 20, color: RenovaTheme.colors.textMuted },
  readOnlyNote: { ...card, padding: RenovaTheme.spacing.md, backgroundColor: RenovaTheme.colors.surfaceMuted },
  readOnlyText: { fontSize: RenovaTheme.fontSize.bodySmall, color: RenovaTheme.colors.textMuted, lineHeight: 18 },
  statusCard: { borderWidth: 1, borderRadius: RenovaTheme.radius.lg, padding: RenovaTheme.spacing.md, gap: 4 },
  statusText: { fontSize: RenovaTheme.fontSize.h3, fontWeight: RenovaTheme.fontWeight.extrabold },
  statusDescription: { fontSize: RenovaTheme.fontSize.bodySmall, color: RenovaTheme.colors.text },
  card: { ...card, gap: RenovaTheme.spacing.md },
  sectionTitle: { fontSize: RenovaTheme.fontSize.h3, fontWeight: RenovaTheme.fontWeight.bold, color: RenovaTheme.colors.text },
  meta: { fontSize: RenovaTheme.fontSize.bodySmall, color: RenovaTheme.colors.textMuted, lineHeight: 18 },
  list: { gap: RenovaTheme.spacing.sm },
  itemCard: { borderWidth: 1, borderColor: RenovaTheme.colors.border, borderRadius: RenovaTheme.radius.lg, padding: RenovaTheme.spacing.md, backgroundColor: RenovaTheme.colors.surface, gap: RenovaTheme.spacing.sm },
  itemHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: RenovaTheme.spacing.sm, alignItems: 'flex-start' },
  itemTextBlock: { flex: 1, gap: 3 },
  itemTitle: { fontSize: RenovaTheme.fontSize.body, fontWeight: RenovaTheme.fontWeight.extrabold, color: RenovaTheme.colors.text },
  itemMeta: { fontSize: RenovaTheme.fontSize.caption, color: RenovaTheme.colors.textMuted },
  itemDescription: { fontSize: RenovaTheme.fontSize.bodySmall, color: RenovaTheme.colors.textMuted, lineHeight: 18 },
  badge: { borderWidth: 1, borderRadius: RenovaTheme.radius.pill, paddingHorizontal: 8, paddingVertical: 4 },
  badgeText: { fontSize: RenovaTheme.fontSize.tiny, fontWeight: RenovaTheme.fontWeight.extrabold },
  progressLine: { flexDirection: 'row', alignItems: 'center', gap: RenovaTheme.spacing.sm },
  progressTrack: { flex: 1, height: 6, borderRadius: RenovaTheme.radius.pill, backgroundColor: RenovaTheme.colors.surfaceMuted, overflow: 'hidden' },
  progressFill: { height: 6, borderRadius: RenovaTheme.radius.pill, backgroundColor: RenovaTheme.colors.primaryMuted },
  progressText: { width: 42, textAlign: 'right', fontSize: RenovaTheme.fontSize.caption, color: RenovaTheme.colors.textMuted },
  progressTrackLarge: { height: 8, borderRadius: RenovaTheme.radius.pill, backgroundColor: RenovaTheme.colors.surfaceMuted, overflow: 'hidden' },
  progressFillLarge: { height: 8, borderRadius: RenovaTheme.radius.pill, backgroundColor: RenovaTheme.colors.primaryMuted },
  itemActions: { flexDirection: 'row', flexWrap: 'wrap', gap: RenovaTheme.spacing.sm },
  actionRow: { gap: RenovaTheme.spacing.sm },
  stateTitle: { fontSize: RenovaTheme.fontSize.h3, fontWeight: RenovaTheme.fontWeight.bold, color: RenovaTheme.colors.text },
  stateText: { fontSize: RenovaTheme.fontSize.bodySmall, color: RenovaTheme.colors.textMuted, textAlign: 'center', lineHeight: 18 },
});
