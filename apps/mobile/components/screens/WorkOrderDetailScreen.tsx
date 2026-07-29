/** Детальная работа — статус, описание, связи с чатом / этапом / согласованиями */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { BackHeader } from '@/components/renova/BackHeader';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { WorkOrderDetailPanel } from '@/components/renova/WorkOrderDetailPanel';
import { useRenova } from '@/lib/context/RenovaContext';
import { isOfflineQueued, notifyOfflineQueued } from '@/lib/offlineUi';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import { useProjectDataReload } from '@/lib/useProjectDataReload';
import { useWriteAllowed } from '@/components/renova/ReadOnlyGuard';
import { api, ApiError, type WorkOrder } from '@/lib/api';
import {
  WORK_STATUS_LABEL,
  hasCanonicalPaymentAction,
  workActions,
  type WorkOrderStatus,
  type WorkTransitionAction,
} from '@/lib/domain/workLifecycle';
import { isWorkArchived } from '@/lib/domain/workArchive';
import { showActionConfirm } from '@/lib/actionConfirmBus';
import { RenovaTheme, formatRub } from '@/constants/Theme';
import { screenTypography } from '@/constants/screenTypography';
import { budgetTabRoute } from '@/constants/osSections';
import { pushOsNav } from '@/lib/pushOsNav';
import { alertWorkOrderAdvanced } from '@/lib/jobLeadNav';
import { reportError } from '@/lib/reportError';

function transitionErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Не удалось изменить статус. Повторите ещё раз.';
  const detail = typeof error.detail === 'string'
    ? error.detail
    : (error.detail as { message?: string; detail?: string } | undefined)?.message
      || (error.detail as { detail?: string } | undefined)?.detail;
  if (error.status === 403) return 'Этот переход недоступен для вашей роли.';
  if (error.status === 409 && detail === 'payment_transition_required') {
    return 'Статус оплаты подтверждается только через счёт, чек или банковскую выписку.';
  }
  if (detail?.startsWith('invalid_work_order_transition:')) return 'Работа уже находится в другом статусе. Обновите экран.';
  return detail || error.message || 'Не удалось изменить статус.';
}

