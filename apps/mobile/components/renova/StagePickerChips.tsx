/** Выбор этапа для чека */
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Stage } from '@/lib/api';
import { RenovaTheme } from '@/constants/Theme';

export function StagePickerChips({ stages, value, onChange }: { stages: Stage[]; value?: string | null; onChange: (id: string | null) => void }) {
  if (!stages.length) return null;
  return (
    <View style={s.wrap}>
      <Text style={s.lbl}>Этап (необязательно)</Text>
      <View style={s.row}>
        <Pressable style={[s.chip, !value && s.on]} onPress={() => onChange(null)}>
          <Text style={[s.txt, !value && s.txtOn]}>Без этапа</Text>
        </Pressable>
        {stages.map((st) => (
          <Pressable key={st.id} style={[s.chip, value === st.id && s.on]} onPress={() => onChange(st.id)}>
            <Text style={[s.txt, value === st.id && s.txtOn]} numberOfLines={1}>{st.name}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
const s = StyleSheet.create({
  wrap: { marginBottom: 10 }, lbl: { fontSize: 12, fontWeight: '600', color: RenovaTheme.colors.textMuted, marginBottom: 6 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, backgroundColor: RenovaTheme.colors.border, maxWidth: 140 },
  on: { backgroundColor: RenovaTheme.colors.primary }, txt: { fontWeight: '700', fontSize: 11, color: '#333' }, txtOn: { color: RenovaTheme.colors.surface },
});
