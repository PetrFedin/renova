/** In-app просмотр финального отчёта — без PDF */
import { View, Text, StyleSheet } from 'react-native';
import { RenovaTheme, card, formatRub } from '@/constants/Theme';
import { homeTypography } from '@/constants/homeTypography';
import type { FinalReport } from '@/lib/reports/reportTypes';
import type { ExpenseCategoryId, FinalReportSectionId } from '@/lib/reports/reportSections';

export function FinalReportView({
  data,
  sections,
  categories,
}: {
  data: FinalReport;
  sections: FinalReportSectionId[];
  categories?: ExpenseCategoryId[];
}) {
  const show = (id: FinalReportSectionId) => sections.includes(id);
  const expenseRows = (data.expenses_by_category || []).filter((row) =>
    !categories?.length || categories.includes(row.category as ExpenseCategoryId),
  );

  return (
    <View style={s.wrap}>
      {show('summary') && (
        <View style={s.block}>
          <Text style={homeTypography.zoneLabel}>Сводка</Text>
          <Text style={s.line}>План {formatRub(data.budget_planned || 0)}</Text>
          <Text style={s.line}>Факт {formatRub(data.budget_spent || 0)}</Text>
          {data.overrun ? <Text style={s.warn}>Перерасход {formatRub(data.overrun)}</Text> : null}
          {data.savings ? <Text style={s.ok}>Экономия {formatRub(data.savings)}</Text> : null}
          {data.forecast_total ? <Text style={s.meta}>Прогноз {formatRub(data.forecast_total)}</Text> : null}
        </View>
      )}

      {show('works') && (data.works?.length || 0) > 0 && (
        <View style={s.block}>
          <Text style={homeTypography.zoneLabel}>Работы · {data.works!.length}</Text>
          {data.works!.slice(0, 8).map((w, i) => (
            <Text key={i} style={s.meta} numberOfLines={1}>• {w.name} — {w.status}</Text>
          ))}
        </View>
      )}

      {show('expenses') && (
        <View style={s.block}>
          <Text style={homeTypography.zoneLabel}>Расходы</Text>
          <Text style={s.line}>Подтверждено {formatRub(expenseRows.reduce((s, r) => s + r.total, 0) || data.expenses_total || 0)}</Text>
          {expenseRows.map((row) => (
            <Text key={row.category} style={s.meta}>{row.label}: {formatRub(row.total)}</Text>
          ))}
        </View>
      )}

      {show('risks') && (data.risks?.length || 0) > 0 && (
        <View style={s.block}>
          <Text style={homeTypography.zoneLabel}>Риски · {data.risks_remaining ?? data.risks!.length}</Text>
          {data.risks!.slice(0, 5).map((r, i) => (
            <Text key={i} style={s.meta} numberOfLines={2}>• {(r as { title?: string }).title || 'Риск'}</Text>
          ))}
        </View>
      )}

      {show('issues') && (
        <View style={s.block}>
          <Text style={homeTypography.zoneLabel}>Замечания</Text>
          <Text style={s.meta}>Всего {data.issues_total ?? 0} · открытых {data.issues_open ?? 0}</Text>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 8 },
  block: { ...card, marginBottom: 0, paddingVertical: 12 },
  line: { fontSize: 15, fontWeight: '600', color: RenovaTheme.colors.text, marginTop: 6 },
  meta: { fontSize: 13, color: RenovaTheme.colors.textMuted, marginTop: 4 },
  warn: { fontSize: 13, color: RenovaTheme.colors.danger, marginTop: 4 },
  ok: { fontSize: 13, color: RenovaTheme.colors.success, marginTop: 4 },
});
