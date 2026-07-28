/** Детальная работа — статус, описание, связи с чатом / этапом / согласованиями */
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, View, Text, StyleSheet, Alert } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { BackHeader } from '@/components/renova/BackHeader';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { WorkOrderDetailPanel } from '@/components/renova/WorkOrderDetailPanel';
import { useRenova } from '@/lib/context/RenovaContext';
import { isOfflineQueued, notifyOfflineQueued } from '@/lib/offlineUi';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import { useProjectDataReload } from '@/lib/useProjectDataReload';
import { useWriteAllowed } from '@/components/renova/ReadOnlyGuard';
import { api, WorkOrder } from '@/lib/api';
import { WORK_STATUS_LABEL, workActions, type WorkOrderStatus } from '@/lib/domain/workLifecycle';
import { isWorkArchived } from '@/lib/domain/workArchive';
import { showActionConfirm } from '@/lib/actionConfirmBus';
import { RenovaTheme, formatRub } from '@/constants/Theme';
import { screenTypography } from '@/constants/screenTypography';
import { budgetTabRoute } from '@/constants/osSections';
import { pushOsNav } from '@/lib/pushOsNav';
import { alertWorkOrderAdvanced } from '@/lib/jobLeadNav';
import { reportError } from '@/lib/reportError';

export function WorkOrderDetailScreen() {
  const { id, returnTo } = useLocalSearchParams<{ id: string; returnTo?: string }>();
  const { user, activeProject } = useRenova();
  const canWrite = useWriteAllowed();
  const [wo, setWo] = useState<WorkOrder | null>(null);
  const role = user?.role === 'contractor' ? 'contractor' : 'customer';

  const reload = useCallback(() => {
    if (!user || !activeProject || !id) return;
    api.getWorkOrder(user.id, activeProject.id, id).then(setWo).catch((e) => { reportError('components.screens.WorkOrderDetailScreen.Wo', e); setWo(null); });
  }, [user?.id, activeProject?.id, id]);

  useEffect(() => { reload(); }, [reload]);
  useProjectDataReload(reload);

  async function transition(next: WorkOrderStatus) {
    if (!user || !activeProject || !wo) return;
    try {
      const updated = await api.transitionWorkOrder(user.id, activeProject.id, wo.id, next);
      setWo(updated);
      await syncProjectSideEffects({ user, project: activeProject, role });
      // W130: WO lifecycle → приёмка / оплаты / график
      alertWorkOrderAdvanced(role, next);
    } catch (e: unknown) {
      if (isOfflineQueued(e)) {
        notifyOfflineQueued('Смена статуса');
      } else {
        Alert.alert('Ошибка', 'Недопустимый переход статуса');
      }
    }
  }

  if (!wo || !user || !activeProject) {
    return (
      <>
        <BackHeader title="Работа" returnTo={returnTo} />
        <View style={s.center}><Text>Загрузка…</Text></View>
      </>
    );
  }

  const status = (wo.status in WORK_STATUS_LABEL ? wo.status : 'draft') as WorkOrderStatus;
  const room = activeProject.rooms?.find((r) => r.id === wo.room_id);
  const actions = canWrite ? workActions(status, role) : [];
  const archived = isWorkArchived(status);

  return (
    <>
      <BackHeader title={wo.title} returnTo={returnTo} subtitle={WORK_STATUS_LABEL[status]} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        {archived && (
          <View style={s.archiveBanner}><Text style={s.archiveText}>В архиве · {WORK_STATUS_LABEL[status]}</Text></View>
        )}

        <WorkOrderDetailPanel
          wo={wo}
          role={role}
          roomName={room?.name}
          canWrite={canWrite}
          userId={user.id}
          projectId={activeProject.id}
          onUpdated={reload}
        />

        {(wo.budget_planned > 0 || wo.budget_spent > 0) && (
          <View style={s.budgetRow}>
            <Text style={s.budgetLabel}>Бюджет работы</Text>
            <Text style={s.budgetVal}>{formatRub(wo.budget_spent)} / {formatRub(wo.budget_planned)}</Text>
          </View>
        )}

        {actions.length > 0 && (
          <>
            <Text style={s.section}>Следующий шаг</Text>
            {actions.map((a) => (
              <PrimaryButton key={a.next} title={a.label} variant={a.next === 'cancelled' ? 'outline' : undefined} onPress={() => {
                const back = `/work-order/${wo.id}`;
                if (a.next === 'negotiating' && wo.chat_thread_id) {
                  // W118: чат WO → SoT
                  pushOsNav(
                    { pathname: '/chat/[threadId]', params: { threadId: wo.chat_thread_id } },
                    back,
                    role,
                  );
                  return;
                }
                // W104/W118: оплата — Бюджет/Оплаты через pushOsNav
                if (a.next === 'paid') {
                  pushOsNav(budgetTabRoute(role, 'payments'), back, role);
                  return;
                }
                // Clarity W: irreversible WO transitions — pre-confirm
                const needsConfirm =
                  a.next === 'cancelled' ||
                  a.next === 'approved' ||
                  a.next === 'done' ||
                  (a.next === 'in_progress' && wo.status === 'review');
                if (needsConfirm) {
                  const titles: Partial<Record<WorkOrderStatus, string>> = {
                    cancelled: 'Отменить работу?',
                    approved: 'Согласовать работу?',
                    done: 'Принять результат?',
                    in_progress: 'Вернуть на доработку?',
                  };
                  showActionConfirm({
                    title: titles[a.next] || `${a.label}?`,
                    message: `«${wo.title || 'Работа'}» → ${WORK_STATUS_LABEL[a.next]}`,
                    primaryLabel: a.label,
                    onPrimary: () => { void transition(a.next); },
                    secondaryLabel: 'Отмена',
                    onSecondary: () => undefined,
                  });
                  return;
                }
                transition(a.next);
              }} />
            ))}
          </>
        )}
      </ScrollView>
    </>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  section: { ...screenTypography.section, marginVertical: 12 },
  archiveBanner: { backgroundColor: RenovaTheme.colors.surfaceMuted, padding: 10, borderRadius: 8, marginBottom: 10 },
  archiveText: { fontSize: 13, color: RenovaTheme.colors.textMuted, fontWeight: '600' },
  budgetRow: { marginTop: 4, marginBottom: 8 },
  budgetLabel: { ...screenTypography.metricLabel },
  budgetVal: { ...screenTypography.listTitle, marginTop: 4 },
});
