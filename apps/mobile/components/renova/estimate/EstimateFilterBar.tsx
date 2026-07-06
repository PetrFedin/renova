/** Фильтры сметы — тип строки и статья расхода */
import { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { api } from '@/lib/api';
import type { EstimateLine } from '@/lib/api';
import {
  collectEstimateCategories,
  estimateCategoryLabel,
  type EstimateLineTypeFilter,
} from '@/lib/domain/estimateFilters';
import { WORK_TYPES_FALLBACK, type WorkTypeOption } from '@/constants/workCatalog';

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
  label: {
    fontSize: 11,
    fontWeight: '700',
    color: RenovaTheme.colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
    backgroundColor: RenovaTheme.colors.surface,
  },
  chipOn: { borderColor: RenovaTheme.colors.primary, backgroundColor: RenovaTheme.colors.infoBg },
  chipT: { fontSize: 12, fontWeight: '600', color: RenovaTheme.colors.text },
  chipTOn: { color: RenovaTheme.colors.primary },
});
