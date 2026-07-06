import { View, Text, Image, StyleSheet } from 'react-native';

type Photo = { id: string; caption: string | null; image_url?: string };

export function PhotoCompare({ before, after }: { before: Photo[]; after: Photo[] }) {
  const b = before[0];
  const a = after[0];
  if (!b && !a) return null;
  return (
    <View style={s.wrap}>
      <Text style={s.head}>Сравнение до / после</Text>
      <View style={s.row}>
        <View style={s.col}>{b?.image_url ? <Image source={{ uri: b.image_url }} style={s.img} /> : <Text style={s.empty}>Нет «до»</Text>}<Text style={s.cap}>До</Text></View>
        <View style={s.col}>{a?.image_url ? <Image source={{ uri: a.image_url }} style={s.img} /> : <Text style={s.empty}>Нет «после»</Text>}<Text style={s.cap}>После</Text></View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { backgroundColor: '#fff', borderRadius: 12, padding: 12, marginVertical: 8 },
  head: { fontWeight: '700', marginBottom: 8 },
  row: { flexDirection: 'row', gap: 8 },
  col: { flex: 1 },
  img: { width: '100%', height: 120, borderRadius: 8 },
  empty: { height: 120, textAlign: 'center', lineHeight: 120, backgroundColor: '#f3f4f6', borderRadius: 8, color: '#888' },
  cap: { textAlign: 'center', marginTop: 4, fontWeight: '600', fontSize: 12 },
});
