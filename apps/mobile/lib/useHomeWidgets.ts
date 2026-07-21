/** Видимость виджетов главной — из настроек профиля */
import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { getHomeWidgets, subscribeHomeWidgets } from '@/lib/homeWidgetPrefs';
import type { HomeWidgetId, HomeWidgetRole } from '@/constants/homeWidgets';
import { reportCatch } from '@/lib/reportError';

export function useHomeWidgets(role: HomeWidgetRole) {
  const [visible, setVisible] = useState<Set<HomeWidgetId>>(new Set());

  const reload = useCallback(async () => {
    const ids = await getHomeWidgets(role);
    setVisible(new Set(ids));
  }, [role]);

  useFocusEffect(useCallback(() => { reload().catch(reportCatch('homeWidgets.reload')); }, [reload]));

  useEffect(() => subscribeHomeWidgets(reload), [reload]);

  const isVisible = useCallback((id: HomeWidgetId) => visible.has(id), [visible]);

  return { isVisible, visible, reload };
}
