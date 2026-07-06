/** Выбор разделов финального отчёта и статей расходов */
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { homeTypography } from '@/constants/homeTypography';
import {
  EXPENSE_CATEGORIES,
  FINAL_REPORT_SECTIONS,
  type ExpenseCategoryId,
  type FinalReportSectionId,
} from '@/lib/reports/reportSections';

type Props = {
  sections: FinalReportSectionId[];
  categories: ExpenseCategoryId[];
  onToggleSection: (id: FinalReportSectionId) => void;
  onToggleCategory: (id: ExpenseCategoryId) => void;
};

export function ReportSectionPicker({ sections, categories, onToggleSection, onToggleCategory }: Props) {
  const showCategories = sections.includes('expenses');

  return (
    <View style={s.wrap}>
      <Text style={homeTypography.zoneLabel}>Разделы отчёта</Text>
      <View style={s.chips}>
        {FINAL_REPORT_SECTIONS.map((item) => {
          const on = sections.includes(item.id);
          return (
            <Pressable key={item.id} style={[s.chip, on && s.chipOn]} onPress={() => onToggleSection(item.id)}>
              <Text style={[s.chipT, on && s.chipTOn]}>{item.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {showCategories ? (
        <>
          <Text style={[homeTypography.zoneLabel, s.catHead]}>Статьи расходов</Text>
          <Text style={s.hint}>Можно выгрузить не весь отчёт, а только нужные категории</Text>
          <View style={s.chips}>
            {EXPENSE_CATEGORIES.map((item) => {
              const on = categories.includes(item.id);
              return (
                <Pressable key={item.id} style={[s.chip, on && s.chipOn]} onPress={() => onToggleCategory(item.id)}>
                  <Text style={[s.chipT, on && s.chipTOn]}>{item.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginTop: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
    backgroundColor: RenovaTheme.colors.surface,
  },
  chipOn: { borderColor: RenovaTheme.colors.accent, backgroundColor: RenovaTheme.colors.infoBg },
  chipT: { fontSize: 12, fontWeight: '600', color: RenovaTheme.colors.textMuted },
  chipTOn: { color: RenovaTheme.colors.accent },
  catHead: { marginTop: 14 },
  hint: { fontSize: 11, color: RenovaTheme.colors.textSubtle, marginTop: 4 },
});
