/** Расходы по комнатам: план сметы vs единый факт (чеки + os + материалы) */
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { RenovaTheme, formatRub } from '@/constants/Theme';
import { screenTypography, listRowStyles } from '@/constants/screenTypography';
import { roomTypeLabel } from '@/constants/roomTypes';
import { roomSpentUnified } from '@/lib/domain/expenseAnalytics';
import type { Room, ReceiptItem, EstimateLine, OsExpense, MaterialPick, Purchase, Stage } from '@/lib/api';
import { pushOsNav } from '@/lib/pushOsNav';
import type { OsRole } from '@/constants/osSections';
import { useRenova } from '@/lib/context/RenovaContext';

type Row = { room: Room; plan: number; spent: number };

function buildRows(
  rooms: Room[],
  lines: EstimateLine[],
  receipts: ReceiptItem[],
  expenses: OsExpense[],
  picks: MaterialPick[],
  stages: Stage[],
  purchases: Purchase[],
): Row[] {
  return rooms.map((room) => {
    const rl = lines.filter((l) => (l.room_id && l.room_id === room.id) || l.room_name === room.name);
    const plan = rl.reduce((a, l) => a + l.quantity_planned * l.unit_price, 0);
    const estFact = rl.reduce((a, l) => a + (l.quantity_actual || 0) * l.unit_price, 0);
    const spent = Math.max(estFact, roomSpentUnified(receipts, expenses, picks, rooms, stages, room.id, purchases));
    return { room, plan, spent };
  }).filter((x) => x.plan > 0 || x.spent > 0);
}

export function ExpenseByRoom({
  rooms, lines, receipts, expenses, picks = [], purchases = [], stages = [], compact, returnTo, role: roleProp,
}: {
  rooms: Room[];
  lines: EstimateLine[];
  receipts: ReceiptItem[];
  expenses?: OsExpense[];
  picks?: MaterialPick[];
  purchases?: Purchase[];
  stages?: Stage[];
  compact?: boolean;
  returnTo?: string;
  role?: OsRole;
}) {
  const { user } = useRenova();
  const role: OsRole = roleProp ?? (user?.role === 'contractor' ? 'contractor' : 'customer');
  const ex = expenses || [];
  const rows = buildRows(rooms, lines, receipts, ex, picks, stages, purchases);
  if (!rows.length) {
    return (
      <View style={s.box}>
        <Text style={s.head}>Расходы по комнатам</Text>
        <Text style={s.empty}>Пока нет данных — добавьте чеки или расходы с привязкой к комнате.</Text>
      </View>
    );
  }
  const totalPlan = rows.reduce((a, r) => a + r.plan, 0);
  const totalSpent = rows.reduce((a, r) => a + r.spent, 0);
  return (
    <View style={s.box}>
      <Text style={s.head}>Расходы по комнатам · {formatRub(totalSpent)} / {formatRub(totalPlan)}</Text>
      {rows.map(({ room, plan, spent }) => {
        const pct = plan ? Math.min(100, (spent / plan) * 100) : 0;
        const over = plan > 0 && spent > plan;
        return (
          <Pressable
            key={room.id}
            style={s.row}
            onPress={() =>
              pushOsNav({ pathname: '/room/[id]', params: { id: room.id } }, returnTo, role)
            }
          >
            <View style={{ flex: 1 }}>
              <Text style={s.name}>{room.name}{room.floor_level && room.floor_level > 1 ? ` · ${room.floor_level} эт.` : ''}</Text>
              {!compact && <Text style={s.sub}>{roomTypeLabel(room.room_type)}</Text>}
              <View style={s.bar}><View style={[s.fill, { width: `${pct}%`, backgroundColor: over ? RenovaTheme.colors.warning : RenovaTheme.colors.primary }]} /></View>
            </View>
            <Text style={[s.val, over && s.over]}>{formatRub(spent)}{plan ? ` / ${formatRub(plan)}` : ''}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
const s = StyleSheet.create({
  // Clarity U: list SoT вместо opaque card-бокса
  box: { marginBottom: 12 },
  head: { ...screenTypography.section, marginTop: 0, marginBottom: 8 },
  empty: { ...screenTypography.empty },
  row: {
    ...listRowStyles.row,
    flexDirection: 'row',
    alignItems: 'center',
  },
  name: { ...screenTypography.listTitle, fontSize: 14 },
  sub: { ...screenTypography.listMeta, fontSize: 11 },
  bar: { height: 4, backgroundColor: RenovaTheme.colors.border, borderRadius: 2, marginTop: 6, overflow: 'hidden' },
  fill: { height: 4 },
  val: { ...screenTypography.listMeta, fontWeight: '600', marginLeft: 8 },
  over: { color: RenovaTheme.colors.warning },
});
