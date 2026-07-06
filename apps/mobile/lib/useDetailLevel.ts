import { useCallback, useEffect, useState } from 'react';
import { getDetailLevel, subscribeDetailLevel, type DetailLevel } from '@/lib/detailLevel';

export function useDetailLevel(): DetailLevel {
  const [level, setLevel] = useState<DetailLevel>('standard');

  const reload = useCallback(() => {
    getDetailLevel().then(setLevel).catch(() => {});
  }, []);

  useEffect(() => {
    reload();
    return subscribeDetailLevel(reload);
  }, [reload]);

  return level;
}
