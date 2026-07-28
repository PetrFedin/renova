import { TextInput, View, Text, Pressable, StyleSheet } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { filterChipStyles } from '@/constants/screenTypography';

type Props = {
  query: string;
  onQuery: (q: string) => void;
  filters?: { key: string; label: string }[];
  active?: string;
  onFilter?: (k: string) => void;
};

/** Clarity V: chips на общем filterChipStyles (не solid primary fill) */
export function SearchFilter({ query, onQuery, filters, active, onFilter }: Props) {
  return (
    <View style={s.wrap}>
      <TextInput style={s.input} placeholder="Поиск…" value={query} onChangeText={onQuery} />
      {filters && onFilter && (
        <View style={filterChipStyles.row}>
          {filters.map((f) => (
            <Pressable
              key={f.key}
              style={[filterChipStyles.chip, active === f.key && filterChipStyles.chipOn]}
              onPress={() => onFilter(f.key)}
            >
              <Text style={[filterChipStyles.chipT, active === f.key && filterChipStyles.chipTOn]}>{f.label}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginBottom: 10 },
  input: {
    backgroundColor: RenovaTheme.colors.surface,
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
    marginBottom: 8,
  },
});
