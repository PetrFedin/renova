import { useState } from 'react';
import { RenovaTheme } from '@/constants/Theme';
import { Modal, View, Text, Image, Pressable, StyleSheet, Dimensions } from 'react-native';

type P = { id: string; caption: string | null; image_url?: string };
export function PhotoSwipeCompare({ before, after, visible, onClose }: { before: P[]; after: P[]; visible: boolean; onClose: () => void }) {
  const [idx, setIdx] = useState(0);
  const pool = [...before.map(p=>({...p, tag:'До'})), ...after.map(p=>({...p, tag:'После'}))];
  const cur = pool[idx];
  if (!visible) return null;
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={s.wrap}>
        <Pressable onPress={onClose}><Text style={s.close}>✕ Закрыть</Text></Pressable>
        {cur?.image_url ? <Image source={{ uri: cur.image_url }} style={s.img} resizeMode="contain" /> : <Text style={s.empty}>Нет фото</Text>}
        <Text style={s.cap}>{cur?.tag}: {cur?.caption || 'Фото'}</Text>
        <View style={s.nav}>
          <Pressable onPress={() => setIdx(i => Math.max(0, i-1))}><Text style={s.btn}>←</Text></Pressable>
          <Text>{idx+1}/{pool.length}</Text>
          <Pressable onPress={() => setIdx(i => Math.min(pool.length-1, i+1))}><Text style={s.btn}>→</Text></Pressable>
        </View>
      </View>
    </Modal>
  );
}
const s = StyleSheet.create({
  wrap: { flex:1, backgroundColor:'#000', padding:16, paddingTop:48 },
  close: { color:RenovaTheme.colors.surface, fontSize:16, marginBottom:12 },
  img: { width:'100%', height: Dimensions.get('window').height*0.6 },
  empty: { color:'#888', textAlign:'center', marginTop:80 },
  cap: { color:RenovaTheme.colors.surface, marginTop:12, textAlign:'center' },
  nav: { flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginTop:20, paddingHorizontal:40 },
  btn: { color:RenovaTheme.colors.surface, fontSize:28 },
});
