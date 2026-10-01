/** Выбор проектов для расчёта портфеля — сохраняется между визитами */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useState } from 'react';

const KEY = 'renova_portfolio_selected_ids';

/**
 * HOM-25: явно сохранённый ПУСТОЙ выбор («Снять все») — это выбор, а не «не задано».
 * «Выбрать всё» по умолчанию — только если сохранённого нет или ни один сохранённый
 * id больше не существует (объекты сменились).
 */
export function resolveSavedSelection(raw: string | null, allIds: string[]): Set<string> {
  if (!allIds.length) return new Set();
  if (!raw) return new Set(allIds);
  try {
    const ids = JSON.parse(raw);
    if (!Array.isArray(ids)) return new Set(allIds);
    if (ids.length === 0) return new Set();
    const valid = (ids as string[]).filter((id) => allIds.includes(id));
    return valid.length ? new Set(valid) : new Set(allIds);
  } catch {
    return new Set(allIds);
  }
}

export async function loadPortfolioSelection(allIds: string[]): Promise<Set<string>> {
  if (!allIds.length) return new Set();
  let raw: string | null = null;
  try {
    raw = await AsyncStorage.getItem(KEY);
  } catch {
    raw = null; // HOM-28: отказ хранилища не должен вешать портфель
  }
  return resolveSavedSelection(raw, allIds);
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
