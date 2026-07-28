import { reportError } from '@/lib/reportError';
/** Контроль — приёмка, замечания, качество */
import { Alert, ScrollView, View, Text, StyleSheet, Pressable } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { screenTypography, listRowStyles } from '@/constants/screenTypography';
import { ReadOnlyBanner } from '@/components/renova/ReadOnlyGuard';
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
  // W89: после приёмки/QC в другом экране — обновить список без remount
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
  const rework = activeProject.stages.filter((s) => s.status === 'rework');
  const openIssues = issues.filter((i) => i.status !== 'closed');
  const sortedIssues = focusIssueId
    ? [...openIssues].sort((a, b) => Number(b.id === focusIssueId) - Number(a.id === focusIssueId))
    : openIssues;
  const openWarranty = warrantyItems.filter((w) => w.status !== 'closed');

  const warrantyBlock = (warrantyOpen > 0 || focusWarranty) ? (
    <>
      <Text style={[s.section, focusWarranty && s.sectionFocus]}>Гарантия{warrantyOpen ? ` · ${warrantyOpen}` : ''}</Text>
      {!openWarranty.length && focusWarranty ? (
        <Text style={s.empty}>Нет открытых гарантийных обращений</Text>
      ) : null}
      {openWarranty.map((w) => (
        <Pressable
          key={w.id}
          style={[s.row, focusWarranty && s.rowFocus]}
          onPress={() => openQcIssue(w.id, pathname, 'customer')}
        >
          <Text style={s.title}>{w.title}{w.overdue ? ' · просрочено' : ''}</Text>
          <Text style={s.meta}>{w.status}</Text>
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
      <View style={s.summary}>
        <View style={s.cell}><Text style={s.n}>{pendingCount}</Text><Text style={s.l}>Приёмка</Text></View>
        <View style={s.cell}><Text style={s.n}>{openIssues.length || rework.length}</Text><Text style={s.l}>Замечания</Text></View>
        <View style={s.cell}><Text style={s.n}>{warrantyOpen || openIssues.filter(i => i.severity === 'critical' || i.severity === 'high').length}</Text><Text style={s.l}>{warrantyOpen ? 'Гарантия' : 'Критичные'}</Text></View>
      </View>

      {/* Investor P1: focus=warranty — блок гарантий первым */}
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
      {sortedIssues.slice(0, 5).map((iss) => (
        <Pressable
          key={iss.id}
          style={[s.row, iss.id === focusIssueId && s.rowFocus]}
          onPress={() => openQcIssue(iss.id, pathname, 'customer')}
        >
          <Text style={s.title}>{iss.title}{iss.photo_url ? ' · фото' : ''}{iss.floor_plan_id ? ' · план' : ''}</Text>
          <Text style={s.meta}>{issueSeverityLabel(iss.severity)} · {issueStatusLabel(iss.status)}{iss.due_at ? ` · до ${iss.due_at.slice(0, 10)}` : ''}{iss.stage_id ? ' · → этап' : ''}</Text>
          {iss.floor_plan_id ? (
            <Pressable
              onPress={() => pushOsNav(objectTabRoute('customer', 'plan', 'floor'), pathname, 'customer')}
              style={{ marginTop: 4 }}
            >
              <Text style={s.planLink}>→ На план</Text>
            </Pressable>
          ) : null}
          {!readOnly && iss.status !== 'closed' && (
            <PrimaryButton
              title={iss.status === 'fixed' ? 'Подтвердить исправление' : 'Закрыть'}
              compact
              variant="outline"
              onPress={() => {
                const wasFixed = iss.status === 'fixed';
                // Clarity W: pre-confirm до closeIssue
                showActionConfirm({
                  title: wasFixed ? 'Подтвердить исправление?' : 'Закрыть замечание?',
                  message: `«${iss.title}»`,
                  primaryLabel: wasFixed ? 'Подтвердить' : 'Закрыть',
                  onPrimary: () => {
                    void (async () => {
                      try {
                        await api.closeIssue(user!.id, activeProject!.id, iss.id);
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
                      } catch (e) {
                        if (isOfflineQueued(e)) {
                          notifyOfflineQueued(wasFixed ? 'Подтверждение исправления' : 'Закрытие замечания');
                        } else {
                          reportError('control.customerClose', e);
                          showActionConfirm({
                            title: 'Ошибка',
                            message: e instanceof Error ? e.message : 'Не удалось обновить',
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
