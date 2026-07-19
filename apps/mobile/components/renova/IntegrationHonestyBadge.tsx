/** Честный статус интеграций на Home — без ложных «live» (W44). */
import { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { api } from '@/lib/api';
import { useRenova } from '@/lib/context/RenovaContext';

type Chip = { id: string; label: string; ok: boolean };

export function IntegrationHonestyBadge() {
  const { user } = useRenova();
  const [chips, setChips] = useState<Chip[]>([]);

  useEffect(() => {
    if (!user?.id) return;
    let alive = true;
    (async () => {
      const [y, f, e] = await Promise.all([
        api.getYookassaHealth(user.id).catch(() => null),
        api.getFnsHealth(user.id).catch(() => null),
        api.getEsignHealth(user.id).catch(() => null),
      ]);
      if (!alive) return;

      const yLive = Boolean(y && ((y as { live_checkout_ready?: boolean }).live_checkout_ready
        || (y as { configured?: boolean }).configured));
      const fLive = Boolean((f as { live_verify_ready?: boolean } | null)?.live_verify_ready);
      const providers = (e as { providers?: { available?: boolean }[] } | null)?.providers;
      const eLive = Boolean(providers?.some((p) => p?.available));

      setChips([
        { id: 'pay', label: yLive ? 'ЮKassa: live' : 'ЮKassa: demo/off', ok: yLive },
        { id: 'fns', label: fLive ? 'ФНС: live' : 'ФНС: offline', ok: fLive },
        { id: 'sign', label: eLive ? 'Kontur: on' : 'Подпись: in_app', ok: eLive },
      ]);
    })();
    return () => { alive = false; };
  }, [user?.id]);

  if (!chips.length) return null;

  return (
    <View style={s.wrap} accessibilityLabel="Статус интеграций">
      {chips.map((c) => (
        <View key={c.id} style={[s.chip, c.ok ? s.ok : s.warn]}>
          <Text style={s.txt}>{c.label}</Text>
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  chip: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  ok: { backgroundColor: 'rgba(34,140,80,0.12)' },
  warn: { backgroundColor: 'rgba(160,120,40,0.12)' },
  txt: { fontSize: 11, fontWeight: '600', color: RenovaTheme.colors.textMuted },
});
