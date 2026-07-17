import { useCallback, useEffect, useState } from 'react';
import { api, type ProjectSummary } from '@/lib/api';
import type { ProjectBucket } from '@/components/renova/ProjectBucketToolbar';

export function useProjectBuckets(userId: string | undefined, canManage: boolean) {
  const [bucket, setBucket] = useState<ProjectBucket>('active');
  const [items, setItems] = useState<ProjectSummary[]>([]);
  const [archivedCount, setArchivedCount] = useState(0);
  const [trashedCount, setTrashedCount] = useState(0);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const list = await api.listProjectsByBucket(userId, bucket);
      setItems(list);
      if (canManage) {
        const [archived, trashed] = await Promise.all([
          api.listProjectsByBucket(userId, 'archived'),
          api.listProjectsByBucket(userId, 'trashed'),
        ]);
        setArchivedCount(archived.length);
        setTrashedCount(trashed.length);
      }
    } finally {
      setLoading(false);
    }
  }, [userId, bucket, canManage]);

  useEffect(() => {
    reload().catch(() => {});
  }, [reload]);

  return { bucket, setBucket, items, archivedCount, trashedCount, loading, reload };
}
