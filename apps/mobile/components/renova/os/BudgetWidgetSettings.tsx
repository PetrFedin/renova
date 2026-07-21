/** Настройка блоков «Бюджет → Сводка» */
import { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Alert } from 'react-native';
import { RenovaTheme, card } from '@/constants/Theme';
import {
  BUDGET_WIDGET_CATALOG,
  BUDGET_WIDGET_DEFAULT,
  type BudgetWidgetId,
} from '@/constants/budgetWidgets';
import { getBudgetWidgets, toggleBudgetWidget, resetBudgetWidgets } from '@/lib/budgetWidgetPrefs';
import type { OsRole } from '@/constants/osSections';
import { reportCatch } from '@/lib/reportError';

export function BudgetWidgetSettings({ role, embedded }: { role: OsRole; embedded?: boolean }) {
  const [enabled, setEnabled] = useState<Set<BudgetWidgetId>>(new Set(BUDGET_WIDGET_DEFAULT));
  const [expanded, setExpanded] = useState(!embedded);

  useEffect(() => { getBudgetWidgets(role).then((ids) => setEnabled(new Set(ids))).catch(reportCatch('components.renova.os.BudgetWidgetSettings.1')); }, [role]);

  const onToggle = async (id: BudgetWidgetId) => {
    if (enabled.has(id) && enabled.size <= 1) {
      Alert.alert('Минимум один', 'На сводке должен остаться хотя бы один блок.');
      return;
    }
    const next = await toggleBudgetWidget(role, id);
    setEnabled(new Set(next));
  };

  return (
    <View style={[s.wrap, embedded && s.embedded]}>
      {!embedded ? (
        <Text style={s.head}>Виджеты бюджета</Text>
      ) : (
        <Text style={s.subHead}>Виджеты бюджета</Text>
      )}
      {embedded && !expanded ? (
        <Pressable onPress={() => setExpanded(true)} style={s.expand}>
          <Text style={s.expandT}>Настроить блоки сводки ▼</Text>
        </Pressable>
      ) : null}
      {expanded ? BUDGET_WIDGET_CATALOG.map((w) => {
        const on = enabled.has(w.id);
        return (
          <Pressable key={w.id} style={[s.row, on && s.rowOn]} onPress={() => onToggle(w.id)}>
            <View style={{ flex: 1 }}>
              <Text style={s.label}>{w.label}</Text>
            </View>
            <Text style={[s.check, on && s.checkOn]}>{on ? '✓' : '○'}</Text>
          </Pressable>
        );
      }) : null}
      {expanded ? (
      <Pressable onPress={async () => setEnabled(new Set(await resetBudgetWidgets(role)))}>
        <Text style={s.reset}>Сбросить по умолчанию</Text>
      </Pressable>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { ...card, marginBottom: 12 },
  embedded: { ...card, marginBottom: 0, marginTop: 8, paddingTop: 12, paddingHorizontal: 0, borderWidth: 0, borderTopWidth: 1, borderTopColor: RenovaTheme.colors.border, backgroundColor: 'transparent' },
  head: { fontSize: 16, fontWeight: '800', marginBottom: 4 },
  subHead: { fontSize: 14, fontWeight: '700', color: RenovaTheme.colors.text, marginBottom: 2 },
  hint: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginBottom: 10 },
  subHint: { fontSize: 11, color: RenovaTheme.colors.textMuted, marginBottom: 8 },
  expand: { marginBottom: 8, paddingVertical: 4 },
  expandT: { fontSize: 12, fontWeight: '600', color: RenovaTheme.colors.primary },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#f0f0f0' },
  rowOn: { backgroundColor: '#F8FAFC' },
  label: { fontSize: 14, fontWeight: '600' },
  sub: { fontSize: 11, color: RenovaTheme.colors.textMuted, marginTop: 2 },
  check: { fontSize: 18, color: RenovaTheme.colors.textMuted, width: 28, textAlign: 'center' },
  checkOn: { color: RenovaTheme.colors.primary, fontWeight: '800' },
  reset: { marginTop: 10, textAlign: 'center', color: RenovaTheme.colors.primary, fontWeight: '600', fontSize: 13 },
});
