import { View, Text, StyleSheet } from 'react-native';
import { RenovaTheme, formatRub } from '@/constants/Theme';

export function KPITrends({ points }: { points: { id?: string; label: string; margin: number }[] }) {
  if (points.length < 2) return null;
  const max = Math.max(...points.map(p => Math.abs(p.margin)), 1);
  return (
    <View style={s.box}>
      <Text style={s.head}>Динамика маржи</Text>
      {points.map((p, i) => (
        <View key={p.id ?? `${p.label}-${i}`} style={s.row}>
          <Text style={s.l}>{p.label}</Text>
          <View style={s.bar}><View style={[s.fill, { width: `${Math.round(Math.abs(p.margin)/max*100)}%`, backgroundColor: p.margin >= 0 ? '#22c55e' : '#ef4444' }]} /></View>
          <Text style={s.v}>{formatRub(p.margin)}</Text>
        </View>
      ))}
    </View>
  );
}
const s = StyleSheet.create({
  box:{ backgroundColor:RenovaTheme.colors.surface, borderRadius:12, padding:12, marginBottom:12 },
  head:{ fontWeight:'800', marginBottom:8 },
  row:{ flexDirection:'row', alignItems:'center', gap:6, marginBottom:6 },
  l:{ width:64, fontSize:10 }, bar:{ flex:1, height:6, backgroundColor:RenovaTheme.colors.border, borderRadius:3 },
  fill:{ height:6, borderRadius:3 }, v:{ width:64, fontSize:10, textAlign:'right' },
});
