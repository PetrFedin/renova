/** P1.14/#317: баннер только по реально stale cache keys, без global last-outcome race. */
import { useCallback, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { RenovaTheme } from '@/constants/Theme';
import {
  getStaleCacheProvenance,
  subscribeCacheProvenance,
  type CachedGetMeta,
} from '@/lib/api/client';

export function StaleCacheBanner() {
  const [staleItems, setStaleItems] = useState<CachedGetMeta[]>([]);

  const refresh = useCallback(() => {
    setStaleItems(getStaleCacheProvenance());
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
      return subscribeCacheProvenance(refresh);
    }, [refresh]),
  );

  if (!staleItems.length) return null;

  const oldest = staleItems[0];
  const path = oldest?.path?.replace(/^\/api\/v1/, '') || null;
  const ageMinutes = oldest ? Math.max(0, Math.floor((Date.now() - oldest.asOf) / 60_000)) : 0;

  return (
    <View style={s.box} accessibilityRole="alert">
      <View style={{ flex: 1 }}>
        <Text style={s.title}>Данные могут быть устаревшими</Text>
        <Text style={s.sub}>
          Показан последний успешный ответ
          {path ? ` (${path})` : ''}
          {ageMinutes > 0 ? ` · актуален на ${ageMinutes} мин. назад` : ''}.
          {staleItems.length > 1 ? ` Устаревших источников: ${staleItems.length}.` : ''}
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