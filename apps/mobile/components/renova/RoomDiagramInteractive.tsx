/** Drag розеток на схеме */
import { useEffect, useState } from 'react';
import { RenovaTheme } from '@/constants/Theme';
import { View, Text, Pressable, StyleSheet, PanResponder } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Room } from '@/lib/api';

type Pt = { x: number; y: number };
const OW = 200, OH = 140;
const GRID = 10;

export function RoomDiagramInteractive({ room }: { room: Room }) {
  const [pts, setPts] = useState<Pt[]>([]);
  const [drag, setDrag] = useState<number | null>(null);
  const key = `renova_outlet_layout_${room.id}`;
  useEffect(() => { AsyncStorage.getItem(key).then(r => r && setPts(JSON.parse(r))); }, [room.id]);
  const save = async (next: Pt[]) => { setPts(next); await AsyncStorage.setItem(key, JSON.stringify(next)); };

  const pan = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderGrant: (e) => {
      const { locationX: x, locationY: y } = e.nativeEvent;
      const i = pts.findIndex(p => Math.hypot(p.x - x, p.y - y) < 14);
      setDrag(i >= 0 ? i : null);
      if (i < 0 && pts.length < (room.outlets_count || 24)) save([...pts, { x, y }]);
    },
    onPanResponderMove: (e) => {
      if (drag === null) return;
      const { locationX: x, locationY: y } = e.nativeEvent;
      const next = [...pts]; next[drag] = { x: Math.max(0, Math.min(OW, x)), y: Math.max(0, Math.min(OH, y)) };
      setPts(next);
    },
    onPanResponderRelease: () => { if (drag !== null) { const snapped = pts.map(p => ({ x: Math.round(p.x/10)*10, y: Math.round(p.y/10)*10 })); save(snapped); } setDrag(null); },
  });

  return (
    <View style={s.wrap}>
      <Text style={s.head}>Схема · tap/drag розетки ({pts.length}/{room.outlets_count})</Text>
      <View {...pan.panHandlers} style={[s.room, { width: OW, height: OH }]}>
        {Array.from({ length: Math.floor(OH/GRID)+1 }, (_, gy) => Array.from({ length: Math.floor(OW/GRID)+1 }, (_, gx) => (
          <View key={`g${gx}-${gy}`} style={[s.gridPt, { left: gx*GRID, top: gy*GRID }]} />
        )))}
        <Text style={[s.dimLbl, { top: 2, left: 4 }]}>{room.length_m}м</Text>
        <Text style={[s.dimLbl, { bottom: 2, right: 4 }]}>{room.width_m}м</Text>
        {pts.map((p, i) => <View key={i} style={[s.dot, drag === i && s.dotActive, { left: p.x - 5, top: p.y - 5 }]} />)}
      </View>
      <Pressable onPress={() => { setPts([]); AsyncStorage.removeItem(key); }}><Text style={s.clr}>Сбросить</Text></Pressable>
    </View>
  );
}
const s = StyleSheet.create({
  wrap:{ backgroundColor:RenovaTheme.colors.surface, borderRadius:12, padding:12, marginBottom:10 },
  head:{ fontWeight:'700', marginBottom:8 }, room:{ borderWidth:2, borderColor:'#374151', backgroundColor:'#f9fafb' },
  dot:{ position:'absolute', width:10, height:10, borderRadius:5, backgroundColor:'#f59e0b' },
  dotActive:{ backgroundColor:'#ef4444', transform:[{ scale:1.3 }] }, clr:{ color:'#2563eb', marginTop:6, fontSize:12 },
  gridPt:{ position:'absolute', width:1, height:1, backgroundColor:'#d1d5db' },
  dimLbl:{ position:'absolute', fontSize:9, color:'#6b7280', fontWeight:'600' },
});
