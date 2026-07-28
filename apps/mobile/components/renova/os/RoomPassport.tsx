/** Digital Twin комнаты — паспорт + этапы + связь с бюджетом */
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { usePathname, router } from 'expo-router';
import { RenovaTheme, formatRub } from '@/constants/Theme';
import { screenTypography, listRowStyles } from '@/constants/screenTypography';
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
  const budgetRoute = role ? budgetTabRoute(role, 'expenses', { roomId: snap.id, view: 'rooms' }) : null;

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
          <Pressable style={[s.cell, overrun && s.cellWarn]} onPress={() => pushOsNav(budgetRoute, pathname, role)}>
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

      {snap.stages?.length ? <RoomStageTimeline stages={snap.stages} role={role} /> : null}

      {na?.href ? (
        <PrimaryButton
          title={na.button || 'Открыть'}
          compact
          onPress={() => pushOsNav(na.href, pathname, role || 'customer')}
        />
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginBottom: 12 },
  hero: { marginBottom: 10, paddingVertical: 4, gap: 4 },
  title: { ...screenTypography.listTitle, fontSize: 18 },
  meta: { ...screenTypography.listMeta, marginTop: 4 },
  bar: { height: 4, backgroundColor: RenovaTheme.colors.border, borderRadius: 2, marginTop: 10, overflow: 'hidden' },
  fill: { height: 4, backgroundColor: RenovaTheme.colors.accent },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  cell: { ...listRowStyles.metricCell, width: '48%', minWidth: '46%', flexGrow: 1, padding: 12 },
  cellWarn: { borderColor: RenovaTheme.colors.warning, backgroundColor: '#fffbeb' },
  cellL: { ...screenTypography.metricLabel, marginTop: 0 },
  cellV: { ...screenTypography.listTitle, fontSize: 16, marginTop: 4 },
  cellS: { ...screenTypography.listMeta },
});
