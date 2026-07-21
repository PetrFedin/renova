import { reportError } from '@/lib/reportError';
/** Контроль — приёмка, замечания, качество (исполнитель) */
import { Alert, ScrollView, View, Text, StyleSheet, Pressable } from 'react-native';
import { usePathname } from 'expo-router';
import { RenovaTheme, card } from '@/constants/Theme';
import { ReadOnlyBanner } from '@/components/renova/ReadOnlyGuard';
import { UnifiedAcceptanceList } from '@/components/renova/UnifiedAcceptanceList';
import { computePendingAcceptanceCount } from '@/lib/domain/acceptancePending';
import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useRenova } from '@/lib/context/RenovaContext';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import { useProjectDataReload } from '@/lib/useProjectDataReload';
import { api, ProjectIssue, WorkAcceptance } from '@/lib/api';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { ProjectEmptyState } from '@/components/renova/ProjectEmptyState';
import { screenLayout } from '@/constants/screenLayout';
import { issueSeverityLabel, issueStatusLabel } from '@/constants/labels';
import { useNavFromHere } from '@/lib/navigation';
import { isOfflineQueued, notifyOfflineQueued } from '@/lib/offlineUi';
import { useAsyncResource, asyncShowError, asyncShowStale, asyncIsRefreshing, asyncIsLoading } from '@/lib/async';
import { InlineError, StaleDataBanner, LoadingSkeleton } from '@/components/async';

