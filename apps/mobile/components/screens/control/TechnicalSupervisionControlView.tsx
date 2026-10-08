import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { confirmAction, notifyAlert, notifyError } from '@/lib/notify';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { EmptyActionState } from '@/components/ui/EmptyActionState';
import { LoadErrorState } from '@/components/ui/LoadErrorState';
import {
  SEVERITY_CHOICES,
  SUPERVISOR_ISSUE_STATUS_LABEL,
  supervisorIssueActions,
  validateSupervisorRemark,
  type SupervisorIssueAction,
} from '@/lib/domain/supervisorIssueActions';

import { api, type ProjectIssue, type WorkAcceptance } from '@/lib/api';
import { useRenova } from '@/lib/context/RenovaContext';
import { RenovaTheme, card } from '@/constants/Theme';
import { reportError } from '@/lib/reportError';
import { issueSeverityLabel } from '@/constants/labels';
import { projectCapabilitySet, operationalPersona } from '@/lib/projectCapabilities';

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
  const [severity, setSeverity] = useState<'low' | 'medium' | 'high' | 'critical'>('medium');
  const [issueBusyId, setIssueBusyId] = useState<string | null>(null);

  const projectId = activeProject?.id || '';
  const userId = user?.id || '';
  const capabilities = useMemo(
    () => projectCapabilitySet(activeProject),
    [activeProject?.capabilities, activeProject?.technical_capabilities],
  );
  const canIssue = capabilities.has('quality.issue');
  const canReturn = capabilities.has('quality.review');
  const isSupervisor = operationalPersona(activeProject) === 'supervisor';
  const capabilityList = useMemo(() => Array.from(capabilities), [capabilities]);
  const workStages = (activeProject?.stages ?? []).filter((stage) => stage.status !== 'done');

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
    if (!canIssue) return;
    const checked = validateSupervisorRemark({ stageId: selectedStageId, description: remark });
    if (!checked.ok || !selectedStageId) {
      notifyError('Замечание', undefined, checked.ok ? 'Выберите этап.' : checked.message);
      return;
    }
    setBusy(true);
    try {
      await api.createTechnicalQualityIssue(userId, projectId, {
        title: `Замечание: ${stageName(selectedStageId)}`,
        description: checked.description,
        stage_id: selectedStageId,
        severity,
      });
      setRemark('');
      await load(true);
    } catch (cause) {
      reportError('technicalSupervision.control.issue', cause, { projectId, stageId: selectedStageId });
      notifyError('Замечание', cause, 'Не удалось сохранить замечание. Проверьте соединение и права доступа.');
    } finally {
      setBusy(false);
    }
  }

  async function transitionIssue(issue: ProjectIssue, action: SupervisorIssueAction) {
    const yes = await confirmAction({
      title: action.confirmTitle,
      message: `${issue.title}. ${action.confirmMessage}`,
      confirmLabel: action.target === 'closed' ? 'Закрыть' : 'Вернуть',
      destructive: action.destructive,
    });
    if (!yes) return;
    setIssueBusyId(issue.id);
    try {
      await api.transitionIssue(userId, projectId, issue.id, action.target);
      await load(true);
    } catch (cause) {
      reportError('technicalSupervision.control.transition', cause, { projectId, issueId: issue.id });
      notifyError('Замечание', cause, 'Не удалось изменить статус замечания. Обновите список и повторите.');
    } finally {
      setIssueBusyId(null);
    }
  }

  function returnForRework() {
    if (!selectedStageId || !remark.trim() || !canReturn) return;
    const stageId = selectedStageId;
    const text = remark.trim();
    notifyAlert(
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
              notifyError('Доработка', cause, 'Не удалось вернуть этап. Обновите состояние и повторите действие.');
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  }

  if (!activeProject || !user) {
    return <EmptyActionState title="Выберите объект" hint="Контроль технадзора открывается для конкретного объекта." />;
  }
  if (!isSupervisor) {
    return <EmptyActionState title="Технадзор не назначен" hint="Действия технического надзора доступны только назначенному на этот объект представителю." />;
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
      {error ? <LoadErrorState title="Не удалось загрузить контроль объекта" hint="Действия временно недоступны. Это не пустой список." onRetry={() => void load(false)} /> : null}

      {!loading && !error ? (
        <>
          <Text style={s.sectionTitle}>На технической проверке</Text>
          {pending.length === 0 ? (
            <EmptyActionState title="Нет этапов на проверке" hint="Когда исполнитель сдаст этап, он появится здесь. Замечание можно оставить и по любому этапу ниже." />
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

          {canIssue || canReturn ? (
            <View style={s.reviewBox}>
              <Text style={s.reviewTitle}>Новое замечание</Text>
              <Text style={s.muted}>Этап</Text>
              <View style={s.chips}>
                {workStages.map((stage) => (
                  <Pressable
                    key={stage.id}
                    onPress={() => chooseStage(stage.id)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: selectedStageId === stage.id }}
                    style={[s.chip, selectedStageId === stage.id && s.chipOn]}
                  >
                    <Text style={[s.chipText, selectedStageId === stage.id && s.chipTextOn]}>{stage.name}</Text>
                  </Pressable>
                ))}
              </View>
              {canIssue ? (
                <>
                  <Text style={s.muted}>Серьёзность</Text>
                  <View style={s.chips}>
                    {SEVERITY_CHOICES.map((choice) => (
                      <Pressable
                        key={choice.value}
                        onPress={() => setSeverity(choice.value)}
                        accessibilityRole="button"
                        accessibilityState={{ selected: severity === choice.value }}
                        style={[s.chip, severity === choice.value && s.chipOn]}
                      >
                        <Text style={[s.chipText, severity === choice.value && s.chipTextOn]}>{choice.label}</Text>
                      </Pressable>
                    ))}
                  </View>
                  {severity === 'high' || severity === 'critical' ? (
                    <Text style={s.muted}>Высокие и критичные замечания блокируют приёмку этапа, пока не будут закрыты.</Text>
                  ) : null}
                </>
              ) : null}
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
                  <PrimaryButton
                    title="Зафиксировать замечание"
                    variant="accent"
                    onPress={() => void createRemark()}
                    loading={busy}
                    disabled={busy || !selectedStageId || !remark.trim()}
                    fullWidth
                  />
                ) : null}
                {canReturn ? (
                  <PrimaryButton
                    title="Вернуть этап на доработку"
                    variant="dangerOutline"
                    onPress={returnForRework}
                    disabled={busy || !selectedStageId || !remark.trim()}
                    fullWidth
                  />
                ) : null}
              </View>
            </View>
          ) : null}

          <Text style={s.sectionTitle}>Замечания по объекту</Text>
          {issues.length === 0 ? (
            <EmptyActionState title="Замечаний пока нет" hint="Зафиксированные замечания и их исправление будут видны здесь." />
          ) : (
            issues.map((issue) => {
              const legacyCapabilities = capabilityList.map((capability) => (
                capability === 'quality.issue' ? 'quality_issue_write'
                  : capability === 'quality.review' ? 'quality_review'
                    : capability === 'schedule.review' ? 'schedule_review'
                      : capability
              ));
              const actions = supervisorIssueActions(issue, { isSupervisor, capabilities: legacyCapabilities });
              return (
                <View key={issue.id} style={s.issue}>
                  <View style={s.itemText}>
                    <Text style={s.itemTitle}>{issue.title}</Text>
                    <Text style={s.muted}>{SUPERVISOR_ISSUE_STATUS_LABEL[issue.status] ?? issue.status} · {issueSeverityLabel(issue.severity)}</Text>
                    {issue.description ? <Text style={s.itemBody}>{issue.description}</Text> : null}
                    {actions.length > 0 ? (
                      <View style={s.actions}>
                        {actions.map((action, index) => (
                          <PrimaryButton
                            key={`${issue.id}:${action.label}`}
                            title={action.label}
                            variant={index === 0 && action.target === 'closed' ? 'accent' : 'outline'}
                            onPress={() => void transitionIssue(issue, action)}
                            loading={issueBusyId === issue.id}
                            disabled={issueBusyId !== null}
                            fullWidth
                          />
                        ))}
                      </View>
                    ) : null}
                  </View>
                </View>
              );
            })
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
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6, marginBottom: 6 },
  chip: { minHeight: 36, paddingHorizontal: 12, borderRadius: RenovaTheme.radius.sm, borderWidth: 1, borderColor: RenovaTheme.colors.border, backgroundColor: RenovaTheme.colors.surface, alignItems: 'center', justifyContent: 'center' },
  chipOn: { borderColor: RenovaTheme.colors.primary, backgroundColor: RenovaTheme.colors.infoBg },
  chipText: { color: RenovaTheme.colors.text, fontSize: RenovaTheme.fontSize.bodySmall },
  chipTextOn: { color: RenovaTheme.colors.primary, fontWeight: RenovaTheme.fontWeight.semibold },
  issue: { ...card },
  errorBox: { ...card, borderColor: RenovaTheme.colors.dangerBorder, backgroundColor: RenovaTheme.colors.dangerBg },
  errorText: { color: RenovaTheme.colors.dangerText, fontSize: RenovaTheme.fontSize.bodySmall },
  retry: { marginTop: 8, color: RenovaTheme.colors.primary, fontWeight: RenovaTheme.fontWeight.semibold },
});
