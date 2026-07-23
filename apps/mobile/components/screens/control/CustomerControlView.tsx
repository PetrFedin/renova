import { reportError } from '@/lib/reportError';
/** Контроль — приёмка, замечания, качество */
import { Alert, ScrollView, View, Text, StyleSheet, Pressable } from 'react-native';
import { RenovaTheme, card } from '@/constants/Theme';
import { ReadOnlyBanner } from '@/components/renova/ReadOnlyGuard';
import { UnifiedAcceptanceList } from '@/components/renova/UnifiedAcceptanceList';
import { ConstructionLocationLine } from '@/components/renova/ConstructionLocationLine';
import { computePendingAcceptanceCount } from '@/lib/domain/acceptancePending';
import { useCallback, useState } from 'react';
import { useFocusEffect, useLocalSearchParams, usePathname } from 'expo-router';
import { useRenova } from '@/lib/context/RenovaContext';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import { useProjectDataReload } from '@/lib/useProjectDataReload';
import { api, ProjectIssue, WorkAcceptance } from '@/lib/api';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { ProjectEmptyState } from '@/components/renova/ProjectEmptyState';
import { screenLayout } from '@/constants/screenLayout';
import { issueSeverityLabel, issueStatusLabel } from '@/constants/labels';
import { useNavFromHere } from '@/lib/navigation';
import { openQcIssue } from '@/lib/qcNav';
import { isOfflineQueued, notifyOfflineQueued } from '@/lib/offlineUi';

