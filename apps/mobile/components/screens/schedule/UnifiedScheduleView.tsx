/** Единый календарь: компактный календарь + план работ */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, View, Text, StyleSheet, Pressable, useWindowDimensions } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { RenovaTheme } from '@/constants/Theme';
import { CreateWorkSheet } from '@/components/renova/CreateWorkSheet';
import { WorkOrderCard } from '@/components/renova/WorkOrderCard';
import { ReadOnlyBanner } from '@/components/renova/ReadOnlyGuard';
import { ProjectEmptyState } from '@/components/renova/ProjectEmptyState';
import { ScheduleCalendar, type CalendarViewMode } from '@/components/renova/schedule/ScheduleCalendar';
import { ScheduleDayDetail } from '@/components/renova/schedule/ScheduleDayDetail';
import { ScheduleIconToolbar } from '@/components/renova/schedule/ScheduleIconToolbar';
import { ScheduleFilterChips } from '@/components/renova/schedule/ScheduleFilterChips';
import { useRenova } from '@/lib/context/RenovaContext';
import { useNavFromHere } from '@/lib/navigation';
import { api, CalendarData, CalendarEvent, WorkOrder, Purchase } from '@/lib/api';
import { isWorkArchived } from '@/lib/domain/workArchive';
import { buildDayMarks } from '@/lib/domain/scheduleMarks';
import { calendarEventInRange, calendarEventOnDate, formatCalendarEventDates, filterCalendarEventsForRole, isStageCalendarEvent, isWorkCalendarEvent, sortDayCalendarEvents } from '@/lib/domain/calendarEvents';
import { repairTabRoute, budgetTabRoute, type OsRole } from '@/constants/osSections';
import { pushOsNav, replaceOsNav } from '@/lib/pushOsNav';
import { formatScheduleRange } from '@/lib/formatScheduleDate';
import { buildScheduleExecutionStats } from '@/lib/domain/scheduleExecutionStats';
import { ScheduleExecutionStrip } from '@/components/renova/schedule/ScheduleExecutionStrip';

const KIND: Record<string, string> = {
  stage_period: 'Этап',
  stage_start: 'Этап',
  stage_end: 'Этап',
  work_period: 'Задача',
  contractor_ready: 'Готово',
  customer_accepted: 'Принято',
  payment: 'Оплата',
  work_start: 'Задача',
  work_due: 'Срок',
  work_done: 'Выполнено',
  material: 'Поставка',
};

const EVENT_FILTERS = [
  { key: 'all', label: 'Все' },
  { key: 'week', label: '7 дней' },
  { key: 'works', label: 'Работы' },
  { key: 'stages', label: 'Этапы' },
  { key: 'overdue', label: 'Просрочка' },
  { key: 'materials', label: 'Поставки' },
];