export function ContractorControlView() {
  const pathname = usePathname();
  const nav = useNavFromHere();
  const { user, activeProject, readOnly } = useRenova();
  const projectId = activeProject?.id;
  const {
    resource: issuesRes,
    data: issuesData,
    reload: reloadIssues,
  } = useAsyncResource<ProjectIssue[]>({
    contextKey: `control-issues:${projectId || ''}`,
    enabled: Boolean(user?.id && projectId),
    scope: 'control.issues',
    fetcher: async () => {
      if (!user || !activeProject) return [];
      return api.listIssues(user.id, activeProject.id);
    },
    isEmpty: (d) => d.length === 0,
  });
  const {
    resource: acceptRes,
    data: acceptData,
    reload: reloadAccept,
  } = useAsyncResource<WorkAcceptance[]>({
    contextKey: `control-accept:${projectId || ''}`,
    enabled: Boolean(user?.id && projectId),
    scope: 'control.acceptances',
    fetcher: async () => {
      if (!user || !activeProject) return [];
      return api.listWorkAcceptances(user.id, activeProject.id);
    },
    isEmpty: (d) => d.length === 0,
  });
  const issues = issuesData ?? [];
  const acceptances = acceptData ?? [];

  const reload = useCallback(() => {
    void reloadIssues({ soft: true });
    void reloadAccept({ soft: true });
  }, [reloadIssues, reloadAccept]);

  useFocusEffect(useCallback(() => { reload(); }, [reload]));
  // W89: после приёмки/QC в другом экране — обновить список без remount
  useProjectDataReload(reload);

  if (!activeProject || !user) return <ProjectEmptyState role="contractor" />;

  const pendingCount = computePendingAcceptanceCount(activeProject.stages, acceptances);
  const rework = activeProject.stages.filter((s) => s.status === 'rework');

  return (
    <ScrollView style={s.wrap} contentContainerStyle={screenLayout.contentStyle}>
      <ReadOnlyBanner />
      {asyncShowStale(issuesRes) || asyncShowStale(acceptRes) ? (
        <StaleDataBanner
          error={issuesRes.error || acceptRes.error}
          onRetry={reload}
          busy={asyncIsRefreshing(issuesRes) || asyncIsRefreshing(acceptRes)}
        />
      ) : null}
      {asyncShowError(issuesRes) || asyncShowError(acceptRes) ? (
        <InlineError
          error={issuesRes.error || acceptRes.error}
          title="Не удалось загрузить контроль"
          onRetry={() => { void reloadIssues({ soft: false }); void reloadAccept({ soft: false }); }}
          busy={asyncIsRefreshing(issuesRes) || asyncIsRefreshing(acceptRes)}
        />
      ) : null}
      {asyncIsLoading(issuesRes) && asyncIsLoading(acceptRes) ? <LoadingSkeleton rows={2} /> : null}

      <View style={s.summary}>
        <View style={s.cell}><Text style={s.n}>{pendingCount}</Text><Text style={s.l}>Приёмка</Text></View>
        <View style={s.cell}><Text style={s.n}>{issues.filter(i => i.status !== 'closed').length || rework.length}</Text><Text style={s.l}>Замечания</Text></View>
        <View style={s.cell}><Text style={s.n}>{issues.filter(i => i.severity === 'critical' || i.severity === 'high').length}</Text><Text style={s.l}>Критичные</Text></View>
      </View>

      <Text style={s.section}>Ожидают приёмки</Text>
      <UnifiedAcceptanceList stages={activeProject.stages} acceptances={acceptances} returnTo={pathname} role="contractor" />

      <Text style={s.section}>Замечания</Text>
      {!asyncShowError(issuesRes) && !issues.filter(i => i.status !== 'closed').length && <Text style={s.empty}>Нет открытых замечаний</Text>}
      {!asyncShowError(issuesRes) && issues.filter(i => i.status !== 'closed').slice(0, 5).map((iss) => (
        <Pressable
          key={iss.id}
          style={s.row}
          onPress={() => { if (iss.stage_id) nav.stage(iss.stage_id); }}
          disabled={!iss.stage_id}
        >
          <Text style={s.title}>{iss.title}</Text>
          <Text style={s.meta}>{issueSeverityLabel(iss.severity)} · {issueStatusLabel(iss.status)}{iss.due_at ? ` · до ${iss.due_at.slice(0, 10)}` : ''}{iss.stage_id ? ' · → этап' : ''}</Text>
          {!readOnly && iss.status !== 'closed' && iss.status !== 'fixed' && !(iss.title || '').startsWith('[Гарантия]') ? (
            <PrimaryButton
              title="Исправлено"
              compact
              variant="outline"
              onPress={async () => {
                try {
                  const updated = await api.closeIssue(user!.id, activeProject!.id, iss.id);
                  await syncProjectSideEffects({ user, project: activeProject });
                  reload();
                  if (updated?.status === 'fixed') {
                    Alert.alert('QC', 'Отмечено как исправлено — заказчик получит уведомление для подтверждения');
                  }
                } catch (e) {
                  if (isOfflineQueued(e)) notifyOfflineQueued('Исправление замечания');
                  else {
                    reportError('control.markFixed', e);
                    Alert.alert('Ошибка', e instanceof Error ? e.message : 'Не удалось отметить');
                  }
                }
              }}
            />
          ) : null}
          {(iss.title || '').startsWith('[Гарантия]') && iss.status !== 'closed' ? (
            <Text style={s.meta}>Гарантию закрывает заказчик в Документах</Text>
          ) : null}
        </Pressable>
      ))}

      {rework.length > 0 && <>
        <Text style={s.section}>Доработка</Text>
        {rework.map((st) => (
          <Pressable key={st.id} style={s.row} onPress={() => nav.stage(st.id)}>
            <Text style={s.title}>{st.name}</Text>
            <Text style={s.meta}>Доработка</Text>
          </Pressable>
        ))}
      </>}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: RenovaTheme.colors.background },
  summary: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  cell: { ...card, flex: 1, alignItems: 'center', marginBottom: 0 },
  n: { fontSize: 22, fontWeight: '800' }, l: { fontSize: 12, color: RenovaTheme.colors.textMuted },
  section: { fontSize: 12, fontWeight: '700', color: RenovaTheme.colors.textMuted, textTransform: 'uppercase', marginVertical: 8 },
  row: { ...card, paddingVertical: 12 },
  title: { fontSize: 15, fontWeight: '600' },
  meta: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginTop: 2 },
  empty: { fontSize: 13, color: RenovaTheme.colors.textMuted, marginBottom: 12 },
});
