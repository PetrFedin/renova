/** Детализация выбранного дня — события и быстрые действия по задачам */
import { View, Text, StyleSheet, Pressable, ScrollView, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { RenovaTheme, card } from '@/constants/Theme';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { STAGE_STATUS_LABEL } from '@/constants/labels';
import { WORK_STATUS_LABEL, workActions, type WorkOrderStatus } from '@/lib/domain/workLifecycle';
import { isWorkArchived } from '@/lib/domain/workArchive';
import { dayTaskCount, formatCalendarEventDates, isPeriodCalendarEvent, isWorkCalendarEvent } from '@/lib/domain/calendarEvents';
import { api } from '@/lib/api';
import { useRenova } from '@/lib/context/RenovaContext';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import type { CalendarEvent, WorkOrder } from '@/lib/api';
import type { OsRole } from '@/constants/osSections';

const KIND: Record<string, string> = {
  stage_period: 'Этап',
  stage_start: 'Этап',
  stage_end: 'Этап',
  contractor_ready: 'Готово',
  customer_accepted: 'Принято',
  payment: 'Оплата',
  work_period: 'Задача',
  work_start: 'Задача',
  work_due: 'Срок',
  work_done: 'Выполнено',
  material: 'Поставка',
};

function eventStatusLabel(status?: string): string | null {
  if (!status) return null;
  if (status in WORK_STATUS_LABEL) return WORK_STATUS_LABEL[status as keyof typeof WORK_STATUS_LABEL];
  if (status in STAGE_STATUS_LABEL) return STAGE_STATUS_LABEL[status].replace(/^[✓⏳🔨○]\s*/, '');
  return status;
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

type Props = {
  date: string;
  events: CalendarEvent[];
  onBack: () => void;
  onEventPress: (e: CalendarEvent) => void;
  onCreateWork?: () => void;
  readOnly?: boolean;
  canCreateWork?: boolean;
  addTaskLabel?: string;
  role?: OsRole;
  userId?: string;
  projectId?: string;
  workOrders?: WorkOrder[];
  onChanged?: () => void;
};

export function ScheduleDayDetail({
  date,
  events,
  onBack,
  onEventPress,
  onCreateWork,
  readOnly,
  canCreateWork = true,
  addTaskLabel = 'Добавить задачу',
  role = 'customer',
  userId,
  projectId,
  workOrders = [],
  onChanged,
}: Props) {
  const { user, activeProject } = useRenova();
  const label = new Date(date + 'T12:00:00').toLocaleDateString('ru', { weekday: 'long', day: 'numeric', month: 'long' });
  const tasks = dayTaskCount(events);
  const woById = new Map(workOrders.map((w) => [w.id, w]));

  const extendWork = async (wo: WorkOrder, days: number, note: string) => {
    if (!userId || !projectId || readOnly) return;
    const base = wo.planned_end || wo.planned_start || date;
    const nextEnd = addDays(base, days);
    try {
      await api.patchWorkOrder(userId, projectId, wo.id, { planned_end: nextEnd, notes: note });
      await syncProjectSideEffects({ user: user ?? ({ id: userId } as any), project: activeProject ?? ({ id: projectId } as any), role });
      onChanged?.();
      Alert.alert('Срок обновлён', `Новый дедлайн: ${nextEnd}`);
    } catch {
      Alert.alert('Ошибка', 'Не удалось продлить срок');
    }
  };

  const transitionWork = async (wo: WorkOrder, next: WorkOrderStatus) => {
    if (!userId || !projectId || readOnly) return;
    try {
      await api.transitionWorkOrder(userId, projectId, wo.id, next);
      await syncProjectSideEffects({ user: user ?? ({ id: userId } as any), project: activeProject ?? ({ id: projectId } as any), role });
      onChanged?.();
    } catch {
      Alert.alert('Ошибка', 'Не удалось обновить статус');
    }
  };

  const renderWorkActions = (e: CalendarEvent) => {
    if (!e.work_order_id || readOnly || !userId || !projectId) return null;
    const wo = woById.get(e.work_order_id);
    if (!wo || isWorkArchived(wo.status)) return null;
    const status = wo.status as WorkOrderStatus;
    const actions = workActions(status, role === 'contractor' ? 'contractor' : 'customer');
    const primary = actions.find((a) => a.next === 'done' || a.next === 'review' || a.next === 'in_progress') || actions[0];

    return (
      <View style={s.actions}>
        {primary ? (
          <Pressable style={s.actionBtn} onPress={() => transitionWork(wo, primary.next)}>
            <Text style={s.actionBtnT}>{primary.label}</Text>
          </Pressable>
        ) : null}
        {role === 'customer' ? (
          <Pressable style={s.actionBtnOutline} onPress={() => extendWork(wo, 3, 'Продление срока заказчиком')}>
            <Text style={s.actionBtnOutlineT}>Продлить +3 дня</Text>
          </Pressable>
        ) : (
          <Pressable
            style={s.actionBtnOutline}
            onPress={() => extendWork(wo, 7, 'Запрос продления от исполнителя')}
          >
            <Text style={s.actionBtnOutlineT}>Запросить +7 дней</Text>
          </Pressable>
        )}
      </View>
    );
  };

  return (
    <View style={s.wrap}>
      <View style={s.head}>
        <Pressable onPress={onBack} style={s.back} accessibilityRole="button" accessibilityLabel="Назад к календарю">
          <Ionicons name="chevron-back" size={20} color={RenovaTheme.colors.accent} />
          <Text style={s.backT}>Календарь</Text>
        </Pressable>
        <Text style={s.title}>{label}</Text>
        {tasks > 0 ? <Text style={s.sub}>{tasks} {tasks === 1 ? 'задача' : tasks < 5 ? 'задачи' : 'задач'} на этот день</Text> : null}
      </View>
      <ScrollView style={s.list} contentContainerStyle={{ paddingBottom: 8 }}>
        {!events.length ? (
          <View style={s.empty}>
            <Text style={s.emptyT}>На этот день ничего не запланировано</Text>
            {!readOnly && canCreateWork && onCreateWork && (
              <PrimaryButton title={addTaskLabel} compact onPress={onCreateWork} />
            )}
          </View>
        ) : (
          events.map((e) => {
            const statusLabel = eventStatusLabel(e.status);
            const showInline = isWorkCalendarEvent(e.kind);
            return (
              <View key={e.id} style={s.eventWrap}>
                <Pressable style={s.event} onPress={() => onEventPress(e)}>
                  <Text style={s.kind}>{KIND[e.kind] || e.kind}</Text>
                  <Text style={s.eventT} numberOfLines={2}>{e.title}</Text>
                  {isPeriodCalendarEvent(e.kind) ? (
                    <Text style={s.period}>{formatCalendarEventDates(e)}</Text>
                  ) : null}
                  {statusLabel ? <Text style={s.status}>{statusLabel}</Text> : null}
                </Pressable>
                {showInline ? renderWorkActions(e) : null}
              </View>
            );
          })
        )}
        {!readOnly && canCreateWork && onCreateWork && events.length > 0 ? (
          <PrimaryButton title="Ещё задачу на этот день" variant="outline" compact onPress={onCreateWork} />
        ) : null}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, minHeight: 0 },
  head: { marginBottom: 8 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 2, marginBottom: 4 },
  backT: { color: RenovaTheme.colors.accent, fontWeight: '600', fontSize: 13 },
  title: { fontSize: 15, fontWeight: '800', color: RenovaTheme.colors.text, textTransform: 'capitalize' },
  sub: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginTop: 2 },
  list: { flex: 1 },
  empty: { ...card, alignItems: 'center', paddingVertical: 16 },
  emptyT: { color: RenovaTheme.colors.textMuted, marginBottom: 10, fontSize: 13 },
  eventWrap: { marginBottom: 6 },
  event: { ...card, paddingVertical: 10 },
  kind: { fontSize: 10, fontWeight: '700', color: RenovaTheme.colors.accent, textTransform: 'uppercase' },
  eventT: { fontWeight: '600', fontSize: 14, marginTop: 2 },
  period: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginTop: 2 },
  status: { fontSize: 11, color: RenovaTheme.colors.textMuted, marginTop: 2 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6, paddingHorizontal: 4 },
  actionBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: RenovaTheme.colors.primary,
  },
  actionBtnT: { color: RenovaTheme.colors.surface, fontSize: 12, fontWeight: '700' },
  actionBtnOutline: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
    backgroundColor: RenovaTheme.colors.surface,
  },
  actionBtnOutlineT: { color: RenovaTheme.colors.text, fontSize: 12, fontWeight: '600' },
});
