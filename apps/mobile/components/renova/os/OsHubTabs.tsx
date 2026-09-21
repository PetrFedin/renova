/** Горизонтальные вкладки hub — Clarity C: underline, не pill-карточки */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, Pressable, Text, StyleSheet, View } from 'react-native';
import type { LayoutChangeEvent } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';

export type HubTab = {
  id: string;
  label: string;
  badge?: number;
  /** Progressive disclosure — вторичные вкладки за «Все» */
  secondary?: boolean;
};

type Props = {
  tabs: HubTab[];
  value: string;
  onChange: (id: string) => void;
};

export function OsHubTabs({ tabs, value, onChange }: Props) {
  const primary = useMemo(() => tabs.filter((t) => !t.secondary), [tabs]);
  const secondary = useMemo(() => tabs.filter((t) => t.secondary), [tabs]);
  const valueIsSecondary = secondary.some((t) => t.id === value);
  const [moreOpen, setMoreOpen] = useState(valueIsSecondary);

  const expanded = moreOpen || valueIsSecondary;
  const visible = expanded || secondary.length === 0 ? tabs : primary;

  /**
   * Подкрутка к выбранной вкладке.
   *
   * Ряд вкладок прокручивается вбок, и на экране айфона (375 pt) последняя не
   * помещается. Выбранной она при этом быть может: открываешь «Деньги» —
   * активны «Отклонения», а видно от них полторы буквы, и подсказки, что ряд
   * прокручивается, нет никакой.
   */
  const scroller = useRef<ScrollView>(null);
  const layouts = useRef<Record<string, { x: number; width: number }>>({});
  const viewport = useRef(0);
  const offset = useRef(0);

  // `revealSelected` объявлена ниже и зовётся из замера вкладки. Держим её в
  // ref: иначе обработчик замера пришлось бы пересоздавать на каждый рендер,
  // а это новый `onLayout` у каждой вкладки и лишний круг замеров.
  const reveal = useRef<() => void>(() => {});

  const onTabLayout = useCallback(
    (id: string) => (e: LayoutChangeEvent) => {
      const { x, width } = e.nativeEvent.layout;
      layouts.current[id] = { x, width };
      // Замер вкладок приходит **после** замера контейнера: если не позвать
      // подкрутку отсюда, звать её будет уже некому, и выбранная вкладка
      // останется за обрезом — ровно то, что и было видно на экране.
      reveal.current();
    },
    [],
  );

  const revealSelected = useCallback(() => {
    const box = layouts.current[value];
    const width = viewport.current;
    // Пока замеров нет, двигать нечего: первый onLayout позовёт снова.
    if (!box || width <= 0) return;
    const left = box.x - GUTTER;
    const right = box.x + box.width + GUTTER;
    let next = offset.current;
    if (right > offset.current + width) next = right - width;
    if (left < next) next = left;
    next = Math.max(0, next);
    if (Math.abs(next - offset.current) < 1) return;
    offset.current = next;
    scroller.current?.scrollTo({ x: next, animated: true });
  }, [value]);

  reveal.current = revealSelected;

  useEffect(revealSelected, [revealSelected, visible.length]);

  return (
    <View style={s.wrap}>
      <ScrollView
        ref={scroller}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.row}
        onLayout={(e) => {
          viewport.current = e.nativeEvent.layout.width;
          revealSelected();
        }}
        onScroll={(e) => {
          offset.current = e.nativeEvent.contentOffset.x;
        }}
        scrollEventThrottle={16}
      >
        {visible.map((t) => {
          const on = t.id === value;
          return (
            <Pressable
              key={t.id}
              style={[s.tab, on && s.tabOn]}
              onLayout={onTabLayout(t.id)}
              onPress={() => onChange(t.id)}
              accessibilityRole="tab"
              // Роль была, имени не было: читалка объявляла «вкладка» столько
              // раз, сколько их в ряду, и ни одной не называла. Счётчик входит
              // в имя — иначе о нём не узнать вовсе.
              accessibilityLabel={
                t.badge != null && t.badge > 0 ? `${t.label}, ${t.badge}` : t.label
              }
              accessibilityState={{ selected: on }}
            >
              <Text style={[s.label, on && s.labelOn]}>{t.label}</Text>
              {t.badge != null && t.badge > 0 ? (
                <View style={s.badge}>
                  <Text style={s.badgeT}>{t.badge > 9 ? '9+' : t.badge}</Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
        {secondary.length > 0 && !expanded ? (
          <Pressable
            style={s.tab}
            onPress={() => setMoreOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Все вкладки"
          >
            <Text style={s.label}>Все</Text>
            {secondary.some((t) => (t.badge ?? 0) > 0) ? (
              <View style={s.badge}>
                <Text style={s.badgeT}>
                  {(() => {
                    const n = secondary.reduce((sum, t) => sum + (t.badge ?? 0), 0);
                    return n > 9 ? '9+' : String(n);
                  })()}
                </Text>
              </View>
            ) : null}
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}

/** Запас по краям, чтобы выбранная вкладка не липла к обрезу. */
const GUTTER = 12;

const s = StyleSheet.create({
  wrap: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: RenovaTheme.colors.border,
    backgroundColor: RenovaTheme.colors.surface,
  },
  row: { paddingHorizontal: 8, paddingTop: 4, gap: 4 },
  tab: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabOn: { borderBottomColor: RenovaTheme.colors.primary },
  label: { fontSize: 14, fontWeight: '500', color: RenovaTheme.colors.textMuted },
  labelOn: { color: RenovaTheme.colors.text, fontWeight: '700' },
  badge: {
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: RenovaTheme.colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeT: { fontSize: 9, fontWeight: '800', color: RenovaTheme.colors.surface },
});
