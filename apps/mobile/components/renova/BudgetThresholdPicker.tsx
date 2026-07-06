import { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { getBudgetThreshold, setBudgetThreshold } from '@/lib/budgetThreshold';

const OPT = [5, 10, 15, 20];

export function BudgetThresholdPicker({ embedded }: { embedded?: boolean }) {
  const [pct, setPct] = useState(10);
  useEffect(() => {
    getBudgetThreshold().then(setPct);
  }, []);

  return (
    <View style={[s.wrap, embedded && s.embedded]}>
      <Text style={embedded ? s.subHead : s.lbl}>Алерт бюджета +</Text>
      <View style={s.chips}>
        {OPT.map((o) => (
          <Pressable
            key={o}
            style={[s.chip, pct === o && s.on]}
            onPress={async () => {
              await setBudgetThreshold(o);
              setPct(o);
            }}
          >
            <Text style={[s.t, pct === o && s.tOn]}>{o}%</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    marginTop: 8,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: RenovaTheme.colors.border,
  },
  embedded: { marginTop: 4 },
  lbl: { fontSize: 14, fontWeight: '700', color: RenovaTheme.colors.text, marginBottom: 8 },
  subHead: { fontSize: 14, fontWeight: '700', color: RenovaTheme.colors.text, marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: RenovaTheme.radius.full,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
  },
  on: { backgroundColor: '#FEE2E2', borderColor: '#DC2626' },
  t: { fontSize: 13, fontWeight: '600', color: RenovaTheme.colors.text },
  tOn: { color: '#B91C1C' },
});