export function UnifiedScheduleView({ role }: { role: OsRole }) {
  const nav = useNavFromHere();
  const { date: dateParam } = useLocalSearchParams<{ date?: string }>();
  const { height } = useWindowDimensions();
  const calendarMaxH = Math.round(height * 0.59);
  const { user, activeProject, readOnly } = useRenova();
  const [cal, setCal] = useState<CalendarData | null>(null);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [filter, setFilter] = useState('all');
  const [workFilter, setWorkFilter] = useState<'active' | 'archive'>('active');
  const [showCreate, setShowCreate] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [dayDetailOpen, setDayDetailOpen] = useState(false);
  const [viewMode, setViewMode] = useState<CalendarViewMode>('month');
  const [cursor, setCursor] = useState(() => new Date());

  const reload = useCallback(() => {
    if (!user || !activeProject) return;
    api.getCalendar(user.id, activeProject.id).then(setCal).catch(() => setCal(null));
    api.listWorkOrders(user.id, activeProject.id).then(setWorkOrders).catch(() => setWorkOrders([]));
    api.listPurchases(user.id, activeProject.id).then(setPurchases).catch(() => setPurchases([]));
  }, [user?.id, activeProject?.id]);

  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    const raw = typeof dateParam === 'string' ? dateParam : Array.isArray(dateParam) ? dateParam[0] : null;
    if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return;
    setSelectedDate(raw);
    setCursor(new Date(`${raw}T12:00:00`));
    setDayDetailOpen(true);
  }, [dateParam]);

  const today = new Date().toISOString().slice(0, 10);
  const weekEnd = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const inWeek = (e: CalendarEvent) => calendarEventInRange(e, today, weekEnd);
  const canManageWorks = role === 'contractor' && !readOnly;
  const canAddTask = !readOnly;

  const supplyEvents = useMemo(() => {
    const out: (CalendarEvent & { purchase_id?: string })[] = [];
    for (const p of purchases) {
      if (p.ordered_at) {
        out.push({ id: `po-${p.id}`, kind: 'material', title: `Заказ · ${p.supplier_name || 'закупка'}`, date: p.ordered_at.slice(0, 10), purchase_id: p.id });
      }
      if (p.delivered_at) {
        out.push({ id: `pd-${p.id}`, kind: 'material', title: `Доставка · ${p.supplier_name || 'закупка'}`, date: p.delivered_at.slice(0, 10), purchase_id: p.id });
      }
    }
    return out;
  }, [purchases]);

  const allEvents = useMemo(
    () => filterCalendarEventsForRole([...(cal?.events || []), ...supplyEvents], role),
    [cal, supplyEvents, role],
  );
  const marksByDate = useMemo(() => buildDayMarks(allEvents, today), [allEvents, today]);

  const events = useMemo(() => {
    return allEvents.filter((e) => {
      if (filter === 'all') return true;
      if (filter === 'materials') return e.kind === 'material';
      if (filter === 'works') return isWorkCalendarEvent(e.kind);
      if (filter === 'stages') return isStageCalendarEvent(e.kind);
      if (filter === 'week') return inWeek(e);
      if (filter === 'overdue') {
        if (e.work_order_id) {
          const wo = workOrders.find((w) => w.id === e.work_order_id);
          return wo?.planned_end && wo.planned_end < today && !isWorkArchived(wo.status);
        }
        const st = cal?.stages.find((s) => s.id === e.stage_id);
        return st?.planned_end && st.planned_end < today && st.status !== 'done';
      }
      return true;
    });
  }, [allEvents, filter, today, cal, workOrders]);

  const dayEvents = useMemo(() => {
    if (!selectedDate) return [];
    return sortDayCalendarEvents(allEvents.filter((e) => calendarEventOnDate(e, selectedDate)));
  }, [allEvents, selectedDate]);

  const filteredWorks = useMemo(() => {
    const sorted = [...workOrders].sort((a, b) => (a.planned_start || '').localeCompare(b.planned_start || ''));
    return sorted.filter((w) => (workFilter === 'archive' ? isWorkArchived(w.status) : !isWorkArchived(w.status)));
  }, [workOrders, workFilter]);

  const upcomingWorks = useMemo(() => filteredWorks.slice(0, 5), [filteredWorks]);
  const executionStats = useMemo(
    () => buildScheduleExecutionStats(workOrders, today),
    [workOrders, today],
  );

  const openEvent = useCallback((e: CalendarEvent & { purchase_id?: string }) => {
    if (e.purchase_id) {
      nav.purchase(e.purchase_id);
    } else if (e.work_order_id) {
      nav.workOrder(e.work_order_id);
    } else if (e.stage_id) {
      nav.stage(e.stage_id);
    } else if (e.kind === 'payment') {
      pushOsNav(budgetTabRoute(role, 'payments'), nav.from);
    }
  }, [nav, role]);

  const onSelectDate = (iso: string) => {
    setSelectedDate(iso);
    setDayDetailOpen(true);
  };

  if (!user || !activeProject) {
    return <ProjectEmptyState role={role} hint="Выберите объект, чтобы открыть календарь." />;
  }
  if (!cal) {
    return <View style={s.center}><Text>Загрузка календаря…</Text></View>;
  }

  return (
    <View style={s.root}>
      <ReadOnlyBanner />
      <View style={[s.calendarPane, { maxHeight: calendarMaxH }]}>
        {dayDetailOpen && selectedDate ? (
          <View style={{ flex: 1, paddingHorizontal: 12, paddingTop: 8 }}>
            <ScheduleDayDetail
            date={selectedDate}
            events={dayEvents}
            onBack={() => setDayDetailOpen(false)}
            onEventPress={openEvent}
            onCreateWork={() => { setDayDetailOpen(false); setShowCreate(true); }}
            readOnly={readOnly}
            canCreateWork={canAddTask}
            addTaskLabel={role === 'customer' ? 'Добавить задачу' : 'Назначить работу'}
            role={role}
            userId={user.id}
            projectId={activeProject.id}
            workOrders={workOrders}
            onChanged={reload}
            />
          </View>
        ) : (
          <ScheduleCalendar
            marksByDate={marksByDate}
            selectedDate={selectedDate}
            onSelectDate={onSelectDate}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            cursor={cursor}
            onCursorChange={setCursor}
            maxHeightRatio={0.59}
          />
        )}
      </View>

      <ScrollView style={s.planPane} contentContainerStyle={s.planContent}>
        <Text style={s.planTitle}>Расписание и задачи</Text>
        <Text style={s.planSub}>{formatScheduleRange(cal.planned_start, cal.planned_end)}</Text>
        <ScheduleExecutionStrip stats={executionStats} />

        <ScheduleIconToolbar
          readOnly={readOnly}
          canManageWorks={canManageWorks}
          canAddTask={canAddTask}
          userId={user.id}
          projectId={activeProject.id}
          onCreateWork={() => setShowCreate(true)}
          onStages={() => replaceOsNav(repairTabRoute(role, 'works'), nav.from)}
          onMaterials={() => replaceOsNav(repairTabRoute(role, 'materials'), nav.from)}
          onImported={reload}
        />

        <View style={s.sectionHead}>
          <Text style={s.sectionTitle}>{role === 'customer' ? 'Задачи на день' : 'Работы'}</Text>
          <ScheduleFilterChips
            items={[
              { key: 'active', label: 'Активные' },
              { key: 'archive', label: 'Архив' },
            ]}
            value={workFilter}
            onChange={(k) => setWorkFilter(k as 'active' | 'archive')}
          />
        </View>
        {!upcomingWorks.length ? (
          <View style={s.emptyBox}>
            <Text style={s.emptyT}>
              {workFilter === 'archive'
                ? 'В архиве пока пусто'
                : canAddTask
                  ? 'Нет задач — добавьте через «+» или иконку календаря'
                  : 'Задач на этот период пока нет'}
            </Text>
          </View>
        ) : (
          upcomingWorks.map((wo) => (
            <WorkOrderCard key={wo.id} wo={wo} rooms={activeProject.rooms} compact />
          ))
        )}
        {filteredWorks.length > 5 && (
          <Pressable onPress={() => replaceOsNav(repairTabRoute(role, 'works'), nav.from)}>
            <Text style={s.link}>Все работы ({filteredWorks.length}) →</Text>
          </Pressable>
        )}

        <View style={[s.sectionHead, { marginTop: 14 }]}>
          <Text style={s.sectionTitle}>События</Text>
          <ScheduleFilterChips items={EVENT_FILTERS} value={filter} onChange={setFilter} />
        </View>
        {!events.length ? (
          <Text style={s.emptyT}>Нет событий по выбранному фильтру</Text>
        ) : (
          events.slice(0, 20).map((e) => (
            <Pressable key={e.id} style={s.event} onPress={() => openEvent(e)}>
              <Text style={s.eventDate} numberOfLines={1}>{formatCalendarEventDates(e)}</Text>
              <View style={s.eventBody}>
                <Text style={s.eventKind}>{KIND[e.kind] || e.kind}</Text>
                <Text style={s.eventTitle} numberOfLines={2}>{e.title}</Text>
              </View>
            </Pressable>
          ))
        )}
        {events.length > 20 && (
          <Text style={s.moreEvents}>Показано 20 из {events.length} — уточните фильтр</Text>
        )}
      </ScrollView>

      {canAddTask ? (
        <CreateWorkSheet
          visible={showCreate}
          onClose={() => setShowCreate(false)}
          userId={user.id}
          projectId={activeProject.id}
          rooms={activeProject.rooms || []}
          defaultDate={selectedDate || undefined}
          variant={role === 'customer' ? 'customer' : 'contractor'}
          onCreated={() => { reload(); setShowCreate(false); }}
        />
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: RenovaTheme.colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  calendarPane: { flexShrink: 0, minHeight: 200, paddingBottom: 4 },
  planPane: { flex: 1, minHeight: 0 },
  planContent: { padding: 16, paddingBottom: 32 },
  planTitle: { fontSize: 17, fontWeight: '800', color: RenovaTheme.colors.text },
  planSub: { fontSize: 13, color: RenovaTheme.colors.textMuted, marginTop: 2, marginBottom: 10 },
  sectionHead: { marginBottom: 8 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: RenovaTheme.colors.text, marginBottom: 6 },
  emptyBox: { backgroundColor: RenovaTheme.colors.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: RenovaTheme.colors.border, marginBottom: 8 },
  emptyT: { fontSize: 13, color: RenovaTheme.colors.textMuted, lineHeight: 18 },
  link: { fontSize: 12, fontWeight: '600', color: RenovaTheme.colors.accent, marginVertical: 8 },
  event: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: RenovaTheme.colors.surface,
    padding: 10,
    borderRadius: 10,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
  },
  eventDate: {
    fontSize: 12,
    fontWeight: '700',
    color: RenovaTheme.colors.text,
    minWidth: 88,
    flexShrink: 0,
    textAlign: 'right',
  },
  eventBody: { flex: 1, minWidth: 0 },
  eventKind: { fontSize: 10, fontWeight: '700', color: RenovaTheme.colors.accent },
  eventTitle: { fontSize: 13, fontWeight: '600', marginTop: 2, color: RenovaTheme.colors.text },
  moreEvents: { fontSize: 11, color: RenovaTheme.colors.textMuted, marginTop: 4, textAlign: 'center' },
});
