import { Text, View, StyleSheet } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';

export function ReactionAvatars({ reactions }: { reactions: { user_id: string; reaction: string }[] }) {
  if (!reactions.length) return null;
  const grouped = reactions.reduce((a, r) => { (a[r.reaction] ||= []).push(r.user_id.slice(0, 4)); return a; }, {} as Record<string, string[]>);
  return (
    <View style={s.row}>{Object.entries(grouped).map(([emoji, ids]) => (
      <Text key={emoji} style={s.tag}>{emoji} {ids.join(', ')}</Text>
    ))}</View>
  );
}
const s = StyleSheet.create({ row:{ flexDirection:'row', flexWrap:'wrap', gap:4, marginTop:4 }, tag:{ fontSize:10, backgroundColor:RenovaTheme.colors.surfaceMuted, paddingHorizontal:6, paddingVertical:2, borderRadius:8 } });
