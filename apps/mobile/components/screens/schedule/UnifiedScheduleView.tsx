/** W71: канонический hub сроков (календарь + work-schedule + confirm/reject).
 * Единый календарь: компактный календарь + план работ.
 * Data honesty: независимые load states — ошибка API ≠ пустой план/список. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, View, Text, StyleSheet, Pressable, useWindowDimensions } from 'react-native';
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
import { InlineLoadError } from '@/components/ui/InlineLoadError';
import { StaleDataBanner } from '@/components/ui/StaleDataBanner';
import { useRenova } from '@/lib/context/RenovaContext';
import { useNavFromHere } from '@/lib/navigation';
import { api, CalendarData, CalendarEvent, WorkOrder, Purchase, type WorkSchedule } from '@/lib/api';
import { isWorkArchived } from '@/lib/domain/workArchive';
import { buildDayMarks } from '@/lib/domain/scheduleMarks';
import { calendarEventInRange, calendarEventOnDate, formatCalendarEventDates, filterCalendarEventsForRole, isStageCalendarEvent, isWorkCalendarEvent, sortDayCalendarEvents } from '@/lib/domain/calendarEvents';
import { repairTabRoute, budgetTabRoute, type OsRole } from '@/constants/osSections';
import { pushOsNav, replaceOsNav } from '@/lib/pushOsNav';
import { formatScheduleRange } from '@/lib/formatScheduleDate';
import { buildScheduleExecutionStats } from '@/lib/domain/scheduleExecutionStats';
import { ScheduleExecutionStrip } from '@/components/renova/schedule/ScheduleExecutionStrip';
import { SchedulePlanItems } from '@/components/renova/schedule/SchedulePlanItems';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import { useProjectDataReload } from '@/lib/useProjectDataReload';
import { hasLoadedData, isInitialPending, useAsyncResource } from '@/lib/asyncResource';
import { isOfflineQueued, notifyOfflineQueued } from '@/lib/offlineUi';
import {
  alertScheduleConfirmed,
  alertScheduleRejected,
  alertScheduleSubmitted,
} from '@/lib/scheduleCloseoutNav';

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
  const { user, activeProject, teamRole, readOnly } = useRenova();

  /** W81/W82: после submit/confirm/reject графика — inbox + home nextAction */
  const syncScheduleSideEffects = useCallback(async () => {
    await syncProjectSideEffects({ user, project: activeProject, role });
  }, [user, activeProject, role]);

  const canManageSchedulePlan =
    !readOnly &&
    (user?.role === 'customer' || !teamRole || teamRole === 'owner' || teamRole === 'foreman');

  const projectId = activeProject?.id;
  const userId = user?.id;
  const enabled = Boolean(userId && projectId);

  const calFetch = useCallback(
    () => api.getCalendar(userId!, projectId!),
    [userId, projectId],
  );
  const worksFetch = useCallback(
    () => api.listWorkOrders(userId!, projectId!),
    [userId, projectId],
  );
  const purchasesFetch = useCallback(
    () => api.listPurchases(userId!, projectId!),
    [userId, projectId],
  );
  const scheduleFetch = useCallback(
    () => api.getActiveWorkSchedule(userId!, projectId!),
    [userId, projectId],
  );

  const { resource: calRes, reload: reloadCal } = useAsyncResource<CalendarData>(calFetch, {
    scope: 'components.screens.schedule.UnifiedSched.Cal',
    projectId,
    enabled,
  });
  const { resource: worksRes, reload: reloadWorks } = useAsyncResource<WorkOrder[]>(worksFetch, {
    scope: 'components.screens.schedule.UnifiedSched.WorkOrders',
    projectId,
    enabled,
  });
  const { resource: purchasesRes, reload: reloadPurchases } = useAsyncResource<Purchase[]>(purchasesFetch, {
    scope: 'components.screens.schedule.UnifiedSched.Purchases',
    projectId,
    enabled,
  });
  const { resource: scheduleRes, reload: reloadSchedule } = useAsyncResource<WorkSchedule | null>(scheduleFetch, {
    scope: 'components.screens.schedule.UnifiedSched.Schedule',
    projectId,
    enabled,
  });

  const cal = calRes.data;
  const workOrders = worksRes.data ?? [];
  const purchases = purchasesRes.data ?? [];
  /** Только после success: null = плана нет; undefined = ещё не знаем / ошибка без данных */
  const schedule = hasLoadedData(scheduleRes) ? scheduleRes.data : undefined;

  const [filter, setFilter] = useState('all');
  const [workFilter, setWorkFilter] = useState<'active' | 'archive'>('active');
  const [showCreate, setShowCreate] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [dayDetailOpen, setDayDetailOpen] = useState(false);
  const [viewMode, setViewMode] = useState<CalendarViewMode>('month');
  const [cursor, setCursor] = useState(() => new Date());
  const [planBusy, setPlanBusy] = useState(false);
  /** Локальный override после create/submit (пока refresh не догнал) */
  const [scheduleOverride, setScheduleOverride] = useState<WorkSchedule | null | undefined>(undefined);

  const effectiveSchedule = scheduleOverride !== undefined ? scheduleOverride : schedule;

  const reload = useCallback(() => {
    reloadCal();
    reloadWorks();
    reloadPurchases();
    reloadSchedule();
    setScheduleOverride(undefined);
  }, [reloadCal, reloadWorks, reloadPurchases, reloadSchedule]);
  useProjectDataReload(reload);

  useEffect(() => {
    setScheduleOverride(undefined);
  }, [projectId]);

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
    return <ProjectEmptyState role={role} />;
  }

  // Первичная ошибка календаря — полноценный error, не вечная «Загрузка…»
  if (!hasLoadedData(calRes) && calRes.status === 'error') {
    return (
      <View style={s.center}>
        <InlineLoadError
          title="Календарь недоступен"
          message={calRes.error || 'Не удалось загрузить календарь'}
          onRetry={reloadCal}
          accessibilityRetryLabel="Повторить загрузку календаря"
        />
      </View>
    );
  }

  if (!hasLoadedData(calRes) && isInitialPending(calRes.status)) {
    return (
      <View style={s.center}>
        <ActivityIndicator color={RenovaTheme.colors.accent} />
        <Text style={s.loadingT}>Загрузка календаря…</Text>
      </View>
    );
  }

  if (!cal) {
    return (
      <View style={s.center}>
        <InlineLoadError
          title="Календарь недоступен"
          message="Нет данных календаря"
          onRetry={reloadCal}
          accessibilityRetryLabel="Повторить загрузку календаря"
        />
      </View>
    );
  }

  const planStatusText = (() => {
    if (scheduleRes.status === 'error' && !hasLoadedData(scheduleRes)) {
      return null; // покажем InlineLoadError ниже
    }
    if (isInitialPending(scheduleRes.status) && !hasLoadedData(scheduleRes)) {
      return 'Загрузка плана-графика…';
    }
    if (hasLoadedData(scheduleRes) || scheduleOverride !== undefined) {
      const sched = effectiveSchedule;
      return sched
        ? `Статус: ${sched.status}${sched.items?.length ? ` · ${sched.items.length} этапов` : ''}`
        : 'План ещё не создан';
    }
    return 'Загрузка плана-графика…';
  })();

  return (
    <View style={s.root}>
      <ReadOnlyBanner />
      {calRes.stale ? (
        <View style={s.bannerPad}>
          <StaleDataBanner
            message="Календарь: показаны ранее загруженные данные."
            onRetry={reloadCal}
            accessibilityRetryLabel="Повторить обновление календаря"
          />
        </View>
      ) : null}
      {purchasesRes.stale ? (
        <View style={s.bannerPad}>
          <StaleDataBanner
            message="Закупки: показаны ранее загруженные данные."
            onRetry={reloadPurchases}
            accessibilityRetryLabel="Повторить обновление закупок"
          />
        </View>
      ) : null}
      {worksRes.stale ? (
        <View style={s.bannerPad}>
          <StaleDataBanner
            message="Работы: показаны ранее загруженные данные."
            onRetry={reloadWorks}
            accessibilityRetryLabel="Повторить обновление работ"
          />
        </View>
      ) : null}
      {scheduleRes.stale ? (
        <View style={s.bannerPad}>
          <StaleDataBanner
            message="План-график: показаны ранее загруженные данные."
            onRetry={reloadSchedule}
            accessibilityRetryLabel="Повторить обновление плана-графика"
          />
        </View>
      ) : null}
      {purchasesRes.status === 'error' && !hasLoadedData(purchasesRes) ? (
        <View style={s.bannerPad}>
          <InlineLoadError
            compact
            title="Закупки не загрузились"
            message={purchasesRes.error || 'Ошибка загрузки закупок'}
            onRetry={reloadPurchases}
            accessibilityRetryLabel="Повторить загрузку закупок"
          />
        </View>
      ) : null}
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
        <View style={s.agreeBox}>
          <Text style={s.agreeTitle}>План-график</Text>
          {scheduleRes.status === 'error' && !hasLoadedData(scheduleRes) ? (
            <InlineLoadError
              compact
              title="План-график недоступен"
              message={scheduleRes.error || 'Не удалось загрузить план'}
              onRetry={reloadSchedule}
              accessibilityRetryLabel="Повторить загрузку плана-графика"
            />
          ) : (
            <Text style={s.planSub}>{planStatusText}</Text>
          )}
          {/* W66 #16: причина отклонения видна обеим ролям */}
          {effectiveSchedule?.status === 'rejected' && effectiveSchedule.rejection_reason ? (
            <Text style={[s.planSub, { color: '#b45309' }]}>
              Причина: {effectiveSchedule.rejection_reason}
            </Text>
          ) : null}
          {!readOnly && role === 'contractor' && hasLoadedData(scheduleRes) && !effectiveSchedule ? (
            <Pressable
              style={s.planCta}
              disabled={planBusy}
              onPress={async () => {
                setPlanBusy(true);
                try {
                  if (!canManageSchedulePlan) {
                    Alert.alert('График', 'Создать план может владелец или прораб бригады');
                    return;
                  }
                  const created = await api.createWorkSchedule(user.id, activeProject.id, { title: 'План-график работ' });
                  setScheduleOverride(created);
                  reloadSchedule();
                } catch (e) {
                  if (isOfflineQueued(e)) {
                    notifyOfflineQueued('Создание графика');
                  } else {
                    Alert.alert('Ошибка', 'Не удалось создать план из этапов');
                  }
                } finally {
                  setPlanBusy(false);
                }
              }}
            >
              <Text style={s.planCtaT}>{planBusy ? 'Создаём…' : 'Создать план-график из этапов'}</Text>
            </Pressable>
          ) : null}
          {!readOnly && role === 'contractor' && effectiveSchedule && (effectiveSchedule.status === 'draft' || effectiveSchedule.status === 'rejected') ? (
            <Pressable
              style={s.planCta}
              disabled={planBusy}
              onPress={async () => {
                setPlanBusy(true);
                try {
                  if (!canManageSchedulePlan) {
                    Alert.alert('График', 'На согласование отправляет владелец или прораб');
                    return;
                  }
                  const next = await api.submitWorkSchedule(user.id, activeProject.id, effectiveSchedule.id);
                  setScheduleOverride(next);
                  reload();
                  await syncScheduleSideEffects();
                  // W132: график → inbox заказчика
                  alertScheduleSubmitted(role);
                } catch (e: unknown) {
                  if (isOfflineQueued(e)) notifyOfflineQueued('Отправка графика');
                  else Alert.alert('Ошибка', e instanceof Error ? e.message : 'Не удалось отправить');
                } finally {
                  setPlanBusy(false);
                }
              }}
            >
              <Text style={s.planCtaT}>{planBusy ? '…' : 'Отправить заказчику на согласование'}</Text>
            </Pressable>
          ) : null}
          {!readOnly && role === 'customer' && effectiveSchedule?.status === 'submitted' ? (
            <View style={s.agreeActions}>
              <Pressable
                style={[s.planCta, s.agreeConfirm]}
                disabled={planBusy}
                onPress={async () => {
                  setPlanBusy(true);
                  try {
                    const next = await api.confirmWorkSchedule(user.id, activeProject.id, effectiveSchedule.id);
                    setScheduleOverride(next);
                    reload();
                    await syncScheduleSideEffects();
                    // W132: согласован → этапы / календарь
                    alertScheduleConfirmed(role);
                  } catch (e: unknown) {
                    if (isOfflineQueued(e)) notifyOfflineQueued('Согласование графика');
                    else Alert.alert('Ошибка', e instanceof Error ? e.message : 'Не удалось согласовать');
                  } finally {
                    setPlanBusy(false);
                  }
                }}
              >
                <Text style={s.planCtaT}>{planBusy ? '…' : 'Согласовать график'}</Text>
              </Pressable>
              <Pressable
                style={s.planCta}
                disabled={planBusy}
                onPress={() => {
                  Alert.prompt?.(
                    'Отклонить график',
                    'Причина (необязательно)',
                    async (reason) => {
                      setPlanBusy(true);
                      try {
                        const next = await api.rejectWorkSchedule(user.id, activeProject.id, effectiveSchedule.id, reason || undefined);
                        setScheduleOverride(next);
                        reload();
                        await syncScheduleSideEffects();
                        alertScheduleRejected(role);
                      } catch (e: unknown) {
                        if (isOfflineQueued(e)) notifyOfflineQueued('Отклонение графика');
                        else Alert.alert('Ошибка', e instanceof Error ? e.message : 'Не удалось отклонить');
                      } finally {
                        setPlanBusy(false);
                      }
                    },
                  ) ?? Alert.alert('Отклонить график?', 'Исполнитель получит уведомление', [
                    { text: 'Отмена', style: 'cancel' },
                    {
                      text: 'Отклонить',
                      style: 'destructive',
                      onPress: async () => {
                        setPlanBusy(true);
                        try {
                          const next = await api.rejectWorkSchedule(user.id, activeProject.id, effectiveSchedule.id, 'Нужна правка сроков');
                          setScheduleOverride(next);
                          reload();
                          await syncScheduleSideEffects();
                          alertScheduleRejected(role);
                        } catch (e: unknown) {
                          if (isOfflineQueued(e)) notifyOfflineQueued('Отклонение графика');
                          else Alert.alert('Ошибка', e instanceof Error ? e.message : 'Не удалось отклонить');
                        } finally {
                          setPlanBusy(false);
                        }
                      },
                    },
                  ]);
                }}
              >
                <Text style={s.planCtaT}>Отклонить</Text>
              </Pressable>
            </View>
          ) : null}
          {role === 'customer' && effectiveSchedule?.status === 'confirmed' ? (
            <Text style={s.planSub}>График согласован — сроки зафиксированы</Text>
          ) : null}
          {effectiveSchedule && (effectiveSchedule.items?.length ?? 0) > 0 ? (
            <SchedulePlanItems
              schedule={effectiveSchedule}
              role={role}
              userId={user.id}
              projectId={activeProject.id}
              canManage={canManageSchedulePlan}
              readOnly={readOnly}
              onChanged={(next) => {
                setScheduleOverride(next);
                void syncScheduleSideEffects();
              }}
            />
          ) : null}
        </View>
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
        {worksRes.status === 'error' && !hasLoadedData(worksRes) ? (
          <InlineLoadError
            compact
            title="Работы не загрузились"
            message={worksRes.error || 'Не удалось загрузить работы'}
            onRetry={reloadWorks}
            accessibilityRetryLabel="Повторить загрузку работ"
          />
        ) : isInitialPending(worksRes.status) && !hasLoadedData(worksRes) ? (
          <Text style={s.emptyT}>Загрузка работ…</Text>
        ) : !upcomingWorks.length ? (
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
  loadingT: { marginTop: 10, fontSize: 14, color: RenovaTheme.colors.textMuted },
  bannerPad: { paddingHorizontal: 12, paddingTop: 8 },
  calendarPane: { flexShrink: 0, minHeight: 200, paddingBottom: 4 },
  planPane: { flex: 1, minHeight: 0 },
  planContent: { padding: 16, paddingBottom: 32 },
  agreeBox: { marginBottom: 10, padding: 12, borderRadius: 12, backgroundColor: RenovaTheme.colors.surface, borderWidth: 1, borderColor: RenovaTheme.colors.border },
  agreeTitle: { fontSize: 15, fontWeight: '800', color: RenovaTheme.colors.text },
  agreeActions: { gap: 8, marginTop: 4 },
  agreeConfirm: { backgroundColor: 'rgba(34,140,80,0.12)' },
  planCta: { marginTop: 8, marginBottom: 4, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, backgroundColor: RenovaTheme.colors.surfaceMuted, borderWidth: 1, borderColor: RenovaTheme.colors.border },
  planCtaT: { fontSize: 14, fontWeight: '600', color: RenovaTheme.colors.accent },
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
