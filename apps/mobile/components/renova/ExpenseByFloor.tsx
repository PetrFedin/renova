/** Расходы по этажам — unified list для дома и многоуровневых объектов */
import { View, Text, StyleSheet } from 'react-native';
import { RenovaTheme, formatRub } from '@/constants/Theme';
import { screenTypography, listRowStyles } from '@/constants/screenTypography';
import type { Room, EstimateLine } from '@/lib/api';
import type { ExpenseDetailRow } from '@/lib/domain/expenseAnalytics';
import { floorGroups, roomPlan } from '@/lib/expenseSummary';

export function floorTotalsUnified(
  rows: ExpenseDetailRow[],
  rooms: Room[],
  lines: EstimateLine[],
) {
  return floorGroups(rooms).map(([floor, rs]) => {
    const roomIds = new Set(rs.map((r) => r.id));
    const spent = rows
      .filter((row) => row.roomId && roomIds.has(row.roomId))
      .reduce((a, row) => a + row.amount, 0);
    const plan = rs.reduce((a, r) => a + roomPlan(lines, r), 0);
    return { floor, plan, spent };
  });
}

export function ExpenseByFloor({
  rows,
  rooms,
  lines,
  propertyType,
}: {
  rows: ExpenseDetailRow[];
  rooms: Room[];
  lines: EstimateLine[];
  propertyType?: string;
}) {
  const floors = floorTotalsUnified(rows, rooms, lines);
  const multiFloor = propertyType === 'house' || floors.length > 1 || floors.some((f) => f.floor > 1);
  if (!multiFloor || !floors.length) return null;
  return (
    <View style={s.box}>
      <Text style={s.head}>Расходы по этажам</Text>
      {floors.map(({ floor, plan, spent }) => (
        <View key={floor} style={s.row}>
          <Text style={s.name}>{floor === 1 ? '1 этаж / квартира' : `${floor} этаж`}</Text>
          <Text style={s.val}>{formatRub(spent)}{plan ? ` / ${formatRub(plan)}` : ''}</Text>
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  box: { marginBottom: 12 },
  head: { ...screenTypography.section, marginTop: 0, marginBottom: 8 },
  row: { ...listRowStyles.row },
  name: { ...screenTypography.listTitle, fontSize: 14 },
  val: { ...screenTypography.listMeta, fontWeight: '600', color: RenovaTheme.colors.primary },
});
