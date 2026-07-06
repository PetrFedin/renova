/** Слой «Итог» — сумма сметы и быстрые переходы в деньги / материалы */
import { View, Text, StyleSheet } from 'react-native';
import { RenovaTheme, formatRub } from '@/constants/Theme';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { EstimateSourceLegend } from '@/components/renova/estimate/EstimateSourceLegend';
import { budgetTabRoute, repairTabRoute } from '@/constants/osSections';
import { pushOsNav } from '@/lib/pushOsNav';
import type { ProjectDetail } from '@/lib/api';
import { estimateTotals } from '@/lib/domain/estimateFilters';

type Props = {
  project: ProjectDetail;
  totals: ReturnType<typeof estimateTotals>;
  pathname: string;
  roomsCount: number;
  stagesCount: number;
  pendingChanges: number;
};

export function EstimateSummaryLayer({
  project,
  totals,
  pathname,
  roomsCount,
  stagesCount,
  pendingChanges,
}: Props) {
  return (
    <View style={s.wrap}>
      <View style={s.totalBox}>
        <Text style={s.totalLabel}>Итого по смете</Text>
        <Text style={s.total}>{formatRub(project.budget_planned)}</Text>
        <Text style={s.breakdown}>
          Работы {formatRub(totals.works)} ({totals.worksCount}) · Материалы {formatRub(totals.materials)} (
          {totals.materialsCount})
        </Text>
      </View>

      <View style={s.metaRow}>
        <MetaChip label="Комнаты" value={roomsCount ? `${roomsCount}` : '—'} />
        <MetaChip label="Этапы" value={stagesCount ? `${stagesCount}` : '—'} />
        <MetaChip
          label="На согласовании"
          value={pendingChanges ? `${pendingChanges}` : '0'}
          warn={pendingChanges > 0}
        />
      </View>

      <EstimateSourceLegend compact />

      <Text style={s.hint}>
        Детализация по комнатам — вкладка «Детализация». Доп. работы и решения — «Изменения». PDF и Excel — «Документы».
      </Text>

      <View style={s.links}>
        <PrimaryButton
          title="→ Деньги"
          variant="outline"
          compact
          onPress={() => pushOsNav(budgetTabRoute('customer', 'summary'), pathname)}
        />
        <PrimaryButton
          title="→ Материалы"
          variant="outline"
          compact
          onPress={() => pushOsNav(repairTabRoute('customer', 'materials'), pathname)}
        />
      </View>
    </View>
  );
}

function MetaChip({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <View style={[s.chip, warn && s.chipWarn]}>
      <Text style={s.chipLabel}>{label}</Text>
      <Text style={[s.chipVal, warn && s.chipValWarn]}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 10, marginTop: 12 },
  totalBox: { marginBottom: 4 },
  totalLabel: { fontSize: 12, fontWeight: '700', color: RenovaTheme.colors.textMuted, textTransform: 'uppercase' },
  total: { fontSize: 32, fontWeight: '800', color: RenovaTheme.colors.primary, marginTop: 4 },
  breakdown: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginTop: 4, lineHeight: 17 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexGrow: 1,
    minWidth: '28%',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
    backgroundColor: RenovaTheme.colors.surface,
  },
  chipWarn: { borderColor: '#FCD34D', backgroundColor: '#FFFBEB' },
  chipLabel: { fontSize: 10, fontWeight: '700', color: RenovaTheme.colors.textMuted, textTransform: 'uppercase' },
  chipVal: { fontSize: 14, fontWeight: '700', color: RenovaTheme.colors.text, marginTop: 2 },
  chipValWarn: { color: '#92400E' },
  hint: { fontSize: 12, color: RenovaTheme.colors.textMuted, lineHeight: 17 },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
