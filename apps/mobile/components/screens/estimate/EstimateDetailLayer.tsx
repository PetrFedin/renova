/** Слой «Детализация» — работы и материалы по комнатам с фильтрами */
import { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { RenovaTheme, formatRub } from '@/constants/Theme';
import { ObjectSection } from '@/components/screens/object/ObjectSection';
import { EstimateMaterialsByRoom } from '@/components/screens/object/EstimateMaterialsByRoom';
import { EstimateWorksByRoom } from '@/components/screens/object/EstimateWorksByRoom';
import { EstimateFilterBar } from '@/components/renova/estimate/EstimateFilterBar';
import type { MaterialStats } from '@/lib/api';
import {
  estimateTotals,
  filterEstimateLines,
  type EstimateLineTypeFilter,
} from '@/lib/domain/estimateFilters';
import type { EstimateLine } from '@/lib/api';

type Props = {
  lines: EstimateLine[];
  stats: MaterialStats | null;
  lineType: EstimateLineTypeFilter;
  category: string | null;
  onLineType: (v: EstimateLineTypeFilter) => void;
  onCategory: (v: string | null) => void;
  showCategoryFilters?: boolean;
};

export function EstimateDetailLayer({
  lines,
  stats,
  lineType,
  category,
  onLineType,
  onCategory,
  showCategoryFilters = true,
}: Props) {
  const filtered = useMemo(
    () => filterEstimateLines(lines, { lineType, category }),
    [lines, lineType, category],
  );
  const works = filtered.filter((l) => l.line_type === 'work');
  const materials = filtered.filter((l) => l.line_type === 'material');
  const filteredTotal = estimateTotals(filtered).total;

  return (
    <View style={s.wrap}>
      <EstimateFilterBar
        lines={lines}
        lineType={lineType}
        category={category}
        onLineType={onLineType}
        onCategory={onCategory}
        showCategoryFilters={showCategoryFilters}
      />
      <Text style={s.filterMeta}>
        По фильтру: {works.length + materials.length} поз. · {formatRub(filteredTotal)}
      </Text>

      {works.length > 0 && (
        <ObjectSection title="Работы" hint={`${works.length} поз. · раскройте комнату.`}>
          <EstimateWorksByRoom lines={works} />
        </ObjectSection>
      )}

      {materials.length > 0 && (
        <ObjectSection title="Материалы" hint={`${materials.length} поз. · факт расхода — в «Деньги».`}>
          <EstimateMaterialsByRoom lines={materials} />
        </ObjectSection>
      )}

      {!works.length && !materials.length && (
        <Text style={s.empty}>Нет позиций по выбранным фильтрам. Сбросьте фильтр или выберите «Все».</Text>
      )}

      {stats && (
        <ObjectSection title="Расходники · план и факт">
          <View style={[s.card, stats.overrun_percent > 5 && s.warn]}>
            <Text>
              План: {formatRub(stats.planned)} · Факт: {formatRub(stats.actual)}
            </Text>
            <Text style={s.overrun}>Отклонение: {stats.overrun_percent}%</Text>
          </View>
        </ObjectSection>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginTop: 12 },
  filterMeta: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginBottom: 10 },
  empty: { fontSize: 13, color: RenovaTheme.colors.textMuted, fontStyle: 'italic', marginBottom: 12, lineHeight: 18 },
  card: {
    backgroundColor: RenovaTheme.colors.surface,
    padding: 14,
    borderRadius: 12,
    borderLeftWidth: 4,
    borderLeftColor: RenovaTheme.colors.success,
  },
  warn: { borderLeftColor: RenovaTheme.colors.warning },
  overrun: { fontWeight: '700', marginTop: 4 },
});
