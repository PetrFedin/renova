import { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { RenovaTheme } from '@/constants/Theme';

export function OnboardingHint({ id, text }: { id: string; text: string }) {
  const [show, setShow] = useState(false);
  useEffect(() => { AsyncStorage.getItem(`renova_hint_${id}`).then((v) => { if (!v) setShow(true); }); }, [id]);
  if (!show) return null;
  return (
    <View style={s.box}>
      <Text style={s.txt}>{text}</Text>
      <Pressable onPress={() => { AsyncStorage.setItem(`renova_hint_${id}`, '1'); setShow(false); }}>
        <Text style={s.ok}>Понятно</Text>
      </Pressable>
    </View>
  );
}
const s = StyleSheet.create({
  box: { backgroundColor: RenovaTheme.colors.surface, borderRadius: RenovaTheme.radius.md, padding: 10, marginBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: RenovaTheme.colors.border },
  txt: { flex: 1, fontSize: RenovaTheme.fontSize.caption, color: RenovaTheme.colors.textMuted, lineHeight: 17 },
  ok: { color: RenovaTheme.colors.text, fontWeight: '600', fontSize: RenovaTheme.fontSize.caption },
});
