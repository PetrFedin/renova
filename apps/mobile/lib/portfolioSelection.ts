/** Выбор проектов для расчёта портфеля — сохраняется между визитами */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useState } from 'react';

const KEY = 'renova_portfolio_selected_ids';

export async function loadPortfolioSelection(allIds: string[]): Promise<Set<string>> {
  if (!allIds.length) return new Set();
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return new Set(allIds);
  try {
    const ids = JSON.parse(raw) as string[];
    const valid = ids.filter((id) => allIds.includes(id));
    return valid.length ? new Set(valid) : new Set(allIds);
  } catch {
    return new Set(allIds);
  }
}

export async function savePortfolioSelection(ids: string[]): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(ids));
}

export function usePortfolioSelection(allIds: string[]) {
  const idsKey = allIds.join('|');
  const [selected, setSelected] = useState<Set<string>>(() => new Set(allIds));
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    loadPortfolioSelection(allIds).then((next) => {
      if (!cancelled) {
        setSelected(next);
        setReady(true);
      }
    });
    return () => { cancelled = true; };
  }, [idsKey]);

  const persist = useCallback(async (next: Set<string>) => {
    setSelected(next);
    await savePortfolioSelection([...next]);
  }, []);

  const toggle = useCallback(async (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    await persist(next);
  }, [persist, selected]);

  const selectAll = useCallback(async () => {
    await persist(new Set(allIds));
  }, [allIds, persist]);

  const clearAll = useCallback(async () => {
    await persist(new Set());
  }, [persist]);

  const selectedProjects = useMemo(
    () => allIds.filter((id) => selected.has(id)),
    [allIds, selected],
  );

  return {
    ready,
    selected,
    selectedIds: selectedProjects,
    selectedCount: selected.size,
    allCount: allIds.length,
    isSelected: (id: string) => selected.has(id),
    toggle,
    selectAll,
    clearAll,
  };
}
