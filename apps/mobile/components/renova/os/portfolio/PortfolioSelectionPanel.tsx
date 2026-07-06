/** Выбор объектов для расчёта портфеля */
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { RenovaTheme, formatRub, card } from '@/constants/Theme';
import type { PortfolioProjectRow } from '@/lib/domain/portfolioProjects';

type Props = {
  rows: PortfolioProjectRow[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
  onOpen: (id: string) => void;
  activeProjectId?: string | null;
};

export function PortfolioSelectionPanel({
  rows,
  selected,
  onToggle,
  onSelectAll,
  onClearAll,
  onOpen,
  activeProjectId,
}: Props) {
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));

  return (
    <View style={s.wrap}>
      <View style={s.headRow}>
        <Text style={s.head}>Какие объекты считать</Text>
        <Pressable onPress={() => (allSelected ? onClearAll() : onSelectAll())} hitSlop={8} accessibilityRole="button">
          <Text style={s.link}>{allSelected ? 'Снять все' : 'Выбрать все'}</Text>
        </Pressable>
      </View>

      {rows.map((row) => {
        const checked = selected.has(row.id);
        const varianceLabel = row.variance > 0
          ? `+${formatRub(row.variance)} (+${row.variancePct}%)`
          : row.variance < 0
            ? `${formatRub(row.variance)} (${row.variancePct}%)`
            : 'по плану';

        return (
          <View
            key={row.id}
            style={[s.row, checked && s.rowOn, activeProjectId === row.id && s.rowActive]}
          >
            <Pressable
              onPress={() => onToggle(row.id)}
              style={s.rowMain}
              accessibilityRole="checkbox"
              accessibilityState={{ checked }}
            >
              <Ionicons
                name={checked ? 'checkbox' : 'square-outline'}
                size={22}
                color={checked ? RenovaTheme.colors.accent : RenovaTheme.colors.textMuted}
              />
              <View style={s.body}>
                <Text style={s.name} numberOfLines={2}>{row.name}</Text>
                <Text style={s.meta} numberOfLines={1}>
                  {row.phaseLabel} · {formatRub(row.spent)} из {formatRub(row.planned)}
                </Text>
                <Text
                  style={[
                    s.variance,
                    row.status === 'over' && s.varianceBad,
                    row.status === 'under' && s.varianceGood,
                  ]}
                  numberOfLines={1}
                >
                  {row.status === 'over' ? 'Перерасход' : row.status === 'under' ? 'Экономия' : 'Бюджет'} · {varianceLabel}
                </Text>
              </View>
            </Pressable>

            <Pressable
              onPress={() => onOpen(row.id)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`Открыть ${row.name}`}
            >
              <Ionicons name="chevron-forward" size={18} color={RenovaTheme.colors.textMuted} />
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { ...card, marginBottom: 0, paddingVertical: 8 },
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  head: { fontSize: 13, fontWeight: '800', color: RenovaTheme.colors.text },
  link: { fontSize: 13, fontWeight: '700', color: RenovaTheme.colors.accent },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: RenovaTheme.colors.borderLight,
  },
  rowOn: { backgroundColor: RenovaTheme.colors.infoBg },
  rowActive: { borderLeftWidth: 3, borderLeftColor: RenovaTheme.colors.accent },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 },
  body: { flex: 1, minWidth: 0 },
  name: { fontSize: 14, fontWeight: '700', color: RenovaTheme.colors.text },
  meta: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginTop: 2 },
  variance: { fontSize: 11, color: RenovaTheme.colors.textSubtle, marginTop: 4 },
  varianceBad: { color: RenovaTheme.colors.dangerText },
  varianceGood: { color: RenovaTheme.colors.successText },
});
