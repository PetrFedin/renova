/** P1.14: баннер когда cachedGet отдал устаревшие данные после ошибки API */
import { useCallback, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { InfoBanner } from '@/components/ui/InfoBanner';
import { getLastCachedGetMeta } from '@/lib/api/client';

export function StaleCacheBanner() {
  const [stale, setStale] = useState(false);

  const refreshMeta = useCallback(() => {
    const meta = getLastCachedGetMeta();
    setStale(Boolean(meta?.stale));
  }, []);

  useFocusEffect(
    useCallback(() => {
      refreshMeta();
      const id = setInterval(refreshMeta, 4000);
      return () => clearInterval(id);
    }, [refreshMeta]),
  );

  if (!stale) return null;

  return (
    <View style={s.wrap} accessibilityRole="alert">
      <InfoBanner
        tone="warning"
        title="Данные могут быть устаревшими"
        message="Не удалось обновить данные. Показана последняя подтверждённая версия."
      />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    marginHorizontal: 12,
    marginTop: 8,
  },
});