export function WorkOrderDetailScreen() {
  const { id, returnTo } = useLocalSearchParams<{ id: string; returnTo?: string }>();
  const { user, activeProject } = useRenova();
  const canWrite = useWriteAllowed();
  const [workOrder, setWorkOrder] = useState<WorkOrder | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [mutation, setMutation] = useState<WorkOrderStatus | null>(null);
  const mutationRef = useRef(false);
  const role = user?.role === 'contractor' ? 'contractor' : 'customer';
  const busy = mutation !== null;

  const reload = useCallback(async () => {
    if (!user || !activeProject || !id) return;
    try {
      const row = await api.getWorkOrder(user.id, activeProject.id, id);
      setWorkOrder(row);
      setLoadState('loaded');
    } catch (error) {
      reportError('components.screens.WorkOrderDetailScreen.WorkOrder', error);
      setLoadState('error');
    }
  }, [user?.id, activeProject?.id, id]);

  useEffect(() => { void reload(); }, [reload]);
  useProjectDataReload(reload);

  const transition = async (next: WorkOrderStatus): Promise<boolean> => {
    if (!user || !activeProject || !workOrder || mutationRef.current) return false;
    mutationRef.current = true;
    setMutation(next);
    try {
      const updated = await api.transitionWorkOrder(user.id, activeProject.id, workOrder.id, next);
      setWorkOrder(updated);
      await syncProjectSideEffects({ user, project: activeProject, role });
      alertWorkOrderAdvanced(role, next);
      return true;
    } catch (error: unknown) {
      if (isOfflineQueued(error)) {
        notifyOfflineQueued('Смена статуса работы');
        return true;
      }
      showActionConfirm({
        title: 'Статус не изменён',
        message: transitionErrorMessage(error),
      });
      return false;
    } finally {
      mutationRef.current = false;
      setMutation(null);
    }
  };

  if (!user || !activeProject || loadState === 'loading') {
    return (
      <>
        <BackHeader title="Работа" returnTo={returnTo} />
        <View style={s.center}><Text>Загрузка…</Text></View>
      </>
    );
  }

  if (loadState === 'error' || !workOrder) {
    return (
      <>
        <BackHeader title="Работа" returnTo={returnTo} />
        <View style={s.errorState}>
          <Text style={s.errorTitle}>Не удалось загрузить работу</Text>
          <Text style={s.errorText}>Это не означает, что работа удалена. Проверьте соединение и повторите.</Text>
          <PrimaryButton title="Повторить" onPress={() => { setLoadState('loading'); void reload(); }} />
        </View>
      </>
    );
  }

  const status = (workOrder.status in WORK_STATUS_LABEL ? workOrder.status : 'draft') as WorkOrderStatus;
  const room = activeProject.rooms?.find((item) => item.id === workOrder.room_id);
  const actions = canWrite ? workActions(status, role) : [];
  const archived = isWorkArchived(status);
  const paymentAction = canWrite && hasCanonicalPaymentAction(status, role);

  const runAction = async (action: WorkTransitionAction) => {
    const back = `/work-order/${workOrder.id}`;
    const execute = async () => {
      const changed = await transition(action.next);
      if (changed && action.next === 'negotiating' && workOrder.chat_thread_id) {
        pushOsNav(
          { pathname: '/chat/[threadId]', params: { threadId: workOrder.chat_thread_id } },
          back,
          role,
        );
      }
    };

    const needsConfirm = action.intent === 'destructive'
      || action.next === 'approved'
      || action.next === 'done'
      || (action.next === 'in_progress' && status === 'review');

    if (!needsConfirm) {
      await execute();
      return;
    }

    const titles: Partial<Record<WorkOrderStatus, string>> = {
      cancelled: 'Отменить работу?',
      approved: 'Согласовать работу?',
      done: 'Принять результат?',
      in_progress: role === 'customer' ? 'Вернуть на доработку?' : 'Вернуть в работу?',
    };
    showActionConfirm({
      title: titles[action.next] || `${action.label}?`,
      message: `«${workOrder.title || 'Работа'}» → ${WORK_STATUS_LABEL[action.next]}`,
      primaryLabel: action.label,
      primaryDestructive: action.intent === 'destructive',
      onPrimary: () => { void execute(); },
      secondaryLabel: 'Отмена',
      onSecondary: () => undefined,
    });
  };

  return (
    <>
      <BackHeader title={workOrder.title} returnTo={returnTo} subtitle={WORK_STATUS_LABEL[status]} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        {archived ? (
          <View style={s.archiveBanner}><Text style={s.archiveText}>В архиве · {WORK_STATUS_LABEL[status]}</Text></View>
        ) : null}

        <WorkOrderDetailPanel
          wo={workOrder}
          role={role}
          roomName={room?.name}
          canWrite={canWrite && !busy}
          userId={user.id}
          projectId={activeProject.id}
          onUpdated={reload}
        />

        {(workOrder.budget_planned > 0 || workOrder.budget_spent > 0) ? (
          <View style={s.budgetRow}>
            <Text style={s.budgetLabel}>Бюджет работы</Text>
            <Text style={s.budgetVal}>{formatRub(workOrder.budget_spent)} / {formatRub(workOrder.budget_planned)}</Text>
          </View>
        ) : null}

        {(actions.length > 0 || paymentAction) ? <Text style={s.section}>Следующий шаг</Text> : null}
        {actions.map((action) => (
          <PrimaryButton
            key={action.next}
            title={action.label}
            variant={action.intent === 'destructive' ? 'dangerOutline' : action.intent === 'secondary' ? 'outline' : 'primary'}
            loading={mutation === action.next}
            disabled={busy && mutation !== action.next}
            onPress={() => { void runAction(action); }}
          />
        ))}
        {paymentAction ? (
          <PrimaryButton
            title="Открыть оплаты"
            disabled={busy}
            onPress={() => pushOsNav(budgetTabRoute(role, 'payments'), `/work-order/${workOrder.id}`, role)}
          />
        ) : null}
      </ScrollView>
    </>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorState: { flex: 1, justifyContent: 'center', padding: 24, gap: 10 },
  errorTitle: { ...screenTypography.listTitle, fontSize: 17 },
  errorText: { ...screenTypography.empty },
  section: { ...screenTypography.section, marginVertical: 12 },
  archiveBanner: { backgroundColor: RenovaTheme.colors.surfaceMuted, padding: 10, borderRadius: 8, marginBottom: 10 },
  archiveText: { fontSize: 13, color: RenovaTheme.colors.textMuted, fontWeight: '600' },
  budgetRow: { marginTop: 4, marginBottom: 8 },
  budgetLabel: { ...screenTypography.metricLabel },
  budgetVal: { ...screenTypography.listTitle, marginTop: 4 },
});
