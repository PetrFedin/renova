/** Стили общие для вкладок «Бюджет» — Clarity F: list-row, без card-стека и uppercase */
import { StyleSheet } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { formMetaText } from '@/constants/formTypography';
import { screenTypography, listRowStyles } from '@/constants/screenTypography';

export const budgetScreenStyles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: RenovaTheme.colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  muted: { color: RenovaTheme.colors.textMuted },
  risk: { fontSize: 13, marginTop: 8, fontWeight: '600' },
  dataHint: { ...formMetaText.caption, marginTop: 6, marginBottom: 4 },
  widgetSettingsLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  widgetSettingsRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  widgetSettingsText: { fontSize: 13, fontWeight: '600', color: RenovaTheme.colors.accent },
  widgetSettingsArrow: { fontSize: 14, fontWeight: '700', color: RenovaTheme.colors.accent },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  section: { ...screenTypography.section },
  row: {
    ...listRowStyles.row,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  rowTitle: { ...screenTypography.listTitle, fontSize: 14 },
  rowMeta: { ...screenTypography.listMeta },
  status: { fontSize: 11, fontWeight: '600', color: RenovaTheme.colors.textMuted },
  empty: { ...screenTypography.empty, marginBottom: 12 },
  bulkHint: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginBottom: 10, lineHeight: 16 },
  summaryHero: {
    marginBottom: 12,
    padding: RenovaTheme.spacing.md,
    borderRadius: RenovaTheme.radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: RenovaTheme.colors.border,
    backgroundColor: RenovaTheme.colors.surface,
  },
  summaryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  summaryTitle: { ...screenTypography.section, marginTop: 0, marginBottom: 0, color: RenovaTheme.colors.text },
  summaryState: { fontSize: 12, fontWeight: '700' },
  summaryMainRow: { flexDirection: 'row', gap: 12, marginTop: 12 },
  summaryMainCell: { flex: 1 },
  summaryLabel: { ...screenTypography.metricLabel, marginTop: 0 },
  summaryValue: { ...screenTypography.metric, marginTop: 2 },
  summaryMetaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  summaryMetaCell: {
    flexGrow: 1,
    minWidth: 92,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: RenovaTheme.radius.md,
    backgroundColor: RenovaTheme.colors.surfaceMuted,
  },
  summaryMetaValue: { fontSize: 14, fontWeight: '700', color: RenovaTheme.colors.text, marginTop: 2 },
  summaryAction: { marginTop: 12 },
  changeOrderTotal: { ...screenTypography.metric, fontSize: 18, marginBottom: 4 },
  /** @deprecated: retained for downstream screens until their next cleanup wave. */
  limitCard: {
    ...listRowStyles.metricCell,
    alignItems: 'flex-start',
    marginBottom: 8,
    paddingHorizontal: 12,
  },
  limitTitle: { ...screenTypography.metricLabel },
  limitVal: { ...screenTypography.metric, marginTop: 2 },
});
