/** Детальная работа — статус, описание, связи с чатом / этапом / согласованиями */
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, View, Text, StyleSheet, Alert } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { BackHeader } from '@/components/renova/BackHeader';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { WorkOrderDetailPanel } from '@/components/renova/WorkOrderDetailPanel';
import { useRenova } from '@/lib/context/RenovaContext';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import { useProjectDataReload } from '@/lib/useProjectDataReload';
import { useWriteAllowed } from '@/components/renova/ReadOnlyGuard';
import { api, WorkOrder } from '@/lib/api';
import { WORK_STATUS_LABEL, workActions, type WorkOrderStatus } from '@/lib/domain/workLifecycle';
import { isWorkArchived } from '@/lib/domain/workArchive';
import { RenovaTheme, formatRub } from '@/constants/Theme';
import { budgetTabRoute } from '@/constants/osSections';

export function WorkOrderDetailScreen() {
  const { id, returnTo } = useLocalSearchParams<{ id: string; returnTo?: string }>();
  const { user, activeProject } = useRenova();
  const canWrite = useWriteAllowed();
  const [wo, setWo] = useState<WorkOrder | null>(null);
  const role = user?.role === 'contractor' ? 'contractor' : 'customer';

  const reload = useCallback(() => {
    if (!user || !activeProject || !id) return;
    api.getWorkOrder(user.id, activeProject.id, id).then(setWo).catch(() => setWo(null));
  }, [user?.id, activeProject?.id, id]);

  useEffect(() => { reload(); }, [reload]);
  useProjectDataReload(reload);

  async function transition(next: WorkOrderStatus) {
    if (!user || !activeProject || !wo) return;
    try {
      const updated = await api.transitionWorkOrder(user.id, activeProject.id, wo.id, next);
      setWo(updated);
      await syncProjectSideEffects({ user, project: activeProject, role });
    } catch (e: unknown) {
      if (e instanceof Error && e.message === 'offline_queued') {
        Alert.alert('Офлайн', 'Смена статуса отправится при подключении');
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
                if (a.next === 'negotiating' && wo.chat_thread_id) {
                  router.push({ pathname: '/chat/[threadId]', params: { threadId: wo.chat_thread_id, returnTo: `/work-order/${wo.id}` } } as any);
                  return;
                }
                // W104: оплата — в канон Бюджет/Оплаты (Payment), не только flip статуса WO
                if (a.next === 'paid') {
                  const r = budgetTabRoute(role, 'payments');
                  router.push({
                    pathname: r.pathname,
                    params: { ...(r.params || {}), returnTo: `/work-order/${wo.id}` },
                  } as any);
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
  section: { fontWeight: '700', marginVertical: 12, textTransform: 'uppercase', fontSize: 12, color: RenovaTheme.colors.textMuted },
  archiveBanner: { backgroundColor: RenovaTheme.colors.surfaceMuted, padding: 10, borderRadius: 8, marginBottom: 10 },
  archiveText: { fontSize: 13, color: RenovaTheme.colors.textMuted, fontWeight: '600' },
  budgetRow: { marginTop: 4, marginBottom: 8 },
  budgetLabel: { fontSize: 11, fontWeight: '700', color: RenovaTheme.colors.textMuted, textTransform: 'uppercase' },
  budgetVal: { fontSize: 15, fontWeight: '700', marginTop: 4 },
});