export function CustomerControlView() {
  const pathname = usePathname();
  const nav = useNavFromHere('customer');
  const { issueId: focusIssueId } = useLocalSearchParams<{ issueId?: string }>();
  const { user, activeProject, readOnly } = useRenova();
  const [issues, setIssues] = useState<ProjectIssue[]>([]);
  const [acceptances, setAcceptances] = useState<WorkAcceptance[]>([]);

  const reload = useCallback(() => {
    if (user && activeProject) {
      api.listIssues(user.id, activeProject.id).then(setIssues).catch((e) => {
        reportError('control.issues', e);
        setIssues([]);
      });
      api.listWorkAcceptances(user.id, activeProject.id).then(setAcceptances).catch((e) => {
        reportError('control.acceptances', e);
        setAcceptances([]);
      });
    }
  }, [user?.id, activeProject?.id]);

  useFocusEffect(useCallback(() => { reload(); }, [reload]));
  // W89: после приёмки/QC в другом экране — обновить список без remount
  useProjectDataReload(reload);

  if (!activeProject || !user) return <ProjectEmptyState role="customer" />;

  const pendingCount = computePendingAcceptanceCount(activeProject.stages, acceptances);
  const rework = activeProject.stages.filter((stage) => stage.status === 'rework');
  const openIssues = issues.filter((issue) => issue.status !== 'closed');
  const criticalIssuesCount = openIssues.filter(
    (issue) => issue.severity === 'critical' || issue.severity === 'high',
  ).length;
  const sortedIssues = focusIssueId
    ? [...openIssues].sort((a, b) => Number(b.id === focusIssueId) - Number(a.id === focusIssueId))
    : openIssues;

  return (
    <ScrollView style={s.wrap} contentContainerStyle={screenLayout.contentStyle}>
      <ReadOnlyBanner />
      <View style={s.summary}>
        <View style={s.cell}><Text style={s.n}>{pendingCount}</Text><Text style={s.l}>Приёмка</Text></View>
        <View style={s.cell}><Text style={s.n}>{openIssues.length}</Text><Text style={s.l}>Открытые</Text></View>
        <View style={s.cell}><Text style={s.n}>{criticalIssuesCount}</Text><Text style={s.l}>Критичные</Text></View>
      </View>

      <Text style={s.section}>Ожидают приёмки</Text>
      <UnifiedAcceptanceList
        stages={activeProject.stages}
        acceptances={acceptances}
        returnTo={pathname}
        role="customer"
        onChanged={reload}
      />

      <View style={s.sectionRow}>
        <Text style={s.section}>Замечания</Text>
        {openIssues.length > 0 ? <Text style={s.sectionCount}>{openIssues.length}</Text> : null}
      </View>
      {!sortedIssues.length ? <Text style={s.empty}>Нет открытых замечаний</Text> : null}
      {sortedIssues.slice(0, 5).map((issue) => (
        <Pressable
          key={issue.id}
          style={[s.row, issue.id === focusIssueId && s.rowFocus]}
          onPress={() => openQcIssue(issue.id, pathname, 'customer')}
          accessibilityRole="button"
          accessibilityLabel={`Замечание: ${issue.title}`}
        >
          <Text style={s.title}>{issue.title}</Text>
          <Text style={s.meta}>
            {issueSeverityLabel(issue.severity)} · {issueStatusLabel(issue.status)}
            {issue.due_at ? ` · до ${issue.due_at.slice(0, 10)}` : ''}
            {issue.photo_url ? ' · есть фото' : ''}
          </Text>
          <ConstructionLocationLine
            roomId={issue.room_id}
            stageId={issue.stage_id}
            floorPlanId={issue.floor_plan_id}
            xPct={issue.x_pct}
            yPct={issue.y_pct}
            rooms={activeProject.rooms}
            stages={activeProject.stages}
          />
          {!readOnly && issue.status !== 'closed' ? (
            <PrimaryButton
              title={issue.status === 'fixed' ? 'Подтвердить исправление' : 'Закрыть'}
              compact
              variant="outline"
              onPress={async () => {
                try {
                  const wasFixed = issue.status === 'fixed';
                  await api.closeIssue(user.id, activeProject.id, issue.id);
                  await syncProjectSideEffects({ user, project: activeProject });
                  reload();
                  if (wasFixed) {
                    Alert.alert('QC', 'Исправление подтверждено — замечание закрыто');
                  }
                } catch (error) {
                  if (isOfflineQueued(error)) {
                    notifyOfflineQueued(issue.status === 'fixed' ? 'Подтверждение исправления' : 'Закрытие замечания');
                  } else {
                    reportError('control.customerClose', error);
                    Alert.alert('Ошибка', error instanceof Error ? error.message : 'Не удалось обновить');
                  }
                }
              }}
            />
          ) : null}
        </Pressable>
      ))}
      {openIssues.length > 0 ? (
        <PrimaryButton
          title="Все замечания (QC)"
          variant="outline"
          onPress={() => openQcIssue(undefined, pathname, 'customer')}
        />
      ) : null}

      {rework.length > 0 ? (
        <>
          <View style={s.sectionRow}>
            <Text style={s.section}>Доработка</Text>
            <Text style={s.sectionCount}>{rework.length}</Text>
          </View>
          {rework.map((stage) => (
            <Pressable
              key={stage.id}
              style={s.row}
              onPress={() => nav.stage(stage.id)}
              accessibilityRole="button"
              accessibilityLabel={`Открыть этап на доработке: ${stage.name}`}
            >
              <Text style={s.title}>{stage.name}</Text>
              <Text style={s.meta}>Требуется доработка этапа</Text>
            </Pressable>
          ))}
        </>
      ) : null}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: RenovaTheme.colors.background },
  summary: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  cell: { ...card, flex: 1, alignItems: 'center', marginBottom: 0 },
  n: { fontSize: 22, fontWeight: '800', color: RenovaTheme.colors.text },
  l: { fontSize: 12, color: RenovaTheme.colors.textMuted },
  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginVertical: 8 },
  section: { fontSize: 12, fontWeight: '700', color: RenovaTheme.colors.textMuted, textTransform: 'uppercase' },
  sectionCount: {
    minWidth: 22,
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '700',
    color: RenovaTheme.colors.accent,
    backgroundColor: RenovaTheme.colors.infoBg,
    borderRadius: RenovaTheme.radius.pill,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  row: { ...card, paddingVertical: 12 },
  rowFocus: { borderWidth: 2, borderColor: RenovaTheme.colors.primary },
  title: { fontSize: 15, fontWeight: '600', color: RenovaTheme.colors.text },
  meta: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginTop: 2 },
  empty: { fontSize: 13, color: RenovaTheme.colors.textMuted, marginBottom: 12 },
});
