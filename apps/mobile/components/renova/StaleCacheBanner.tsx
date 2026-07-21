/** P1.14: баннер когда cachedGet отдал устаревшие данные после ошибки API */
import { useCallback, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { RenovaTheme } from '@/constants/Theme';
import { getLastCachedGetMeta } from '@/lib/api/client';

export function StaleCacheBanner() {
  const [stale, setStale] = useState(false);
  const [path, setPath] = useState<string | null>(null);

  const refresh = useCallback(() => {
    const meta = getLastCachedGetMeta();
    setStale(Boolean(meta?.stale));
    setPath(meta?.stale ? meta.path : null);
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
      const id = setInterval(refresh, 4000);
      return () => clearInterval(id);
    }, [refresh]),
  );

  if (!stale) return null;

  return (
    <View style={s.box} accessibilityRole="alert">
      <View style={{ flex: 1 }}>
        <Text style={s.title}>Данные могут быть устаревшими</Text>
        <Text style={s.sub}>
          Сервер временно недоступен или ограничил запросы
          {path ? ` (${path.replace(/^\/api\/v1/, '')})` : ''}. Показан последний успешный ответ.
        </Text>
      </View>
      <Pressable style={s.btn} onPress={refresh}>
        <Text style={s.btnT}>OK</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 12,
    marginTop: 8,
    padding: 10,
    borderRadius: 10,
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#F59E0B',
  },
  title: { fontWeight: '700', fontSize: 13, color: RenovaTheme.colors.text },
  sub: { fontSize: 11, color: RenovaTheme.colors.textMuted, marginTop: 2 },
  btn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: RenovaTheme.colors.surface,
  },
  btnT: { fontWeight: '700', fontSize: 12, color: RenovaTheme.colors.primary },
});
