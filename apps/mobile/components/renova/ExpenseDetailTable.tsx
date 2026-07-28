/** Таблица расходов с переключением группировки */
import { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { usePathname } from 'expo-router';
import { RenovaTheme, formatRub } from '@/constants/Theme';
import { screenTypography, listRowStyles, filterChipStyles } from '@/constants/screenTypography';
import {
  buildExpenseDetailRows,
  expensePayerLabel,
  groupExpenseRows,
  type ExpenseGroupMode,
  type ExpenseDetailRow,
} from '@/lib/domain/expenseAnalytics';
import { budgetTabRoute, type OsRole } from '@/constants/osSections';
import { pushOsNav } from '@/lib/pushOsNav';
import type { OsExpense, ReceiptItem, Room, Stage, MaterialPick, Purchase } from '@/lib/api';

const MODES: { id: ExpenseGroupMode; label: string }[] = [
  { id: 'all', label: 'Все' },
  { id: 'day', label: 'По дням' },
  { id: 'category', label: 'Статьи' },
  { id: 'room', label: 'Комнаты' },
  { id: 'stage', label: 'Этапы' },
  { id: 'kind', label: 'Тип' },
];

function RowLine({ row, onPress }: { row: ExpenseDetailRow; onPress?: (row: ExpenseDetailRow) => void }) {
  const date = row.date ? new Date(row.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) : '—';
  const inner = (
    <>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.lineTitle} numberOfLines={1}>{row.title}</Text>
        <Text style={s.lineMeta} numberOfLines={1}>
          {date} · {row.categoryLabel} · {expensePayerLabel(row)}
          {row.roomName ? ` · ${row.roomName}` : ''}
          {row.hasDocument ? ' · 📄' : ''}
        </Text>
      </View>
      <Text style={s.lineAmt}>{formatRub(row.amount)}</Text>
    </>
  );
  if (!onPress) return <View style={s.line}>{inner}</View>;
  return (
    <Pressable style={s.line} onPress={() => onPress(row)}>
      {inner}
    </Pressable>
  );
}

export function ExpenseDetailTable({
  receipts,
  expenses,
  picks = [],
  purchases = [],
  rooms,
  stages,
  compact,
  role = 'customer',
  onRowPress,
}: {
  receipts: ReceiptItem[];
  expenses: OsExpense[];
  picks?: MaterialPick[];
  purchases?: Purchase[];
  rooms: Room[];
  stages: Stage[];
  compact?: boolean;
  role?: OsRole;
  onRowPress?: (row: ExpenseDetailRow) => void;
}) {
  const pathname = usePathname();
  const [mode, setMode] = useState<ExpenseGroupMode>('category');
  const rows = useMemo(
    () => buildExpenseDetailRows(receipts, expenses, picks, rooms, stages, purchases),
    [receipts, expenses, picks, rooms, stages, purchases],
  );
  const groups = useMemo(() => groupExpenseRows(rows, mode), [rows, mode]);
  const total = rows.reduce((a, r) => a + r.amount, 0);

  if (!rows.length) {
    return <Text style={s.empty}>Нет данных о расходах</Text>;
  }

  const limit = compact ? 3 : 8;

  return (
    <View style={s.box}>
      <View style={s.headRow}>
        <Text style={s.head}>Детализация · {formatRub(total)}</Text>
        <Pressable onPress={() => pushOsNav(budgetTabRoute(role, 'deviations'), pathname)}>
          <Text style={s.link}>Вся аналитика</Text>
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.modes}>
        {MODES.map((m) => (
          <Pressable key={m.id} style={[s.mode, mode === m.id && s.modeOn]} onPress={() => setMode(m.id)}>
            <Text style={[s.modeT, mode === m.id && s.modeTOn]}>{m.label}</Text>
          </Pressable>
        ))}
      </ScrollView>
      {groups.slice(0, compact ? 4 : 20).map((g) => (
        <View key={g.key} style={s.group}>
          <View style={s.groupHead}>
            <Text style={s.groupLabel} numberOfLines={1}>{g.label}</Text>
            <Text style={s.groupTotal}>{formatRub(g.total)}</Text>
          </View>
          {g.rows.slice(0, limit).map((r) => <RowLine key={r.id} row={r} onPress={onRowPress} />)}
          {g.rows.length > limit && <Text style={s.more}>+ ещё {g.rows.length - limit}</Text>}
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  box: { marginBottom: 10 },
  headRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  head: { ...screenTypography.section, marginTop: 0 },
  link: { ...screenTypography.listLink, marginTop: 0 },
  modes: { ...filterChipStyles.row, marginBottom: 10, flexWrap: 'nowrap' as const },
  mode: filterChipStyles.chip,
  modeOn: filterChipStyles.chipOn,
  modeT: filterChipStyles.chipT,
  modeTOn: filterChipStyles.chipTOn,
  group: { marginBottom: 10 },
  groupHead: {
    ...listRowStyles.row,
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderBottomWidth: 0,
    paddingBottom: 4,
  },
  groupLabel: { ...screenTypography.listTitle, flex: 1 },
  groupTotal: { ...screenTypography.listMeta, fontWeight: '600', color: RenovaTheme.colors.primary },
  line: {
    ...listRowStyles.row,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  lineTitle: { ...screenTypography.listTitle, fontSize: 13 },
  lineMeta: { ...screenTypography.listMeta },
  lineAmt: { ...screenTypography.listTitle, fontSize: 13 },
  more: { ...screenTypography.listMeta, marginTop: 4 },
  empty: { ...screenTypography.empty, marginBottom: 12 },
});
