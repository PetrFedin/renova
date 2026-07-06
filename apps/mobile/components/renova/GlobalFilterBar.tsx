import { View, Text, Pressable, StyleSheet } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { WorkTypeFilter } from '@/components/renova/WorkTypeFilter';

const KINDS = [{ k: '', l: 'Все' }, { k: 'material', l: 'Материалы' }, { k: 'approval', l: 'Согласования' }, { k: 'design', l: 'Дизайн' }];

export function GlobalFilterBar({ kind, workType, onKind, onWorkType }: { kind?: string; workType?: string; onKind: (k?: string) => void; onWorkType: (w?: string) => void }) {
  return (
    <View style={s.box}>
      <Text style={s.lbl}>Фильтры</Text>
      <View style={s.row}>{KINDS.map(x => (
        <Pressable key={x.k || 'all'} style={[s.chip, kind === x.k && s.on]} onPress={() => onKind(x.k || undefined)}>
          <Text style={kind === x.k ? s.onT : s.t}>{x.l}</Text>
        </Pressable>
      ))}</View>
      <WorkTypeFilter value={workType} onChange={onWorkType} />
    </View>
  );
}
const s = StyleSheet.create({ box:{ marginVertical:6 }, lbl:{ fontWeight:'700', fontSize:12, marginBottom:4 }, row:{ flexDirection:'row', flexWrap:'wrap', gap:6, marginBottom:6 }, chip:{ paddingHorizontal:8, paddingVertical:4, borderRadius:12, backgroundColor:RenovaTheme.colors.surfaceMuted }, on:{ backgroundColor:'#dbeafe' }, t:{ fontSize:11 }, onT:{ fontSize:11, fontWeight:'700', color:'#1d4ed8' } });
