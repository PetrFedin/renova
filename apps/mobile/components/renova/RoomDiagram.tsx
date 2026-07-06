/** 2D-схема комнаты: стены + розетки */
import { View, Text, StyleSheet } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { Room } from '@/lib/api';

export function RoomDiagram({ room }: { room: Room }) {
  const ow = 200, oh = 140;
  const sx = ow / Math.max(room.length_m, 0.1), sy = oh / Math.max(room.width_m, 0.1);
  const dots = Array.from({ length: Math.min(room.outlets_count, 24) }, (_, i) => ({
    x: 12 + (i % 6) * (ow - 24) / 5,
    y: 12 + Math.floor(i / 6) * (oh - 24) / 3,
  }));
  return (
    <View style={s.wrap}>
      <Text style={s.head}>Схема · {room.length_m}×{room.width_m} м</Text>
      <View style={[s.room, { width: ow, height: oh }]}>
        {dots.map((d, i) => <View key={i} style={[s.outlet, { left: d.x, top: d.y }]} />)}
        {room.plumbing_points > 0 && <View style={s.plumb}><Text style={s.plumbT}>💧</Text></View>}
      </View>
      <Text style={s.legend}>● розетки ({room.outlets_count}) · 💧 сантехника ({room.plumbing_points})</Text>
    </View>
  );
}
const s = StyleSheet.create({
  wrap:{ backgroundColor:RenovaTheme.colors.surface, borderRadius:12, padding:12, marginBottom:10 },
  head:{ fontWeight:'700', marginBottom:8 },
  room:{ borderWidth:2, borderColor:'#374151', backgroundColor:'#f9fafb', borderRadius:4, position:'relative' },
  outlet:{ position:'absolute', width:8, height:8, borderRadius:4, backgroundColor:'#f59e0b' },
  plumb:{ position:'absolute', right:8, bottom:8 }, plumbT:{ fontSize:16 },
  legend:{ fontSize:11, color:'#6b7280', marginTop:6 },
});
