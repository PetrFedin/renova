/** P1.14: живой статус «кэш устарел» — общий источник для DataStatusBanner и экранов,
 * которым нужно не дублировать это же предупреждение своим собственным баннером. */
import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { getStaleCachePaths } from '@/lib/api/client';

export function useStaleCacheStatus() {
  const [stalePaths, setStalePaths] = useState<string[]>([]);

  const refresh = useCallback(() => {
    // Спрашиваем про все пути, а не про «последний ответ»: свежий ответ по
    // одному пути не отменяет устаревших данных по другому (#317).
    setStalePaths(getStaleCachePaths());
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
      const id = setInterval(refresh, 4000);
      return () => clearInterval(id);
    }, [refresh]),
  );

  return { stalePaths, isStale: stalePaths.length > 0, refresh };
}
