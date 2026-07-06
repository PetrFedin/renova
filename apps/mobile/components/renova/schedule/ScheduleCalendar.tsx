/** Интерактивный календарь: месяц / неделя, кликабельные дни с событиями */
import { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { RenovaTheme } from '@/constants/Theme';
import { addDays, isoDate, startOfWeek, type DayMark } from '@/lib/domain/scheduleMarks';

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

export type CalendarViewMode = 'month' | 'week';

type Props = {
  marksByDate: Record<string, DayMark>;
  selectedDate: string | null;
  onSelectDate: (iso: string) => void;
  viewMode: CalendarViewMode;
  onViewModeChange: (mode: CalendarViewMode) => void;
  cursor: Date;
  onCursorChange: (d: Date) => void;
  maxHeightRatio?: number;
};

function DayDots({ mark }: { mark?: DayMark }) {
  if (!mark?.count) return null;
  return (
    <View style={s.dots}>
      {mark.hasWork && <View style={[s.dot, { backgroundColor: '#2563eb' }]} />}
      {mark.hasStage && <View style={[s.dot, { backgroundColor: '#16a34a' }]} />}
      {mark.hasMaterial && <View style={[s.dot, { backgroundColor: '#d97706' }]} />}
      {mark.overdue && <View style={[s.dot, { backgroundColor: '#dc2626' }]} />}
    </View>
  );
}

export function ScheduleCalendar({
  marksByDate,
  selectedDate,
  onSelectDate,
  viewMode,
  onViewModeChange,
  cursor,
  onCursorChange,
  maxHeightRatio = 0.59,
}: Props) {
  const { height } = useWindowDimensions();
  const maxH = Math.round(height * maxHeightRatio);
  const today = isoDate(new Date());

  const title = useMemo(() => {
    if (viewMode === 'week') {
      const ws = startOfWeek(cursor);
      const we = addDays(ws, 6);
      const sameMonth = ws.getMonth() === we.getMonth();
      const a = ws.toLocaleDateString('ru', { day: 'numeric', month: sameMonth ? 'long' : 'short' });
      const b = we.toLocaleDateString('ru', { day: 'numeric', month: 'long', year: 'numeric' });
      return `${a} – ${b}`;
    }
    return cursor.toLocaleDateString('ru', { month: 'long', year: 'numeric' });
  }, [cursor, viewMode]);

  const cells = useMemo(() => {
    if (viewMode === 'week') {
      const ws = startOfWeek(cursor);
      return Array.from({ length: 7 }, (_, i) => {
        const d = addDays(ws, i);
        return { iso: isoDate(d), day: d.getDate(), inMonth: true };
      });
    }
    const y = cursor.getFullYear();
    const m = cursor.getMonth();
    const first = new Date(y, m, 1).getDay() || 7;
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const out: { iso: string; day: number | null; inMonth: boolean }[] = [];
    for (let i = 1; i < first; i++) out.push({ iso: `pad-${i}`, day: null, inMonth: false });
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      out.push({ iso, day: d, inMonth: true });
    }
    while (out.length % 7 !== 0) out.push({ iso: `pad-t-${out.length}`, day: null, inMonth: false });
    return out;
  }, [cursor, viewMode]);

  const shift = (delta: number) => {
    const d = new Date(cursor);
    if (viewMode === 'week') d.setDate(d.getDate() + delta * 7);
    else d.setMonth(d.getMonth() + delta);
    onCursorChange(d);
  };

  return (
    <View style={[s.box, { maxHeight: maxH }]}>
      <View style={s.toolbar}>
        <Pressable onPress={() => shift(-1)} style={s.navBtn} accessibilityLabel="Назад">
          <Ionicons name="chevron-back" size={18} color={RenovaTheme.colors.text} />
        </Pressable>
        <Text style={s.head}>{title}</Text>
        <Pressable onPress={() => shift(1)} style={s.navBtn} accessibilityLabel="Вперёд">
          <Ionicons name="chevron-forward" size={18} color={RenovaTheme.colors.text} />
        </Pressable>
      </View>

      <View style={s.modeRow}>
        {(['month', 'week'] as CalendarViewMode[]).map((m) => (
          <Pressable key={m} style={[s.modeBtn, viewMode === m && s.modeOn]} onPress={() => onViewModeChange(m)}>
            <Text style={[s.modeT, viewMode === m && s.modeTOn]}>{m === 'month' ? 'Месяц' : 'Неделя'}</Text>
          </Pressable>
        ))}
        <Pressable style={s.todayBtn} onPress={() => { onCursorChange(new Date()); onSelectDate(today); }}>
          <Text style={s.todayT}>Сегодня</Text>
        </Pressable>
      </View>

      <View style={s.weekHead}>
        {WEEKDAYS.map((w) => (
          <Text key={w} style={s.weekDay}>{w}</Text>
        ))}
      </View>

      <View style={[s.grid, viewMode === 'week' && s.gridWeek]}>
        {cells.map((c) => {
          if (c.day == null) {
            return <View key={c.iso} style={s.cell} />;
          }
          const mark = marksByDate[c.iso];
          const selected = selectedDate === c.iso;
          const isToday = c.iso === today;
          const hasEvents = !!mark?.count;
          return (
            <Pressable
              key={c.iso + c.day}
              style={[
                s.cell,
                !c.inMonth && viewMode === 'month' && s.cellOut,
                selected && s.cellSelected,
                isToday && s.cellToday,
                hasEvents && s.cellMarked,
              ]}
              onPress={() => onSelectDate(c.iso)}
              accessibilityRole="button"
              accessibilityLabel={`${c.day}${hasEvents ? ', есть события' : ''}`}
            >
              <Text style={[s.dayN, selected && s.daySel]}>{c.day}</Text>
              <DayDots mark={mark} />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  box: {
    backgroundColor: RenovaTheme.colors.surface,
    borderRadius: RenovaTheme.radius.lg,
    padding: 10,
    marginHorizontal: 12,
    marginTop: 8,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
  },
  toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  navBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  head: { fontWeight: '800', fontSize: 14, textTransform: 'capitalize', flex: 1, textAlign: 'center' },
  modeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  modeBtn: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: RenovaTheme.colors.borderLight },
  modeOn: { backgroundColor: RenovaTheme.colors.infoBg, borderWidth: 1, borderColor: RenovaTheme.colors.accent },
  modeT: { fontSize: 11, fontWeight: '600', color: RenovaTheme.colors.textMuted },
  modeTOn: { color: RenovaTheme.colors.accent },
  todayBtn: { marginLeft: 'auto', paddingHorizontal: 8, paddingVertical: 4 },
  todayT: { fontSize: 11, fontWeight: '600', color: RenovaTheme.colors.accent },
  weekHead: { flexDirection: 'row', marginBottom: 2 },
  weekDay: { width: '14.28%', textAlign: 'center', fontSize: 10, fontWeight: '700', color: RenovaTheme.colors.textMuted },
  grid: { flexDirection: 'row', flexWrap: 'wrap', flexGrow: 1 },
  gridWeek: { minHeight: 72 },
  cell: {
    width: '14.28%',
    aspectRatio: 1,
    maxHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    paddingVertical: 2,
  },
  cellOut: { opacity: 0.35 },
  cellSelected: { backgroundColor: RenovaTheme.colors.accent },
  cellToday: { borderWidth: 1, borderColor: RenovaTheme.colors.accent },
  cellMarked: { backgroundColor: RenovaTheme.colors.infoBg },
  dayN: { fontSize: 12, fontWeight: '600', color: RenovaTheme.colors.text },
  dayOut: { color: RenovaTheme.colors.textSubtle },
  daySel: { color: RenovaTheme.colors.surface },
  dots: { flexDirection: 'row', gap: 2, marginTop: 2, height: 4 },
  dot: { width: 4, height: 4, borderRadius: 2 },
});
