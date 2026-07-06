/** Сравнение объектов — кто уложился, кто перерасходил */
import { View, Text, StyleSheet } from 'react-native';
import { RenovaTheme, formatRub, card } from '@/constants/Theme';
import type { PortfolioProjectRow } from '@/lib/domain/portfolioProjects';

export function PortfolioCompareList({ rows }: { rows: PortfolioProjectRow[] }) {
  const sorted = [...rows].sort((a, b) => b.variance - a.variance);
  if (!sorted.length) return null;

  return (
    <View style={s.wrap}>
      <Text style={s.head}>Сравнение объектов</Text>
      <Text style={s.sub}>От большего перерасхода к экономии</Text>
      {sorted.map((row) => (
        <View key={row.id} style={s.row}>
          <View style={s.rowTop}>
            <Text style={s.name} numberOfLines={1}>{row.name}</Text>
            <Text
              style={[
                s.badge,
                row.status === 'over' && s.badgeBad,
                row.status === 'under' && s.badgeGood,
              ]}
            >
              {row.status === 'over' ? 'Перерасход' : row.status === 'under' ? 'Экономия' : 'По плану'}
            </Text>
          </View>
          <Text style={s.meta}>
            {formatRub(row.planned)} → {formatRub(row.spent)}
            {row.variance !== 0 ? ` · ${row.variance > 0 ? '+' : ''}${formatRub(row.variance)}` : ''}
          </Text>
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { ...card, marginBottom: 0, padding: 12 },
  head: { fontSize: 13, fontWeight: '800', color: RenovaTheme.colors.text },
  sub: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginBottom: 8 },
  row: {
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: RenovaTheme.colors.borderLight,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  name: { flex: 1, fontSize: 13, fontWeight: '700', color: RenovaTheme.colors.text },
  badge: {
    fontSize: 10,
    fontWeight: '800',
    color: RenovaTheme.colors.textMuted,
    backgroundColor: RenovaTheme.colors.neutralBg,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  badgeBad: { color: RenovaTheme.colors.dangerText, backgroundColor: RenovaTheme.colors.dangerBg },
  badgeGood: { color: RenovaTheme.colors.successText, backgroundColor: RenovaTheme.colors.successBg },
  meta: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginTop: 4 },
});
