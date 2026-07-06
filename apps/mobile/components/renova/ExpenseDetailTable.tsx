/** Таблица расходов с переключением группировки */
import { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { usePathname } from 'expo-router';
import { RenovaTheme, formatRub } from '@/constants/Theme';
import {
  buildExpenseDetailRows,
  expensePayerLabel,
  groupExpenseRows,
  type ExpenseGroupMode,
  type ExpenseDetailRow,
} from '@/lib/domain/expenseAnalytics';
import { budgetTabRoute, type OsRole } from '@/constants/osSections';
import { pushOsNav } from '@/lib/pushOsNav';
import type { OsExpense, ReceiptItem, Room, Stage, MaterialPick } from '@/lib/api';

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
  rooms,
  stages,
  compact,
  role = 'customer',
  onRowPress,
}: {
  receipts: ReceiptItem[];
  expenses: OsExpense[];
  picks?: MaterialPick[];
  rooms: Room[];
  stages: Stage[];
  compact?: boolean;
  role?: OsRole;
  onRowPress?: (row: ExpenseDetailRow) => void;
}) {
  const pathname = usePathname();
  const [mode, setMode] = useState<ExpenseGroupMode>('category');
  const rows = useMemo(
    () => buildExpenseDetailRows(receipts, expenses, picks, rooms, stages),
    [receipts, expenses, picks, rooms, stages],
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
  head: { fontSize: 12, fontWeight: '700', color: RenovaTheme.colors.textMuted, textTransform: 'uppercase' },
  link: { fontSize: 12, fontWeight: '600', color: RenovaTheme.colors.accent },
  modes: { gap: 6, marginBottom: 10 },
  mode: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, borderWidth: 1, borderColor: RenovaTheme.colors.border, backgroundColor: RenovaTheme.colors.surface },
  modeOn: { borderColor: RenovaTheme.colors.accent, backgroundColor: RenovaTheme.colors.infoBg },
  modeT: { fontSize: 12, fontWeight: '600', color: RenovaTheme.colors.textMuted },
  modeTOn: { color: RenovaTheme.colors.accent },
  group: { backgroundColor: RenovaTheme.colors.surface, borderRadius: 10, padding: 10, marginBottom: 8, borderWidth: 1, borderColor: RenovaTheme.colors.border },
  groupHead: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  groupLabel: { fontSize: 14, fontWeight: '700', flex: 1, color: RenovaTheme.colors.text },
  groupTotal: { fontSize: 14, fontWeight: '700', color: RenovaTheme.colors.primary },
  line: { flexDirection: 'row', alignItems: 'center', paddingVertical: 5, borderTopWidth: 1, borderTopColor: '#f0f0f0', gap: 8 },
  lineTitle: { fontSize: 13, fontWeight: '600', color: RenovaTheme.colors.text },
  lineMeta: { fontSize: 11, color: RenovaTheme.colors.textMuted, marginTop: 1 },
  lineAmt: { fontSize: 13, fontWeight: '700', color: RenovaTheme.colors.text },
  more: { fontSize: 11, color: RenovaTheme.colors.textMuted, marginTop: 4 },
  empty: { fontSize: 13, color: RenovaTheme.colors.textMuted, marginBottom: 12 },
});
