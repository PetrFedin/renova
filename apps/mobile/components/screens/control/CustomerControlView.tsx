import { reportError } from '@/lib/reportError';
/** Контроль — приёмка, замечания, качество */
import { Alert, ScrollView, View, Text, StyleSheet, Pressable } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { screenTypography, listRowStyles } from '@/constants/screenTypography';
import { ReadOnlyBanner } from '@/components/renova/ReadOnlyGuard';
import { TechnicalSupervisionCard } from '@/components/renova/TechnicalSupervisionCard';
import { UnifiedAcceptanceList } from '@/components/renova/UnifiedAcceptanceList';
import { computePendingAcceptanceCount } from '@/lib/domain/acceptancePending';
import { useCallback, useState } from 'react';
import { useFocusEffect, useLocalSearchParams, usePathname } from 'expo-router';
import { useRenova } from '@/lib/context/RenovaContext';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import { useProjectDataReload } from '@/lib/useProjectDataReload';
import { api, ProjectIssue, WorkAcceptance } from '@/lib/api';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { ProjectEmptyState } from '@/components/renova/ProjectEmptyState';
import { LoadErrorState } from '@/components/ui/LoadErrorState';
import { screenLayout } from '@/constants/screenLayout';
import { issueSeverityLabel, issueStatusLabel } from '@/constants/labels';
import { useNavFromHere } from '@/lib/navigation';
import { openQcIssue } from '@/lib/qcNav';
import { isOfflineQueued, notifyOfflineQueued } from '@/lib/offlineUi';
import { pushOsNav } from '@/lib/pushOsNav';
import { objectTabRoute } from '@/constants/osSections';
import { showActionConfirm } from '@/lib/actionConfirmBus';

