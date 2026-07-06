import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { getBudgetWidgets, subscribeBudgetWidgets } from '@/lib/budgetWidgetPrefs';
import type { BudgetWidgetId, BudgetWidgetRole } from '@/constants/budgetWidgets';

export function useBudgetWidgets(role: BudgetWidgetRole) {
  const [visible, setVisible] = useState<Set<BudgetWidgetId>>(new Set());

  const reload = useCallback(async () => {
    const ids = await getBudgetWidgets(role);
    setVisible(new Set(ids));
  }, [role]);

  useFocusEffect(useCallback(() => { reload().catch(() => {}); }, [reload]));
  useEffect(() => subscribeBudgetWidgets(reload), [reload]);

  const isVisible = useCallback((id: BudgetWidgetId) => visible.has(id), [visible]);
  return { isVisible, visible, reload };
}
