import { View, Text, Pressable, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { formatRub, RenovaTheme, card } from '@/constants/Theme';

export type BudgetAlert = { room_id: string; room_name: string; plan: number; fact: number; over_pct?: number };

export function BudgetAlerts({ items, returnTo }: { items: BudgetAlert[]; returnTo?: string }) {
  const over = items.filter(i => i.fact > i.plan && i.plan > 0);
  if (!over.length) return null;
  const back = returnTo || '/';
  return (
    <View style={s.box}>
      <Text style={s.head}>Бюджет · превышение ({over.length})</Text>
      {over.map(i => (
        <Pressable
          key={i.room_id}
          style={s.row}
          onPress={() => router.push({ pathname: `/room/${i.room_id}`, params: { overrun: '1', returnTo: back } } as any)}
        >
          <Text style={s.n}>{i.room_name}</Text>
          <Text style={s.v}>+{formatRub(i.fact - i.plan)}</Text>
        </Pressable>
      ))}
    </View>
  );
}
const s = StyleSheet.create({
  box: { ...card, borderLeftWidth: 3, borderLeftColor: RenovaTheme.colors.danger },
  head: { fontWeight: '600', fontSize: RenovaTheme.fontSize.caption, color: RenovaTheme.colors.textMuted, marginBottom: 6 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderTopWidth: 1, borderTopColor: RenovaTheme.colors.borderLight },
  n: { fontWeight: '500', color: RenovaTheme.colors.text },
  v: { color: RenovaTheme.colors.danger, fontWeight: '600', fontSize: RenovaTheme.fontSize.caption },
});