export function CustomerControlView() {
  const pathname = usePathname();
  const nav = useNavFromHere('customer');
  const { issueId: focusIssueId, focus } = useLocalSearchParams<{ issueId?: string; focus?: string }>();
  const focusWarranty = focus === 'warranty';
  const { user, activeProject, readOnly } = useRenova();
  const [issues, setIssues] = useState<ProjectIssue[]>([]);
  const [acceptances, setAcceptances] = useState<WorkAcceptance[]>([]);
  const [warrantyItems, setWarrantyItems] = useState<{ id: string; title: string; status: string; overdue?: boolean }[]>([]);
  const [warrantyOpen, setWarrantyOpen] = useState(0);
  const [loadState, setLoadState] = useState<'loading' | 'loaded' | 'error'>('loading');

  const reload = useCallback(() => {
    if (user && activeProject) {
      setLoadState('loading');
      Promise.all([
        api.listIssues(user.id, activeProject.id),
        api.listWorkAcceptances(user.id, activeProject.id),
        api.listWarrantyClaims(user.id, activeProject.id),
      ])
        .then(([iss, acc, w]) => {
          setIssues(iss);
          setAcceptances(acc);
          setWarrantyItems(w.items || []);
          setWarrantyOpen(w.open ?? 0);
          setLoadState('loaded');
        })
        .catch((e) => {
          reportError('control.reload', e);
          setLoadState('error');
        });
    }
  }, [user?.id, activeProject?.id]);

  useFocusEffect(useCallback(() => { reload(); }, [reload]));
  useProjectDataReload(reload);

  if (!activeProject || !user) return <ProjectEmptyState role="customer" />;

  if (loadState === 'error') {
    return (
      <ScrollView style={s.wrap} contentContainerStyle={screenLayout.contentStyle}>
        <LoadErrorState
          title="Не удалось загрузить приёмку"
          onRetry={reload}
          role="customer"
          showChatCta
        />
      </ScrollView>
    );
  }

  const pendingCount = computePendingAcceptanceCount(activeProject.stages, acceptances);
  const rework = activeProject.stages.filter((stage) => stage.status === 'rework');
  const openIssues = issues.filter((issue) => issue.status !== 'closed');
  const sortedIssues = focusIssueId
    ? [...openIssues].sort((a, b) => Number(b.id === focusIssueId) - Number(a.id === focusIssueId))
    : openIssues;
  const openWarranty = warrantyItems.filter((item) => item.status !== 'closed');

  const warrantyBlock = (warrantyOpen > 0 || focusWarranty) ? (
    <>
      <Text style={[s.section, focusWarranty && s.sectionFocus]}>Гарантия{warrantyOpen ? ` · ${warrantyOpen}` : ''}</Text>
      {!openWarranty.length && focusWarranty ? <Text style={s.empty}>Нет открытых гарантийных обращений</Text> : null}
      {openWarranty.map((item) => (
        <Pressable
          key={item.id}
          style={[s.row, focusWarranty && s.rowFocus]}
          onPress={() => openQcIssue(item.id, pathname, 'customer')}
        >
          <Text style={s.title}>{item.title}{item.overdue ? ' · просрочено' : ''}</Text>
          <Text style={s.meta}>{item.status}</Text>
        </Pressable>
      ))}
      {openWarranty.length > 0 || focusWarranty ? (
        <PrimaryButton
          title="Все гарантии (QC)"
          variant="outline"
          onPress={() => openQcIssue(openWarranty[0]?.id, pathname, 'customer')}
        />
      ) : null}
    </>
  ) : null;

  return (
    <ScrollView style={s.wrap} contentContainerStyle={screenLayout.contentStyle}>
      <ReadOnlyBanner />
      <TechnicalSupervisionCard userId={user.id} projectId={activeProject.id} canManage={!readOnly} />

      <View style={s.summary}>
        <View style={s.cell}><Text style={s.n}>{pendingCount}</Text><Text style={s.l}>Приёмка</Text></View>
        <View style={s.cell}><Text style={s.n}>{openIssues.length || rework.length}</Text><Text style={s.l}>Замечания</Text></View>
        <View style={s.cell}><Text style={s.n}>{warrantyOpen || openIssues.filter((issue) => issue.severity === 'critical' || issue.severity === 'high').length}</Text><Text style={s.l}>{warrantyOpen ? 'Гарантия' : 'Критичные'}</Text></View>
      </View>

      {focusWarranty ? warrantyBlock : null}

      <Text style={s.section}>Решение</Text>
      <Text style={s.decisionHint}>Примите этап или верните на доработку. Оценка — только если реально проверили.</Text>
      <UnifiedAcceptanceList
        stages={activeProject.stages}
        acceptances={acceptances}
        returnTo={pathname}
        role="customer"
        onChanged={reload}
      />

      {!focusWarranty ? warrantyBlock : null}

      <Text style={s.section}>Замечания</Text>
      {!sortedIssues.length && <Text style={s.empty}>Нет открытых замечаний</Text>}
      {sortedIssues.slice(0, 5).map((issue) => (
        <Pressable
          key={issue.id}
          style={[s.row, issue.id === focusIssueId && s.rowFocus]}
          onPress={() => openQcIssue(issue.id, pathname, 'customer')}
        >
          <Text style={s.title}>{issue.title}{issue.photo_url ? ' · фото' : ''}{issue.floor_plan_id ? ' · план' : ''}</Text>
          <Text style={s.meta}>{issueSeverityLabel(issue.severity)} · {issueStatusLabel(issue.status)}{issue.due_at ? ` · до ${issue.due_at.slice(0, 10)}` : ''}{issue.stage_id ? ' · → этап' : ''}</Text>
          {issue.floor_plan_id ? (
            <Pressable
              onPress={() => pushOsNav(objectTabRoute('customer', 'plan', 'floor'), pathname, 'customer')}
              style={{ marginTop: 4 }}
            >
              <Text style={s.planLink}>→ На план</Text>
            </Pressable>
          ) : null}
          {!readOnly && issue.status !== 'closed' && (
            <PrimaryButton
              title={issue.status === 'fixed' ? 'Подтвердить исправление' : 'Закрыть'}
              compact
              variant="outline"
              onPress={() => {
                const wasFixed = issue.status === 'fixed';
                showActionConfirm({
                  title: wasFixed ? 'Подтвердить исправление?' : 'Закрыть замечание?',
                  message: `«${issue.title}»`,
                  primaryLabel: wasFixed ? 'Подтвердить' : 'Закрыть',
                  onPrimary: () => {
                    void (async () => {
                      try {
                        await api.closeIssue(user.id, activeProject.id, issue.id);
                        await syncProjectSideEffects({ user, project: activeProject });
                        reload();
                        if (wasFixed) {
                          showActionConfirm({
                            title: 'QC',
                            message: 'Исправление подтверждено — замечание закрыто',
                            primaryLabel: 'Во входящие',
                            onPrimary: () => pushOsNav('/inbox', pathname, 'customer'),
                            secondaryLabel: 'Позже',
                            onSecondary: () => undefined,
                          });
                        }
                      } catch (error) {
                        if (isOfflineQueued(error)) {
                          notifyOfflineQueued(wasFixed ? 'Подтверждение исправления' : 'Закрытие замечания');
                        } else {
                          reportError('control.customerClose', error);
                          showActionConfirm({
                            title: 'Ошибка',
                            message: error instanceof Error ? error.message : 'Не удалось обновить',
                          });
                        }
                      }
                    })();
                  },
                  secondaryLabel: 'Отмена',
                  onSecondary: () => undefined,
                });
              }}
            />
          )}
        </Pressable>
      ))}
      {openIssues.length > 0 ? (
        <PrimaryButton
          title="Все замечания (QC)"
          variant="outline"
          onPress={() => openQcIssue(sortedIssues[0]?.id, pathname, 'customer')}
        />
      ) : null}

      {rework.length > 0 && <>
        <Text style={s.section}>Доработка</Text>
        {rework.map((stage) => (
          <Pressable key={stage.id} style={s.row} onPress={() => nav.stage(stage.id)}>
            <Text style={s.title}>{stage.name}</Text>
            <Text style={s.meta}>Доработка</Text>
          </Pressable>
        ))}
      </>}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: RenovaTheme.colors.background },
  summary: { ...listRowStyles.summaryRow },
  cell: { ...listRowStyles.metricCell },
  n: { ...screenTypography.metric },
  l: { ...screenTypography.metricLabel },
  section: { ...screenTypography.section },
  sectionFocus: { ...screenTypography.sectionFocus },
  row: { ...listRowStyles.row },
  rowFocus: { ...listRowStyles.rowFocus },
  title: { ...screenTypography.listTitle },
  meta: { ...screenTypography.listMeta },
  planLink: { ...screenTypography.listLink },
  empty: { ...screenTypography.empty, marginBottom: 12 },
  decisionHint: { ...screenTypography.listMeta, marginBottom: 8 },
});
