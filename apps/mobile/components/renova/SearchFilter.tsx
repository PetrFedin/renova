import { TextInput, View, Text, Pressable, StyleSheet } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';

type Props = {
  query: string;
  onQuery: (q: string) => void;
  filters?: { key: string; label: string }[];
  active?: string;
  onFilter?: (k: string) => void;
};

export function SearchFilter({ query, onQuery, filters, active, onFilter }: Props) {
  return (
    <View style={s.wrap}>
      <TextInput style={s.input} placeholder="Поиск…" value={query} onChangeText={onQuery} />
      {filters && onFilter && (
        <View style={s.row}>
          {filters.map((f) => (
            <Pressable key={f.key} style={[s.chip, active === f.key && s.chipOn]} onPress={() => onFilter(f.key)}>
              <Text style={[s.chipT, active === f.key && s.chipTOn]}>{f.label}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginBottom: 10 },
  input: { backgroundColor: RenovaTheme.colors.surface, borderRadius: 10, padding: 10, borderWidth: 1, borderColor: RenovaTheme.colors.border, marginBottom: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, backgroundColor: RenovaTheme.colors.border },
  chipOn: { backgroundColor: RenovaTheme.colors.primary },
  chipT: { fontSize: 12, fontWeight: '600', color: '#444' },
  chipTOn: { color: RenovaTheme.colors.surface },
});
