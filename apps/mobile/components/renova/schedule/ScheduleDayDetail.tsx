/** Детализация выбранного дня — события и быстрые действия */
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { RenovaTheme, card } from '@/constants/Theme';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { STAGE_STATUS_LABEL } from '@/constants/labels';
import { WORK_STATUS_LABEL } from '@/lib/domain/workLifecycle';
import { dayTaskCount, formatCalendarEventDates, isPeriodCalendarEvent } from '@/lib/domain/calendarEvents';
import type { CalendarEvent } from '@/lib/api';

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

type Props = {
  date: string;
  events: CalendarEvent[];
  onBack: () => void;
  onEventPress: (e: CalendarEvent) => void;
  onCreateWork?: () => void;
  readOnly?: boolean;
  canCreateWork?: boolean;
  addTaskLabel?: string;
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
}: Props) {
  const label = new Date(date + 'T12:00:00').toLocaleDateString('ru', { weekday: 'long', day: 'numeric', month: 'long' });
  const tasks = dayTaskCount(events);

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
            return (
            <Pressable key={e.id} style={s.event} onPress={() => onEventPress(e)}>
              <Text style={s.kind}>{KIND[e.kind] || e.kind}</Text>
              <Text style={s.eventT} numberOfLines={2}>{e.title}</Text>
              {isPeriodCalendarEvent(e.kind) ? (
                <Text style={s.period}>{formatCalendarEventDates(e)}</Text>
              ) : null}
              {statusLabel ? <Text style={s.status}>{statusLabel}</Text> : null}
            </Pressable>
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
  event: { ...card, marginBottom: 6, paddingVertical: 10 },
  kind: { fontSize: 10, fontWeight: '700', color: RenovaTheme.colors.accent, textTransform: 'uppercase' },
  eventT: { fontWeight: '600', fontSize: 14, marginTop: 2 },
  period: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginTop: 2 },
  status: { fontSize: 11, color: RenovaTheme.colors.textMuted, marginTop: 2 },
});
