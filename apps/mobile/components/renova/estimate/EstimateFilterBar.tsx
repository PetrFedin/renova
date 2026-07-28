/** Фильтры сметы — тип строки и статья расхода */
import { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { screenTypography, filterChipStyles } from '@/constants/screenTypography';
import { api } from '@/lib/api';
import type { EstimateLine } from '@/lib/api';
import {
  collectEstimateCategories,
  estimateCategoryLabel,
  type EstimateLineTypeFilter,
} from '@/lib/domain/estimateFilters';
import { WORK_TYPES_FALLBACK, type WorkTypeOption } from '@/constants/workCatalog';
import { reportError } from '@/lib/reportError';

const TYPE_FILTERS: { key: EstimateLineTypeFilter; label: string }[] = [
  { key: 'all', label: 'Все' },
  { key: 'work', label: 'Работы' },
  { key: 'material', label: 'Материалы' },
];

type Props = {
  lines: EstimateLine[];
  lineType: EstimateLineTypeFilter;
  category: string | null;
  onLineType: (v: EstimateLineTypeFilter) => void;
  onCategory: (v: string | null) => void;
  showCategoryFilters?: boolean;
};

export function EstimateFilterBar({
  lines,
  lineType,
  category,
  onLineType,
  onCategory,
  showCategoryFilters = true,
}: Props) {
  const [workTypes, setWorkTypes] = useState<WorkTypeOption[]>(WORK_TYPES_FALLBACK);
  const categories = collectEstimateCategories(lines);

  useEffect(() => {
    api.listWorkTypes().then(setWorkTypes).catch(() => setWorkTypes(WORK_TYPES_FALLBACK));
  }, []);

  return (
    <View style={s.wrap}>
      <Text style={s.label}>Тип</Text>
      <View style={s.row}>
        {TYPE_FILTERS.map((f) => (
          <Pressable
            key={f.key}
            style={[s.chip, lineType === f.key && s.chipOn]}
            onPress={() => onLineType(f.key)}
          >
            <Text style={[s.chipT, lineType === f.key && s.chipTOn]}>{f.label}</Text>
          </Pressable>
        ))}
      </View>
      {showCategoryFilters && categories.length > 0 && (
        <>
          <Text style={s.label}>Статья</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.row}>
            <Pressable style={[s.chip, !category && s.chipOn]} onPress={() => onCategory(null)}>
              <Text style={[s.chipT, !category && s.chipTOn]}>Все</Text>
            </Pressable>
            {categories.map((code) => (
              <Pressable
                key={code}
                style={[s.chip, category === code && s.chipOn]}
                onPress={() => onCategory(code)}
              >
                <Text style={[s.chipT, category === code && s.chipTOn]}>
                  {estimateCategoryLabel(code, workTypes)}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginBottom: 12, gap: 6 },
  label: { ...screenTypography.section, marginTop: 0, marginBottom: 0 },
  row: filterChipStyles.row,
  chip: filterChipStyles.chip,
  chipOn: filterChipStyles.chipOn,
  chipT: filterChipStyles.chipT,
  chipTOn: filterChipStyles.chipTOn,
});
