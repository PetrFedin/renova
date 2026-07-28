import { View, Text, Pressable, StyleSheet } from 'react-native';
import { formatRub, RenovaTheme } from '@/constants/Theme';
import { screenTypography, listRowStyles } from '@/constants/screenTypography';
import { pushOsNav } from '@/lib/pushOsNav';
import type { OsRole } from '@/constants/osSections';
import { useRenova } from '@/lib/context/RenovaContext';

export type BudgetAlert = { room_id: string; room_name: string; plan: number; fact: number; over_pct?: number };

/** W117: превышение бюджета → паспорт комнаты через pushOsNav SoT */
export function BudgetAlerts({
  items,
  returnTo,
  role: roleProp,
}: {
  items: BudgetAlert[];
  returnTo?: string;
  role?: OsRole;
}) {
  const { user } = useRenova();
  const role: OsRole = roleProp ?? (user?.role === 'contractor' ? 'contractor' : 'customer');
  const over = items.filter((i) => i.fact > i.plan && i.plan > 0);
  if (!over.length) return null;
  const back = returnTo || '/';
  return (
    <View style={s.box}>
      <Text style={s.head}>Бюджет · превышение ({over.length})</Text>
      {over.map((i) => (
        <Pressable
          key={i.room_id}
          style={s.row}
          onPress={() =>
            pushOsNav(
              { pathname: '/room/[id]', params: { id: i.room_id, overrun: '1' } },
              back,
              role,
            )
          }
        >
          <Text style={s.n}>{i.room_name}</Text>
          <Text style={s.v}>+{formatRub(i.fact - i.plan)}</Text>
        </Pressable>
      ))}
    </View>
  );
}
const s = StyleSheet.create({
  box: {
    ...listRowStyles.metricCell,
    alignItems: 'stretch',
    borderLeftWidth: 3,
    borderLeftColor: RenovaTheme.colors.danger,
    marginBottom: 8,
    paddingHorizontal: 12,
  },
  head: { ...screenTypography.section, marginTop: 0, marginBottom: 6 },
  row: { flexDirection: 'row', justifyContent: 'space-between', ...listRowStyles.row, paddingHorizontal: 0 },
  n: { ...screenTypography.listTitle, fontWeight: '500' },
  v: { color: RenovaTheme.colors.danger, fontWeight: '600', fontSize: RenovaTheme.fontSize.caption },
});
