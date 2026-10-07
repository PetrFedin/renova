/** Сетка виджетов 2×N — без горизонтальной прокрутки */
import { useState, type ReactNode } from 'react';
import { Platform, View, Text, StyleSheet, Pressable, useWindowDimensions } from 'react-native';
import { pushOsHrefWithReturn } from '@/lib/osTabNav';
import { pushOsNav } from '@/lib/pushOsNav';
import { RenovaTheme } from '@/constants/Theme';
import { homeLayout, homeTypography } from '@/constants/homeTypography';
import { screenTypography, listRowStyles } from '@/constants/screenTypography';
import type { OsRole, OsTabRoute } from '@/constants/osSections';

export type OsWidget = {
  id: string;
  label: string;
  value: string;
  hint?: string;
  href?: string | OsTabRoute;
  accent?: string;
  /** @deprecated сетка сама задаёт ширину */
  width?: number;
};

function chunk<T>(arr: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < arr.length; i += size) rows.push(arr.slice(i, i + size));
  return rows;
}

function WidgetCell({
  it,
  returnTo,
  role,
  onWidgetPress,
}: {
  it: OsWidget;
  returnTo?: string;
  /** W114: role → resolvePushLink / TAB_ALIASES */
  role?: OsRole;
  onWidgetPress?: (it: OsWidget) => void;
}) {
  const body = (
    <View style={s.chip}>
      <Text style={s.label} numberOfLines={1}>{it.label}</Text>
      <Text style={s.value} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
        {it.value}
      </Text>
      {it.hint ? <Text style={s.hint} numberOfLines={1}>{it.hint}</Text> : null}
    </View>
  );
  const onPress = onWidgetPress
    ? () => onWidgetPress(it)
    : it.href
      ? () => (returnTo
        ? pushOsHrefWithReturn(it.href!, returnTo, role)
        : pushOsNav(it.href!, undefined, role))
      : undefined;

  if (onPress) {
    return (
      <Pressable
        testID="os-widget-cell"
        style={s.cell}
        onPress={onPress}
        accessibilityRole="button"
        // Роль была, имени не было: плитка читалась как безымянная кнопка.
        // Произносим то же, что видит глаз: подпись, значение, пояснение.
        accessibilityLabel={[it.label, it.value, it.hint]
          // Прочерк — это «нет данных» для глаза; читалке его произносить незачем.
          .filter((part) => part && part !== '—' && part !== '-')
          .join(' · ')}
      >
        {body}
      </Pressable>
    );
  }
  return <View testID="os-widget-cell" style={s.cell}>{body}</View>;
}

/** Два виджета в строке — основной layout KPI */
export function OsWidgetGrid({
  items,
  title,
  columns,
  returnTo,
  role,
  onWidgetPress,
}: {
  items: OsWidget[];
  title?: string;
  columns?: number;
  returnTo?: string;
  /** W114: канон deep-link для href плиток */
  role?: OsRole;
  /** Главная: sheet детализации вместо прямого перехода */
  onWidgetPress?: (it: OsWidget) => void;
}) {
  const { width } = useWindowDimensions();
  const [containerWidth, setContainerWidth] = useState<number | null>(null);
  if (!items.length) return null;
  const availableWidth = containerWidth ?? width;
  const responsiveColumns = Platform.OS === 'web'
    ? availableWidth >= 900 ? 4 : availableWidth >= 620 ? 3 : 2
    : 2;
  const resolvedColumns = Math.max(1, columns ?? responsiveColumns);
  const rows = chunk(items, resolvedColumns);
  return (
    <View
      style={s.wrap}
      onLayout={(event: { nativeEvent: { layout: { width: number } } }) => setContainerWidth(event.nativeEvent.layout.width)}
      testID="os-widget-grid"
    >
      {title ? <Text style={[homeTypography.zoneLabel, s.title]}>{title}</Text> : null}
      {rows.map((row, ri) => (
        <View key={ri} style={s.gridRow}>
          {row.map((it) => (
            <WidgetCell key={it.id} it={it} returnTo={returnTo} role={role} onWidgetPress={onWidgetPress} />
          ))}
          {Array.from({ length: Math.max(0, resolvedColumns - row.length) }, (_, ghostIndex) => (
            <View key={`ghost-${ghostIndex}`} style={[s.cell, s.cellGhost]} />
          ))}
        </View>
      ))}
    </View>
  );
}

/** @alias OsWidgetGrid */
export const OsWidgetStrip = OsWidgetGrid;

/** Два произвольных блока в строке */
export function OsTwinRow({ left, right }: { left: ReactNode; right: ReactNode }) {
  return (
    <View style={s.twin}>
      <View style={s.twinCell}>{left}</View>
      <View style={s.twinCell}>{right}</View>
    </View>
  );
}

export function OsCompactCard({ title, children, onPress }: { title?: string; children: ReactNode; onPress?: () => void }) {
  const inner = (
    <View style={s.compact}>
      {title ? <Text style={s.compactTitle} numberOfLines={1}>{title}</Text> : null}
      {children}
    </View>
  );
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={{ flex: 1 }}
        accessibilityRole="button"
        accessibilityLabel={title}
      >
        {inner}
      </Pressable>
    );
  }
  return inner;
}

const s = StyleSheet.create({
  wrap: { marginBottom: homeLayout.innerGap },
  title: { marginBottom: homeLayout.innerGap },
  gridRow: { flexDirection: 'row', gap: homeLayout.innerGap, marginBottom: homeLayout.innerGap },
  cell: { flex: 1, minWidth: 0 },
  cellGhost: { opacity: 0 },
  // Clarity U: KPI как metricCell, не тяжёлый Theme.card
  // «Второстепенное»: без рамки, мягкая заливка, ниже и тише, чем hero
  chip: {
    ...listRowStyles.metricCell,
    minHeight: 56,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderWidth: 0,
    backgroundColor: RenovaTheme.colors.surfaceMuted,
  },
  label: { ...screenTypography.metricLabel, textTransform: 'none', letterSpacing: 0 },
  value: { ...screenTypography.metric, marginTop: 1, fontSize: 16 },
  hint: { ...homeTypography.kpiHint, marginTop: 2 },
  twin: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  twinCell: { flex: 1, minWidth: 0 },
  compact: {
    ...listRowStyles.metricCell,
    alignItems: 'stretch',
    padding: 10,
    flex: 1,
    minHeight: 76,
  },
  compactTitle: { ...screenTypography.metricLabel, marginBottom: 4 },
});
