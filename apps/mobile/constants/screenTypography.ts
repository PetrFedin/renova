/**
 * Clarity C: единая спокойная шкала для hub-экранов (не только Home).
 * Без uppercase-крика; list-row вместо card-стека.
 */
import { StyleSheet } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';

const c = RenovaTheme.colors;

export const screenTypography = StyleSheet.create({
  /** Заголовок секции — sentence case */
  section: {
    fontSize: 13,
    fontWeight: '600',
    color: c.textMuted,
    marginTop: 12,
    marginBottom: 6,
  },
  sectionFocus: { color: c.primary },
  /** Строка списка */
  listTitle: { fontSize: 15, fontWeight: '600', color: c.text },
  listMeta: { fontSize: 12, fontWeight: '400', color: c.textMuted, marginTop: 2, lineHeight: 16 },
  listLink: { fontSize: 13, fontWeight: '600', color: c.primary, marginTop: 4 },
  /** KPI / summary цифры */
  metric: { fontSize: 20, fontWeight: '700', color: c.text },
  metricLabel: { fontSize: 11, fontWeight: '500', color: c.textMuted, marginTop: 2 },
  empty: { fontSize: 13, fontWeight: '400', color: c.textMuted, lineHeight: 18 },
});

/** Плотный list без карточек — разделители, не border+shadow на каждой строке */
export const listRowStyles = StyleSheet.create({
  row: {
    paddingVertical: 12,
    paddingHorizontal: 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
    backgroundColor: 'transparent',
  },
  rowFocus: {
    backgroundColor: c.infoBg,
    marginHorizontal: -8,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderBottomWidth: 0,
  },
  /** Компактные KPI без тяжёлых card */
  metricCell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: c.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
  },
  summaryRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
});

/**
 * Clarity V: единый язык filter chips (outline + infoBg), не accent-fill / solid primary.
 * Использовать в Schedule / Estimate / Search / Expense modes.
 */
export const filterChipStyles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.surface,
  },
  chipOn: { borderColor: c.primary, backgroundColor: c.infoBg },
  chipT: { fontSize: 12, fontWeight: '600', color: c.text },
  chipTOn: { color: c.primary },
});
