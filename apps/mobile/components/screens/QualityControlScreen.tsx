import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { OfflineSyncStatus } from '@/components/renova/OfflineSyncStatus';
import { RenovaTheme, card } from '@/constants/Theme';
import { api } from '@/lib/api';
import type { ProjectIssue } from '@/lib/api/types';
import { useRenova } from '@/lib/context/RenovaContext';
import { isOfflineQueued, notifyOfflineQueued } from '@/lib/offlineUi';

function statusLabel(status: string) {
  switch (status) {
    case 'open': return 'Открыто';
    case 'assigned': return 'Назначено';
    case 'in_progress': return 'В работе';
    case 'fixed': return 'Исправлено';
    case 'review': return 'Проверка';
    case 'closed': return 'Закрыто';
    case 'rejected': return 'Отклонено';
    default: return status;
  }
}

function severityLabel(severity: string) {
  switch (severity) {
    case 'critical': return 'Критично';
    case 'high': return 'Высокий';
    case 'medium': return 'Средний';
    case 'low': return 'Низкий';
    default: return severity || 'Без оценки';
  }
}

function severityTone(severity: string) {
  if (severity === 'critical' || severity === 'high') return RenovaTheme.colors.dangerText;
  if (severity === 'medium') return RenovaTheme.colors.warningText;
  return RenovaTheme.colors.successText;
}

function dueLabel(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' });
}

function IssueCard({
  item,
  onClose,
  acting,
  focused,
  canClose,
  closeHint,
}: {
  item: ProjectIssue;
  onClose: (issue: ProjectIssue) => void;
  acting: boolean;
  focused?: boolean;
  canClose: boolean;
  closeHint?: string;
}) {
  const isClosed = item.status === 'closed';
  const tone = severityTone(item.severity);
  return (
    <View style={[styles.issueCard, isClosed && styles.closedCard, focused && styles.focusedCard]}>
      <View style={styles.issueHeader}>
        <View style={styles.issueMain}>
          <Text style={styles.issueTitle}>{item.title}</Text>
          <Text style={styles.issueMeta}>{statusLabel(item.status)} · {severityLabel(item.severity)}{item.floor_plan_id ? ' · на плане' : ''}{dueLabel(item.due_at) ? ` · до ${dueLabel(item.due_at)}` : ''}</Text>
        </View>
        <View style={[styles.badge, { borderColor: tone }]}> 
          <Text style={[styles.badgeText, { color: tone }]}>{severityLabel(item.severity)}</Text>
        </View>
      </View>
      {item.description ? <Text style={styles.issueText}>{item.description}</Text> : null}
      <View style={styles.issueFooter}>
        {item.stage_id ? (
          <PrimaryButton title="Этап" variant="outline" compact onPress={() => router.push(`/stage/${item.stage_id}?returnTo=${encodeURIComponent('/quality-control')}` as never)} />
        ) : null}
        {!isClosed && canClose ? (
          <PrimaryButton title="Закрыть" compact onPress={() => onClose(item)} loading={acting} disabled={acting} />
        ) : null}
        {!isClosed && !canClose && closeHint ? <Text style={styles.issueMeta}>{closeHint}</Text> : null}
      </View>
    </View>
  );
}

