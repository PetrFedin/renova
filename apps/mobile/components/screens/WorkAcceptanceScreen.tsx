import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';

import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { RenovaTheme, card } from '@/constants/Theme';
import { api } from '@/lib/api';
import type { Stage, WorkAcceptance } from '@/lib/api/types';
import { useRenova } from '@/lib/context/RenovaContext';

type AcceptanceState = {
  acceptances: WorkAcceptance[];
  stages: Stage[];
};

function statusLabel(status: string) {
  switch (status) {
    case 'not_requested': return 'Не запрошена';
    case 'requested': return 'Ждёт проверки';
    case 'in_review': return 'На проверке';
    case 'accepted': return 'Принято';
    case 'accepted_with_remarks': return 'Принято с замечаниями';
    case 'returned': return 'Доработка';
    case 'rejected': return 'Отклонено';
    default: return status;
  }
}

function stageStatusLabel(status: string) {
  switch (status) {
    case 'planned': return 'План';
    case 'active': return 'В работе';
    case 'review': return 'На приёмке';
    case 'done': return 'Принят';
    default: return status;
  }
}

function statusTone(status: string) {
  if (status === 'accepted' || status === 'done') return RenovaTheme.colors.successText;
  if (status === 'returned' || status === 'rejected') return RenovaTheme.colors.dangerText;
  if (status === 'requested' || status === 'in_review' || status === 'review') return RenovaTheme.colors.warningText;
  return RenovaTheme.colors.textMuted;
}

