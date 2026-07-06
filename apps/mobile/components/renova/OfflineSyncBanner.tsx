/** Баннер очереди офлайн-изменений — только для исполнителя (заказчику в demo не показываем) */
import { useCallback, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import NetInfo from '@react-native-community/netinfo';
import { RenovaTheme } from '@/constants/Theme';
import { queueStats, flush } from '@/lib/offlineQueue';
import { useNavFromHere } from '@/lib/navigation';
import { useRenova } from '@/lib/context/RenovaContext';

export function OfflineSyncBanner() {
  const nav = useNavFromHere();
  const { user } = useRenova();
  const [pending, setPending] = useState(0);
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(true);

  const reload = useCallback(async () => {
    const s = await queueStats();
    setPending(s.pending);
    const st = await NetInfo.fetch();
    setOnline(!!st.isConnected);
  }, []);

  useFocusEffect(useCallback(() => { reload().catch(() => {}); }, [reload]));

  if (user?.role === 'customer') return null;
  if (!pending) return null;

  return (
    <Pressable
      style={[s.box, !online && s.offline]}
      onPress={() => router.push({ pathname: '/conflicts', params: { returnTo: nav.from } } as any)}
    >
      <View style={{ flex: 1 }}>
        <Text style={s.title}>{online ? 'Ожидает синхронизации' : 'Офлайн · изменения в очереди'}</Text>
        <Text style={s.sub}>{pending} запрос(ов) · нажмите для разрешения конфликтов</Text>
      </View>
      {busy ? <ActivityIndicator size="small" color={RenovaTheme.colors.primary} /> : (
        <Pressable
          onPress={async (e) => {
            e.stopPropagation?.();
            setBusy(true);
            try {
              const apiBase = process.env.EXPO_PUBLIC_API_URL ?? 'http://127.0.0.1:8100';
              const r = await flush(apiBase);
              await reload();
              if (r.conflicts > 0) router.push({ pathname: '/conflicts', params: { returnTo: nav.from } } as any);
            } finally { setBusy(false); }
          }}
          style={s.btn}
        >
          <Text style={s.btnT}>Sync</Text>
        </Pressable>
      )}
    </Pressable>
  );
}

const s = StyleSheet.create({
  box: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FEF3C7', borderRadius: 10, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: '#FDE047' },
  offline: { backgroundColor: '#FEE2E2', borderColor: '#FECACA' },
  title: { fontWeight: '700', fontSize: 13, color: RenovaTheme.colors.text },
  sub: { fontSize: 11, color: RenovaTheme.colors.textMuted, marginTop: 2 },
  btn: { backgroundColor: RenovaTheme.colors.primary, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, marginLeft: 8 },
  btnT: { color: RenovaTheme.colors.surface, fontWeight: '700', fontSize: 12 },
});
