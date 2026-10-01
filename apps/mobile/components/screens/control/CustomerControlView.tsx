import { reportError } from '@/lib/reportError';
/** Контроль — приёмка, замечания, качество */
import { ScrollView, View, Text, StyleSheet, Pressable } from 'react-native';
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
import { LoadingState } from '@/components/ui/LoadingState';
import { screenLayout } from '@/constants/screenLayout';
import { issueSeverityLabel, issueStatusLabel } from '@/constants/labels';
import { useNavFromHere } from '@/lib/navigation';
import { openQcIssue } from '@/lib/qcNav';
import { isOfflineQueued, notifyOfflineQueued } from '@/lib/offlineUi';
import { pushOsNav } from '@/lib/pushOsNav';
import { objectTabRoute } from '@/constants/osSections';
import { showActionConfirm } from '@/lib/actionConfirmBus';
import { writeResultMessage } from '@/lib/offlineResultMessage';
import { controlSummary, customerIssueActions, customerIssueWaitingHint, type IssueAction } from '@/lib/domain/issueControlActions';

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

  if (loadState === 'loading' && !issues.length && !acceptances.length) {
    return (
      <ScrollView style={s.wrap} contentContainerStyle={screenLayout.contentStyle}>
        <LoadingState title="Загружаем приёмку…" />
      </ScrollView>
    );
  }

  const pendingCount = computePendingAcceptanceCount(activeProject.stages, acceptances);
  const selfManaged = !activeProject.contractor_id;
  const rework = activeProject.stages.filter((s) => s.needs_rework && s.status !== 'done');
  const openIssues = issues.filter((i) => i.status !== 'closed');
  const sortedIssues = focusIssueId
    ? [...openIssues].sort((a, b) => Number(b.id === focusIssueId) - Number(a.id === focusIssueId))
    : openIssues;
  const summary = controlSummary(openIssues, pendingCount);
  const openWarranty = warrantyItems.filter((w) => w.status !== 'closed');

  const confirmIssueAction = (iss: ProjectIssue, action: IssueAction) => {
    showActionConfirm({
      title: action.confirmTitle,
      message: `«${iss.title}»`,
      primaryLabel: action.confirmPrimary,
      onPrimary: () => {
        void (async () => {
          try {
            await api.transitionIssue(user.id, activeProject.id, iss.id, action.next);
            await syncProjectSideEffects({ user, project: activeProject });
            reload();
            if (action.key === 'confirm') {
              showActionConfirm({
                title: 'Замечание закрыто',
                message: 'Исправление подтверждено.',
                primaryLabel: 'Во входящие',
                onPrimary: () => pushOsNav('/inbox', pathname, 'customer'),
                secondaryLabel: 'Позже',
                onSecondary: () => undefined,
              });
            }
          } catch (e) {
            if (isOfflineQueued(e)) {
              notifyOfflineQueued(action.label);
            } else {
              reportError('control.customerIssueAction', e);
              showActionConfirm({
                title: 'Не удалось обновить замечание',
                message: writeResultMessage(e, 'Повторите попытку.'),
                primaryLabel: 'Понятно',
                onPrimary: () => undefined,
              });
            }
          }
        })();
      },
      secondaryLabel: 'Отмена',
      onSecondary: () => undefined,
    });
  };

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
          <Text style={s.meta}>{issueStatusLabel(w.status)}</Text>
        </Pressable>
      ))}
    </>
  ) : null;

  return (
    <ScrollView style={s.wrap} contentContainerStyle={screenLayout.contentStyle}>
      <ReadOnlyBanner />
      <View style={s.summary}>
        <View style={s.cell}><Text style={s.n}>{summary.pendingAcceptance}</Text><Text style={s.l}>Приёмка</Text></View>
        <View style={s.cell}><Text style={s.n}>{summary.openIssues}</Text><Text style={s.l}>Замечания</Text></View>
        <View style={s.cell}><Text style={s.n}>{summary.criticalOpen}</Text><Text style={s.l}>Критичные</Text></View>
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
          onPress={() => { if (iss.stage_id) nav.stage(iss.stage_id); }}
          disabled={!iss.stage_id}
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
          {iss.description ? <Text style={s.meta}>{iss.description}</Text> : null}
          {!readOnly ? (
            customerIssueActions(iss.status, selfManaged).map((action, idx) => (
              <PrimaryButton
                key={action.key}
                title={action.label}
                compact
                variant={idx === 0 ? 'outline' : 'ghost'}
                onPress={() => confirmIssueAction(iss, action)}
              />
            ))
          ) : null}
          {!readOnly && customerIssueWaitingHint(iss.status, selfManaged) ? (
            <Text style={s.meta}>{customerIssueWaitingHint(iss.status, selfManaged)}</Text>
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