function formatDate(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function latestByStage(items: WorkAcceptance[]) {
  const map = new Map<string, WorkAcceptance>();
  items.forEach((item) => {
    const prev = map.get(item.stage_id);
    if (!prev || new Date(item.created_at || 0).getTime() > new Date(prev.created_at || 0).getTime()) {
      map.set(item.stage_id, item);
    }
  });
  return map;
}

function AcceptanceCard({
  stage,
  acceptance,
  readOnly,
  role,
  actingId,
  onRequest,
  onAccept,
  onReturn,
}: {
  stage: Stage;
  acceptance?: WorkAcceptance;
  readOnly?: boolean;
  role: string;
  actingId: string | null;
  onRequest: (stage: Stage) => void;
  onAccept: (acceptance: WorkAcceptance) => void;
  onReturn: (acceptance: WorkAcceptance) => void;
}) {
  const isCustomer = role === 'customer';
  const acceptanceClosedForRework = acceptance?.status === 'returned' || acceptance?.status === 'rejected';
  const canRequest = !readOnly && !isCustomer && ['active', 'review'].includes(stage.status) && (!acceptance || acceptanceClosedForRework);
  const canDecide = !readOnly && isCustomer && acceptance && ['requested', 'in_review'].includes(acceptance.status);
  const accepted = stage.status === 'done' || acceptance?.status === 'accepted' || acceptance?.status === 'accepted_with_remarks';
  const tone = statusTone(acceptance?.status || stage.status);

  return (
    <View style={[styles.cardBlock, accepted && styles.acceptedCard]}>
      <View style={styles.cardHeader}>
        <View style={styles.cardTitleWrap}>
          <Text style={styles.cardTitle}>{stage.name}</Text>
          <Text style={styles.cardMeta}>{stageStatusLabel(stage.status)} · готовность {Math.round(stage.percent_complete || 0)}%</Text>
        </View>
        <View style={[styles.badge, { borderColor: tone }]}>
          <Text style={[styles.badgeText, { color: tone }]}>{statusLabel(acceptance?.status || stage.status)}</Text>
        </View>
      </View>

      {acceptance ? (
        <View style={styles.detailsBox}>
          <Text style={styles.detailText}>Запрошено: {formatDate(acceptance.requested_at || acceptance.created_at)}</Text>
          {acceptance.accepted_at ? <Text style={styles.detailText}>Решение: {formatDate(acceptance.accepted_at)}</Text> : null}
          {acceptance.quality_score != null ? <Text style={styles.detailText}>Оценка качества: {acceptance.quality_score}/10</Text> : null}
          {acceptance.comment ? <Text style={styles.detailText}>Комментарий: {acceptance.comment}</Text> : null}
          {acceptance.checklist?.length ? (
            <View style={styles.checklistBox}>
              {acceptance.checklist.slice(0, 4).map((item) => <Text key={item} style={styles.checklistItem}>• {item}</Text>)}
            </View>
          ) : null}
          {acceptanceClosedForRework && !isCustomer ? (
            <Text style={styles.reworkHint}>После исправления замечаний отправьте этап на повторную приёмку.</Text>
          ) : null}
        </View>
      ) : (
        <Text style={styles.hintText}>Приёмка по этапу ещё не запрошена.</Text>
      )}

      <View style={styles.actions}>
        <PrimaryButton title="Этап" variant="outline" compact onPress={() => router.push(`/stage/${stage.id}?returnTo=${encodeURIComponent('/work-acceptance')}` as never)} />
        {canRequest ? <PrimaryButton title={acceptanceClosedForRework ? 'Повторно на приёмку' : 'Запросить приёмку'} compact onPress={() => onRequest(stage)} loading={actingId === stage.id} disabled={Boolean(actingId)} /> : null}
        {canDecide ? <PrimaryButton title="Принять" compact onPress={() => onAccept(acceptance)} loading={actingId === acceptance.id} disabled={Boolean(actingId)} /> : null}
        {canDecide ? <PrimaryButton title="На доработку" variant="outline" compact onPress={() => onReturn(acceptance)} loading={actingId === acceptance.id} disabled={Boolean(actingId)} /> : null}
      </View>
    </View>
  );
}

export function WorkAcceptanceScreen() {
  const { user, activeProject, role, readOnly } = useRenova();
  const [state, setState] = useState<AcceptanceState>({ acceptances: [], stages: [] });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user || !activeProject) return;
    try {
      const [acceptances, project] = await Promise.all([
        api.listWorkAcceptances(user.id, activeProject.id).catch(() => []),
        api.getProject(user.id, activeProject.id).catch(() => activeProject),
      ]);
      setState({ acceptances, stages: project.stages || activeProject.stages || [] });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user, activeProject]);

  useEffect(() => { load(); }, [load]);

  const latest = useMemo(() => latestByStage(state.acceptances), [state.acceptances]);
  const reviewStages = useMemo(() => state.stages.filter((stage) => ['active', 'review', 'done'].includes(stage.status)), [state.stages]);
  const awaiting = useMemo(() => state.acceptances.filter((item) => ['requested', 'in_review'].includes(item.status)), [state.acceptances]);
  const returned = useMemo(() => state.acceptances.filter((item) => item.status === 'returned'), [state.acceptances]);
  const accepted = useMemo(() => state.acceptances.filter((item) => item.status === 'accepted' || item.status === 'accepted_with_remarks'), [state.acceptances]);

  const requestAcceptance = async (stage: Stage) => {
    if (!user || !activeProject || readOnly) return;
    setActingId(stage.id);
    try {
      await api.requestWorkAcceptance(user.id, activeProject.id, {
        stage_id: stage.id,
        checklist: ['Проверить качество работ', 'Сверить объём с этапом', 'Проверить фотофиксацию'],
        comment: 'Этап готов к проверке',
      });
      await load();
    } finally {
      setActingId(null);
    }
  };

  const accept = async (acceptance: WorkAcceptance) => {
    if (!user || !activeProject || readOnly) return;
    setActingId(acceptance.id);
    try {
      await api.acceptWork(user.id, activeProject.id, acceptance.id, {
        quality_score: 10,
        comment: 'Работы приняты',
      });
      await load();
    } finally {
      setActingId(null);
    }
  };

  const returnWork = async (acceptance: WorkAcceptance) => {
    if (!user || !activeProject || readOnly) return;
    Alert.alert('Вернуть на доработку?', 'Будет создано замечание по этапу и этап вернётся в работу.', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Вернуть',
        style: 'destructive',
        onPress: async () => {
          setActingId(acceptance.id);
          try {
            await api.returnWork(user.id, activeProject.id, acceptance.id, {
              quality_score: 5,
              comment: 'Нужна доработка по результатам проверки',
              create_issue: true,
            });
            await load();
          } finally {
            setActingId(null);
          }
        },
      },
    ]);
  };

  if (!user || !activeProject) {
    return (
      <View style={styles.center}>
        <Text style={styles.stateTitle}>Нет активного проекта</Text>
        <Text style={styles.stateText}>Выберите проект, чтобы открыть приёмку работ.</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={RenovaTheme.colors.primaryMuted} />
        <Text style={styles.stateText}>Загружаем приёмку работ...</Text>
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
        <Text style={styles.title}>Приёмка работ</Text>
        <Text style={styles.subtitle}>Запрос, проверка, принятие этапов и возврат на доработку.</Text>
      </View>

      {readOnly ? (
        <View style={styles.noteCard}><Text style={styles.noteText}>Режим просмотра: решения по приёмке недоступны.</Text></View>
      ) : null}

      <View style={styles.summaryGrid}>
        <View style={styles.summaryCard}><Text style={styles.summaryValue}>{awaiting.length}</Text><Text style={styles.summaryLabel}>ждёт</Text></View>
        <View style={styles.summaryCard}><Text style={[styles.summaryValue, { color: returned.length ? RenovaTheme.colors.dangerText : RenovaTheme.colors.text }]}>{returned.length}</Text><Text style={styles.summaryLabel}>доработка</Text></View>
        <View style={styles.summaryCard}><Text style={styles.summaryValue}>{accepted.length}</Text><Text style={styles.summaryLabel}>принято</Text></View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Этапы</Text>
        {reviewStages.length ? reviewStages.map((stage) => (
          <AcceptanceCard
            key={stage.id}
            stage={stage}
            acceptance={latest.get(stage.id)}
            readOnly={readOnly}
            role={role}
            actingId={actingId}
            onRequest={requestAcceptance}
            onAccept={accept}
            onReturn={returnWork}
          />
        )) : <Text style={styles.emptyText}>Пока нет этапов, готовых к приёмке.</Text>}
      </View>
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
  section: { ...card, gap: RenovaTheme.spacing.sm },
  sectionTitle: { fontSize: RenovaTheme.fontSize.h3, color: RenovaTheme.colors.text, fontWeight: RenovaTheme.fontWeight.bold },
  cardBlock: { borderWidth: 1, borderColor: RenovaTheme.colors.border, borderRadius: RenovaTheme.radius.lg, padding: RenovaTheme.spacing.md, backgroundColor: RenovaTheme.colors.surface, gap: RenovaTheme.spacing.sm },
  acceptedCard: { opacity: 0.82 },
  cardHeader: { flexDirection: 'row', gap: RenovaTheme.spacing.sm, justifyContent: 'space-between', alignItems: 'flex-start' },
  cardTitleWrap: { flex: 1, minWidth: 0 },
  cardTitle: { fontSize: RenovaTheme.fontSize.body, color: RenovaTheme.colors.text, fontWeight: RenovaTheme.fontWeight.extrabold },
  cardMeta: { marginTop: 3, fontSize: RenovaTheme.fontSize.caption, color: RenovaTheme.colors.textMuted },
  badge: { borderWidth: 1, borderRadius: RenovaTheme.radius.pill, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: RenovaTheme.colors.surface },
  badgeText: { fontSize: RenovaTheme.fontSize.tiny, fontWeight: RenovaTheme.fontWeight.extrabold },
  detailsBox: { gap: 3 },
  detailText: { fontSize: RenovaTheme.fontSize.bodySmall, color: RenovaTheme.colors.textMuted, lineHeight: 18 },
  hintText: { fontSize: RenovaTheme.fontSize.bodySmall, color: RenovaTheme.colors.textMuted, lineHeight: 18 },
  reworkHint: { marginTop: 4, fontSize: RenovaTheme.fontSize.caption, color: RenovaTheme.colors.warningText, lineHeight: 16, fontWeight: RenovaTheme.fontWeight.semibold },
  checklistBox: { marginTop: 4, gap: 2 },
  checklistItem: { fontSize: RenovaTheme.fontSize.caption, color: RenovaTheme.colors.textMuted, lineHeight: 16 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: RenovaTheme.spacing.sm },
  emptyText: { fontSize: RenovaTheme.fontSize.bodySmall, color: RenovaTheme.colors.textMuted, lineHeight: 18 },
  stateTitle: { fontSize: RenovaTheme.fontSize.h3, fontWeight: RenovaTheme.fontWeight.bold, color: RenovaTheme.colors.text, textAlign: 'center' },
  stateText: { fontSize: RenovaTheme.fontSize.bodySmall, color: RenovaTheme.colors.textMuted, textAlign: 'center', lineHeight: 18 },
});
