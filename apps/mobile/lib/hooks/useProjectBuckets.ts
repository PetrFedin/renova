/** Архив/корзина: список только для выбранного bucket; counts — отложенно (не блокируют UI). */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type ProjectSummary } from '@/lib/api';
import type { ProjectBucket } from '@/components/renova/ProjectBucketToolbar';

export function useProjectBuckets(userId: string | undefined, canManage: boolean) {
  const [bucket, setBucket] = useState<ProjectBucket>('active');
  const [items, setItems] = useState<ProjectSummary[]>([]);
  const [archivedCount, setArchivedCount] = useState(0);
  const [trashedCount, setTrashedCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const countsLoadedRef = useRef(false);

  /** Список архива/корзины — только когда пользователь открыл эту вкладку (active берётся из context). */
  const reload = useCallback(async () => {
    if (!userId) return;
    if (bucket === 'active') {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const list = await api.listProjectsByBucket(userId, bucket);
      setItems(list);
      if (bucket === 'archived') setArchivedCount(list.length);
      if (bucket === 'trashed') setTrashedCount(list.length);
    } finally {
      setLoading(false);
    }
  }, [userId, bucket]);

  /** Счётчики для toolbar — после первого paint, без спиннера на active. */
  const reloadCounts = useCallback(async () => {
    if (!userId || !canManage) return;
    try {
      const [archived, trashed] = await Promise.all([
        api.listProjectsByBucket(userId, 'archived'),
        api.listProjectsByBucket(userId, 'trashed'),
      ]);
      setArchivedCount(archived.length);
      setTrashedCount(trashed.length);
      countsLoadedRef.current = true;
    } catch {
      /* noop — бейджи останутся 0 */
    }
  }, [userId, canManage]);

  useEffect(() => {
    reload().catch(() => {});
  }, [reload]);

  useEffect(() => {
    if (!userId || !canManage) {
      countsLoadedRef.current = false;
      return;
    }
    countsLoadedRef.current = false;
    const t = setTimeout(() => {
      reloadCounts().catch(() => {});
    }, 0);
    return () => clearTimeout(t);
  }, [userId, canManage, reloadCounts]);

  const reloadAll = useCallback(async () => {
    await Promise.all([reload(), canManage ? reloadCounts() : Promise.resolve()]);
  }, [reload, reloadCounts, canManage]);

  return {
    bucket,
    setBucket,
    items,
    archivedCount,
    trashedCount,
    loading,
    reload: reloadAll,
  };
}
