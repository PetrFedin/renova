import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { api, type ProjectIssue, type WorkAcceptance } from '@/lib/api';
import { useRenova } from '@/lib/context/RenovaContext';
import { RenovaTheme, card } from '@/constants/Theme';
import { reportError } from '@/lib/reportError';

export function TechnicalSupervisionControlView() {
  const { activeProject, user } = useRenova();
  const [acceptances, setAcceptances] = useState<WorkAcceptance[]>([]);
  const [issues, setIssues] = useState<ProjectIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedStageId, setSelectedStageId] = useState<string | null>(null);
  const [remark, setRemark] = useState('');
  const [busy, setBusy] = useState(false);

  const projectId = activeProject?.id || '';
  const userId = user?.id || '';
  const capabilities = useMemo(
    () => new Set(activeProject?.technical_capabilities || []),
    [activeProject?.technical_capabilities],
  );
  const canIssue = capabilities.has('quality_issue_write');
  const canReturn = capabilities.has('quality_review');

  const load = useCallback(async (isRefresh = false) => {
    if (!userId || !projectId) return;
    isRefresh ? setRefreshing(true) : setLoading(true);
    setError(null);
    try {
      const [nextAcceptances, nextIssues] = await Promise.all([
        api.listWorkAcceptances(userId, projectId),
        api.listIssues(userId, projectId),
      ]);
      setAcceptances(nextAcceptances);
      setIssues(nextIssues);
    } catch (cause) {
      reportError('technicalSupervision.control.load', cause, { projectId });
      setError('Не удалось загрузить контроль объекта. Действия временно недоступны.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [projectId, userId]);

  useEffect(() => {
    void load(false);
  }, [load]);

  const pending = acceptances.filter((item) => ['requested', 'in_review'].includes(item.status));
  const stageName = (stageId: string) =>
    activeProject?.stages?.find((stage) => stage.id === stageId)?.name || 'Этап';

  function chooseStage(stageId: string) {
    setSelectedStageId(stageId);
    setRemark('');
  }

  async function createRemark() {
    if (!selectedStageId || !remark.trim() || !canIssue) return;
    setBusy(true);
    try {
      await api.createTechnicalQualityIssue(userId, projectId, {
        title: `Замечание: ${stageName(selectedStageId)}`,
        description: remark.trim(),
        stage_id: selectedStageId,
        severity: 'medium',
      });
      setRemark('');
      await load(true);
    } catch (cause) {
      reportError('technicalSupervision.control.issue', cause, { projectId, stageId: selectedStageId });
      Alert.alert('Замечание', 'Не удалось сохранить замечание. Проверьте соединение и права доступа.');
    } finally {
      setBusy(false);
    }
  }

  function returnForRework() {
    if (!selectedStageId || !remark.trim() || !canReturn) return;
    const stageId = selectedStageId;
    const text = remark.trim();
    Alert.alert(
      'Вернуть этап на доработку?',
      'Исполнитель получит замечание и срок устранения. Финальную приёмку по-прежнему выполняет заказчик.',
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Вернуть',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              await api.returnStageForTechnicalRework(userId, projectId, stageId, text);
              setRemark('');
              setSelectedStageId(null);
              await load(true);
            } catch (cause) {
              reportError('technicalSupervision.control.rework', cause, { projectId, stageId });
              Alert.alert('Доработка', 'Не удалось вернуть этап. Обновите состояние и повторите действие.');
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  }

  if (!activeProject || !user) {
    return <Text style={s.empty}>Выберите объект.</Text>;
  }
  if (activeProject.access_mode !== 'supervisor') {
    return <Text style={s.empty}>Технический надзор для этого объекта не активен.</Text>;
  }

  return (
    <ScrollView
      style={s.root}
      contentContainerStyle={s.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} />}
    >
      <View style={s.boundary}>
        <Text style={s.boundaryTitle}>Контроль со стороны заказчика</Text>
        <Text style={s.boundaryText}>
          Вы можете фиксировать дефекты и возвращать работы на доработку. Финальная приёмка, платежи, смета и договорные решения остаются у заказчика.
        </Text>
      </View>

      {loading ? <Text style={s.muted}>Загрузка контроля…</Text> : null}
      {error ? (
        <View style={s.errorBox}>
          <Text style={s.errorText}>{error}</Text>
          <Pressable onPress={() => void load(false)}>
            <Text style={s.retry}>Повторить</Text>
          </Pressable>
        </View>
      ) : null}

      {!loading && !error ? (
        <>
          <Text style={s.sectionTitle}>На технической проверке</Text>
          {pending.length === 0 ? (
            <Text style={s.muted}>Нет этапов, ожидающих технической проверки.</Text>
          ) : (
            pending.map((acceptance) => (
              <Pressable
                key={acceptance.id}
                onPress={() => chooseStage(acceptance.stage_id)}
                style={[s.item, selectedStageId === acceptance.stage_id && s.itemSelected]}
              >
                <View style={s.itemText}>
                  <Text style={s.itemTitle}>{stageName(acceptance.stage_id)}</Text>
                  <Text style={s.muted}>Статус: {acceptance.status}</Text>
                  {acceptance.comment ? <Text style={s.itemBody}>{acceptance.comment}</Text> : null}
                </View>
                <Text style={s.link}>Проверить</Text>
              </Pressable>
            ))
          )}

          {selectedStageId ? (
            <View style={s.reviewBox}>
              <Text style={s.reviewTitle}>{stageName(selectedStageId)}</Text>
              <TextInput
                value={remark}
                onChangeText={setRemark}
                placeholder="Опишите дефект, несоответствие материалу/технологии или требуемую доработку"
                placeholderTextColor={RenovaTheme.colors.textSubtle}
                style={s.textArea}
                multiline
                editable={!busy}
              />
              <View style={s.actions}>
                {canIssue ? (
                  <Pressable
                    onPress={() => void createRemark()}
                    disabled={busy || !remark.trim()}
                    style={[s.secondaryButton, (busy || !remark.trim()) && s.disabled]}
                  >
                    <Text style={s.secondaryText}>Зафиксировать замечание</Text>
                  </Pressable>
                ) : null}
                {canReturn ? (
                  <Pressable
                    onPress={returnForRework}
                    disabled={busy || !remark.trim()}
                    style={[s.dangerButton, (busy || !remark.trim()) && s.disabled]}
                  >
                    <Text style={s.dangerText}>Вернуть на доработку</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          ) : null}

          <Text style={s.sectionTitle}>Замечания по объекту</Text>
          {issues.length === 0 ? (
            <Text style={s.muted}>Замечаний пока нет.</Text>
          ) : (
            issues.map((issue) => (
              <View key={issue.id} style={s.issue}>
                <View style={s.itemText}>
                  <Text style={s.itemTitle}>{issue.title}</Text>
                  <Text style={s.muted}>{issue.status} · {issue.severity}</Text>
                  {issue.description ? <Text style={s.itemBody}>{issue.description}</Text> : null}
                </View>
              </View>
            ))
          )}
        </>
      ) : null}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: RenovaTheme.colors.background },
  content: { padding: RenovaTheme.spacing.lg, paddingBottom: 32 },
  empty: { padding: 20, color: RenovaTheme.colors.textMuted },
  boundary: { ...card, borderColor: RenovaTheme.colors.infoBorder, backgroundColor: RenovaTheme.colors.infoBg },
  boundaryTitle: { fontSize: RenovaTheme.fontSize.h3, fontWeight: RenovaTheme.fontWeight.bold, color: RenovaTheme.colors.infoText },
  boundaryText: { marginTop: 6, fontSize: RenovaTheme.fontSize.bodySmall, color: RenovaTheme.colors.infoText, lineHeight: 18 },
  sectionTitle: { marginTop: 18, marginBottom: 8, fontSize: RenovaTheme.fontSize.h3, fontWeight: RenovaTheme.fontWeight.bold, color: RenovaTheme.colors.text },
  muted: { fontSize: RenovaTheme.fontSize.bodySmall, color: RenovaTheme.colors.textMuted },
  item: { ...card, flexDirection: 'row', alignItems: 'center', gap: 10 },
  itemSelected: { borderColor: RenovaTheme.colors.primary },
  itemText: { flex: 1 },
  itemTitle: { fontSize: RenovaTheme.fontSize.body, fontWeight: RenovaTheme.fontWeight.semibold, color: RenovaTheme.colors.text },
  itemBody: { marginTop: 5, fontSize: RenovaTheme.fontSize.bodySmall, color: RenovaTheme.colors.text, lineHeight: 18 },
  link: { color: RenovaTheme.colors.primary, fontWeight: RenovaTheme.fontWeight.semibold },
  reviewBox: { ...card, borderColor: RenovaTheme.colors.warningBorder, backgroundColor: RenovaTheme.colors.warningBg },
  reviewTitle: { fontSize: RenovaTheme.fontSize.body, fontWeight: RenovaTheme.fontWeight.bold, color: RenovaTheme.colors.text },
  textArea: { minHeight: 100, marginTop: 10, borderWidth: 1, borderColor: RenovaTheme.colors.border, borderRadius: RenovaTheme.radius.sm, padding: 10, color: RenovaTheme.colors.text, backgroundColor: RenovaTheme.colors.surface, textAlignVertical: 'top' },
  actions: { marginTop: 10, gap: 8 },
  secondaryButton: { minHeight: 44, borderWidth: 1, borderColor: RenovaTheme.colors.primary, borderRadius: RenovaTheme.radius.sm, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  secondaryText: { color: RenovaTheme.colors.primary, fontWeight: RenovaTheme.fontWeight.semibold },
  dangerButton: { minHeight: 44, borderWidth: 1, borderColor: RenovaTheme.colors.dangerBorder, backgroundColor: RenovaTheme.colors.dangerBg, borderRadius: RenovaTheme.radius.sm, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  dangerText: { color: RenovaTheme.colors.dangerText, fontWeight: RenovaTheme.fontWeight.semibold },
  disabled: { opacity: 0.5 },
  issue: { ...card },
  errorBox: { ...card, borderColor: RenovaTheme.colors.dangerBorder, backgroundColor: RenovaTheme.colors.dangerBg },
  errorText: { color: RenovaTheme.colors.dangerText, fontSize: RenovaTheme.fontSize.bodySmall },
  retry: { marginTop: 8, color: RenovaTheme.colors.primary, fontWeight: RenovaTheme.fontWeight.semibold },
});
