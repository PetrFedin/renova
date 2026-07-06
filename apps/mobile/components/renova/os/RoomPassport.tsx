/** Digital Twin комнаты — паспорт + этапы + связь с бюджетом */
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { usePathname, router } from 'expo-router';
import { RenovaTheme, card, formatRub } from '@/constants/Theme';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import type { RoomSnapshot } from '@/lib/api';
import { RoomStageTimeline } from '@/components/renova/os/RoomStageTimeline';
import { budgetTabRoute, type OsRole } from '@/constants/osSections';
import { pushOsNav } from '@/lib/pushOsNav';

function Cell({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <View style={[s.cell, warn && s.cellWarn]}>
      <Text style={s.cellL}>{label}</Text>
      <Text style={s.cellV}>{value}</Text>
      {sub ? <Text style={s.cellS}>{sub}</Text> : null}
    </View>
  );
}

export function RoomPassport({ snap, role }: { snap: RoomSnapshot; role?: OsRole }) {
  const pathname = usePathname();
  const na = snap.next_action;
  const overrun = snap.budget.overrun > 0;
  const budgetRoute = role ? budgetTabRoute(role, 'rooms') : null;

  return (
    <View style={s.wrap}>
      <View style={s.hero}>
        <Text style={s.title}>{snap.name}</Text>
        <Text style={s.meta}>
          {snap.metrics.floor_sq_m} м² пол · {snap.works_done}/{snap.works_total} работ · {snap.progress_percent}%
        </Text>
        <View style={s.bar}>
          <View style={[s.fill, { width: `${Math.min(100, snap.progress_percent)}%` }]} />
        </View>
      </View>

      <View style={s.grid}>
        {budgetRoute ? (
          <Pressable style={[s.cell, overrun && s.cellWarn]} onPress={() => pushOsNav(budgetRoute, pathname)}>
            <Text style={s.cellL}>Бюджет →</Text>
            <Text style={s.cellV}>{formatRub(snap.budget.planned)}</Text>
            <Text style={s.cellS}>{overrun ? `+${formatRub(snap.budget.overrun)}` : formatRub(snap.budget.spent)}</Text>
          </Pressable>
        ) : (
          <Cell
            label="Бюджет"
            value={formatRub(snap.budget.planned)}
            sub={overrun ? `+${formatRub(snap.budget.overrun)}` : formatRub(snap.budget.spent)}
            warn={overrun}
          />
        )}
        <Cell
          label="Материалы"
          value={String(snap.materials_total)}
          sub={snap.materials_need_buy ? `${snap.materials_need_buy} к заказу` : `${snap.materials_delivered} доставлено`}
        />
        <Cell
          label="Замечания"
          value={String(snap.issues_open)}
          sub={snap.issues_critical ? `${snap.issues_critical} крит.` : 'нет'}
          warn={snap.issues_critical > 0}
        />
        <Cell label="Смета" value={String(snap.estimate_lines)} sub="строк" />
      </View>

      {snap.stages?.length ? <RoomStageTimeline stages={snap.stages} /> : null}

      {na?.href ? (
        <PrimaryButton title={na.button || 'Открыть'} compact onPress={() => pushOsNav(na.href, pathname)} />
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginBottom: 12 },
  hero: { ...card, marginBottom: 10, padding: 14 },
  title: { fontSize: 20, fontWeight: '800', color: RenovaTheme.colors.text },
  meta: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginTop: 4 },
  bar: { height: 4, backgroundColor: RenovaTheme.colors.border, borderRadius: 2, marginTop: 10, overflow: 'hidden' },
  fill: { height: 4, backgroundColor: RenovaTheme.colors.accent },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  cell: { ...card, width: '48%', minWidth: '46%', flexGrow: 1, padding: 12 },
  cellWarn: { borderColor: RenovaTheme.colors.warning, backgroundColor: '#fffbeb' },
  cellL: { fontSize: 11, fontWeight: '700', color: RenovaTheme.colors.textMuted, textTransform: 'uppercase' },
  cellV: { fontSize: 16, fontWeight: '800', marginTop: 4, color: RenovaTheme.colors.text },
  cellS: { fontSize: 11, color: RenovaTheme.colors.textMuted, marginTop: 2 },
});
