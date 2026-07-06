/** Стили общие для вкладок «Бюджет» */
import { StyleSheet } from 'react-native';
import { RenovaTheme, card } from '@/constants/Theme';

export const budgetScreenStyles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: RenovaTheme.colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  muted: { color: RenovaTheme.colors.textMuted },
  risk: { fontSize: 13, marginTop: 8, fontWeight: '600' },
  dataHint: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginTop: 6, marginBottom: 4, lineHeight: 16 },
  widgetSettingsLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  widgetSettingsText: { fontSize: 13, fontWeight: '600', color: RenovaTheme.colors.accent },
  widgetSettingsArrow: { fontSize: 14, fontWeight: '700', color: RenovaTheme.colors.accent },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  section: { fontSize: 12, fontWeight: '700', color: RenovaTheme.colors.textMuted, textTransform: 'uppercase', marginVertical: 8 },
  row: { ...card, flexDirection: 'row', alignItems: 'center', paddingVertical: 9, gap: 8 },
  rowTitle: { fontSize: 14, fontWeight: '600' },
  rowMeta: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginTop: 2 },
  status: { fontSize: 11, fontWeight: '600', color: RenovaTheme.colors.textMuted },
  empty: { fontSize: 13, color: RenovaTheme.colors.textMuted, marginBottom: 12 },
  bulkHint: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginBottom: 10, lineHeight: 16 },
  limitCard: {
    ...card,
    marginBottom: 12,
    borderLeftWidth: 3,
    borderLeftColor: RenovaTheme.colors.primary,
    backgroundColor: '#F8FAFC',
  },
  limitTitle: { fontSize: 11, fontWeight: '700', color: RenovaTheme.colors.textMuted, textTransform: 'uppercase' },
  limitVal: { fontSize: 18, fontWeight: '700', color: RenovaTheme.colors.text, marginTop: 2 },
});
