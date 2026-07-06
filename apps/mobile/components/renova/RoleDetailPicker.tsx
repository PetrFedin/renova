import { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { DetailLevel, getDetailLevel, setDetailLevel } from '@/lib/detailLevel';
import { RenovaTheme } from '@/constants/Theme';

const OPT: DetailLevel[] = ['brief', 'standard', 'detailed'];
const LBL: Record<DetailLevel, string> = { brief: 'Кратко', standard: 'Стандарт', detailed: 'Подробно' };

/** Базовый уровень детализации для роли (заказчик / исполнитель). */
export function RoleDetailPicker({ role }: { role: 'customer' | 'contractor' }) {
  const [level, setLevel] = useState<DetailLevel>('standard');
  useEffect(() => { getDetailLevel().then(setLevel); }, []);
  return (
    <View style={s.box}>
      <Text style={s.head}>Детализация · {role === 'customer' ? 'заказчик' : 'исполнитель'}</Text>
      <View style={s.row}>
        {OPT.map(o => (
          <Pressable key={o} style={[s.chip, level === o && s.on]} onPress={async () => { await setDetailLevel(o); setLevel(o); }}>
            <Text style={[s.t, level === o && s.tOn]}>{LBL[o]}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
const s = StyleSheet.create({
  box: { marginVertical: 8 },
  head: { fontWeight: '700', fontSize: 12, marginBottom: 6 },
  row: { flexDirection: 'row', gap: 6 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, backgroundColor: RenovaTheme.colors.border },
  on: { backgroundColor: RenovaTheme.colors.primary },
  t: { fontSize: 12, fontWeight: '600' },
  tOn: { color: RenovaTheme.colors.surface },
});
