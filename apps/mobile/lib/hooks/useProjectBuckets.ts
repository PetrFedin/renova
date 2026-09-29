/** Архив/корзина: список только для выбранного bucket; counts — отложенно (не блокируют UI). */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type ProjectSummary } from '@/lib/api';
import type { ProjectBucket } from '@/components/renova/ProjectBucketToolbar';
import { reportError } from '@/lib/reportError';
import { nextBucketCount } from '@/lib/domain/bucketCountRead';

export function useProjectBuckets(userId: string | undefined, canManage: boolean) {
  const [bucket, setBucket] = useState<ProjectBucket>('active');
  const [items, setItems] = useState<ProjectSummary[]>([]);
  // null = unknown (not yet loaded, or the last read failed) — never fabricate a confirmed 0.
  const [archivedCount, setArchivedCount] = useState<number | null>(null);
  const [trashedCount, setTrashedCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [itemsError, setItemsError] = useState(false);
  const [countsError, setCountsError] = useState(false);
  const countsLoadedRef = useRef(false);

  /** Список архива/корзины — только когда пользователь открыл эту вкладку (active берётся из context). */
  const reload = useCallback(async () => {
    if (!userId) return;
    if (bucket === 'active') {
      setItems([]);
      setLoading(false);
      setItemsError(false);
      return;
    }
    setLoading(true);
    try {
      const list = await api.listProjectsByBucket(userId, bucket);
      setItems(list);
      setItemsError(false);
      if (bucket === 'archived') setArchivedCount(nextBucketCount(archivedCount, { ok: true, count: list.length }));
      if (bucket === 'trashed') setTrashedCount(nextBucketCount(trashedCount, { ok: true, count: list.length }));
    } catch (error) {
      // A failed list read must not render as an empty bucket — keep prior items (stale)
      // and let the caller show an explicit error instead of a fabricated "пусто".
      reportError('projectBuckets.reload', error, { userId, bucket });
      setItemsError(true);
    } finally {
      setLoading(false);
    }
  }, [userId, bucket, archivedCount, trashedCount]);

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
      setCountsError(false);
      countsLoadedRef.current = true;
    } catch (error) {
      // Read failure is unknown, not zero — preserve whatever count (confirmed or still
      // unknown) we already had rather than collapsing the badge to a fabricated 0.
      reportError('projectBuckets.counts', error, { userId });
      setCountsError(true);
    }
  }, [userId, canManage]);

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, bucket]);

  useEffect(() => {
    if (!userId || !canManage) {
      countsLoadedRef.current = false;
      return;
    }
    countsLoadedRef.current = false;
    const t = setTimeout(() => {
      void reloadCounts();
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
    itemsError,
    countsError,
    reload: reloadAll,
  };
}