export function QualityControlScreen() {
  const { user, activeProject, readOnly } = useRenova();
  const isCustomer = user?.role === 'customer';
  const params = useLocalSearchParams<{ issueId?: string }>();
  const focusIssueId = Array.isArray(params.issueId) ? params.issueId[0] : params.issueId;
  const [items, setItems] = useState<ProjectIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user || !activeProject) return;
    try {
      const result = await api.listIssues(user.id, activeProject.id);
      setItems(result);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user, activeProject]);

  useEffect(() => { load(); }, [load]);

  const openIssues = useMemo(() => {
    const open = items.filter((item) => item.status !== 'closed');
    if (!focusIssueId) return open;
    return [...open].sort((a, b) => Number(b.id === focusIssueId) - Number(a.id === focusIssueId));
  }, [items, focusIssueId]);
  const closedIssues = useMemo(() => items.filter((item) => item.status === 'closed'), [items]);
  const criticalIssues = useMemo(() => openIssues.filter((item) => item.severity === 'critical' || item.severity === 'high'), [openIssues]);

  const closeIssue = async (issue: ProjectIssue) => {
    // W46/W62: гарантию закрывает только заказчик
    if (!user || !activeProject || readOnly) return;
    if ((issue.title || '').startsWith('[Гарантия]') && user.role !== 'customer') return;
    setActingId(issue.id);
    try {
      if ((issue.title || '').startsWith('[Гарантия]')) {
        await api.closeWarrantyClaim(user.id, activeProject.id, issue.id);
      } else {
        await api.closeIssue(user.id, activeProject.id, issue.id);
      }
      await load();
    } catch (e) {
      if (isOfflineQueued(e)) notifyOfflineQueued('Закрытие замечания');
    } finally {
      setActingId(null);
    }
  };

  if (!user || !activeProject) {
    return (
      <View style={styles.center}>
        <Text style={styles.stateTitle}>Нет активного проекта</Text>
        <Text style={styles.stateText}>Выберите проект, чтобы открыть контроль качества.</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={RenovaTheme.colors.primaryMuted} />
        <Text style={styles.stateText}>Загружаем замечания...</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
    >
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}><Text style={styles.back}>‹ Назад</Text></Pressable>
        <Text style={styles.title}>Контроль качества</Text>
        <Text style={styles.subtitle}>Замечания, дефекты и контроль устранения по проекту.</Text>
        <OfflineSyncStatus compact />
      </View>

      {readOnly ? (
        <View style={styles.noteCard}>
          <Text style={styles.noteText}>Режим просмотра: можно анализировать замечания, но нельзя закрывать их.</Text>
        </View>
      ) : null}

      <View style={styles.summaryGrid}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryValue}>{openIssues.length}</Text>
          <Text style={styles.summaryLabel}>открыто</Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={[styles.summaryValue, { color: criticalIssues.length ? RenovaTheme.colors.dangerText : RenovaTheme.colors.successText }]}>{criticalIssues.length}</Text>
          <Text style={styles.summaryLabel}>критично</Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryValue}>{closedIssues.length}</Text>
          <Text style={styles.summaryLabel}>закрыто</Text>
        </View>
      </View>

      <View style={styles.cardBlock}>
        <Text style={styles.sectionTitle}>Требуют внимания</Text>
        {openIssues.length ? openIssues.map((item) => (
          <IssueCard
            key={item.id}
            focused={item.id === focusIssueId}
            item={item}
            onClose={closeIssue}
            acting={actingId === item.id}
            canClose={!readOnly && (!(item.title || '').startsWith('[Гарантия]') || Boolean(isCustomer))}
            closeHint={(item.title || '').startsWith('[Гарантия]') && !isCustomer ? 'Гарантию закрывает заказчик' : undefined}
          />
        )) : <Text style={styles.emptyText}>Открытых замечаний нет. Редкий случай, когда тишина — хороший KPI.</Text>}
      </View>

      {closedIssues.length ? (
        <View style={styles.cardBlock}>
          <Text style={styles.sectionTitle}>Закрытые</Text>
          {closedIssues.slice(0, 5).map((item) => (
            <IssueCard
              key={item.id}
              focused={item.id === focusIssueId}
              item={item}
              onClose={closeIssue}
              acting={false}
              canClose={false}
            />
          ))}
        </View>
      ) : null}
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
  noteCard: { ...card, backgroundColor: RenovaTheme.colors.surfaceMuted, padding: RenovaTheme.spacing.md },
  noteText: { fontSize: RenovaTheme.fontSize.bodySmall, color: RenovaTheme.colors.textMuted, lineHeight: 18 },
  summaryGrid: { flexDirection: 'row', gap: RenovaTheme.spacing.sm },
  summaryCard: { ...card, flex: 1, alignItems: 'center', gap: 2 },
  summaryValue: { fontSize: RenovaTheme.fontSize.h2, fontWeight: RenovaTheme.fontWeight.extrabold, color: RenovaTheme.colors.text },
  summaryLabel: { fontSize: RenovaTheme.fontSize.caption, color: RenovaTheme.colors.textMuted },
  cardBlock: { ...card, gap: RenovaTheme.spacing.sm },
  sectionTitle: { fontSize: RenovaTheme.fontSize.h3, color: RenovaTheme.colors.text, fontWeight: RenovaTheme.fontWeight.bold },
  issueCard: { borderWidth: 1, borderColor: RenovaTheme.colors.border, borderRadius: RenovaTheme.radius.lg, padding: RenovaTheme.spacing.md, backgroundColor: RenovaTheme.colors.surface, gap: RenovaTheme.spacing.sm },
  closedCard: { opacity: 0.7 },
  issueHeader: { flexDirection: 'row', gap: RenovaTheme.spacing.sm, justifyContent: 'space-between', alignItems: 'flex-start' },
  issueMain: { flex: 1, minWidth: 0 },
  issueTitle: { fontSize: RenovaTheme.fontSize.body, color: RenovaTheme.colors.text, fontWeight: RenovaTheme.fontWeight.extrabold },
  issueMeta: { marginTop: 3, fontSize: RenovaTheme.fontSize.caption, color: RenovaTheme.colors.textMuted },
  issueText: { fontSize: RenovaTheme.fontSize.bodySmall, color: RenovaTheme.colors.textMuted, lineHeight: 18 },
  issueFooter: { flexDirection: 'row', flexWrap: 'wrap', gap: RenovaTheme.spacing.sm },
  badge: { borderWidth: 1, borderRadius: RenovaTheme.radius.pill, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: RenovaTheme.colors.surface },
  badgeText: { fontSize: RenovaTheme.fontSize.tiny, fontWeight: RenovaTheme.fontWeight.extrabold },
  emptyText: { fontSize: RenovaTheme.fontSize.bodySmall, color: RenovaTheme.colors.textMuted, lineHeight: 18 },
  stateTitle: { fontSize: RenovaTheme.fontSize.h3, fontWeight: RenovaTheme.fontWeight.bold, color: RenovaTheme.colors.text, textAlign: 'center' },
  stateText: { fontSize: RenovaTheme.fontSize.bodySmall, color: RenovaTheme.colors.textMuted, textAlign: 'center', lineHeight: 18 },
});
