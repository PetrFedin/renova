/** Шапка экрана — проект слева, раздел по центру, панель справа */
import type { ReactNode } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { useTopInset } from '@/lib/useTopInset';

type Props = {
  /** Заголовок по центру (экран чата, комнаты и т.д.) */
  title?: string;
  subtitle?: string;
  left?: ReactNode;
  right?: ReactNode;
};

export function OsAppHeader({ title, subtitle, left, right }: Props) {
  const top = useTopInset();
  const hasCenter = Boolean(title);

  return (
    <View style={[s.wrap, { paddingTop: top + 4 }]}>
      <View style={s.row}>
        <View style={[s.sideLeft, !hasCenter && s.sideLeftWide]}>{left ?? null}</View>
        {hasCenter ? (
          <View style={s.center}>
            <Text style={s.title} numberOfLines={1}>{title}</Text>
            {subtitle ? <Text style={s.sub} numberOfLines={1}>{subtitle}</Text> : null}
          </View>
        ) : null}
        <View style={s.sideRight}>{right ?? null}</View>
      </View>
    </View>
  );
}

/** Текст названия проекта для левой части шапки вкладок */
export function OsHeaderProjectName({ name }: { name: string }) {
  return <Text style={s.projectName} numberOfLines={1}>{name}</Text>;
}

const s = StyleSheet.create({
  wrap: {
    backgroundColor: RenovaTheme.colors.background,
    borderBottomWidth: 1,
    borderBottomColor: RenovaTheme.colors.border,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    paddingHorizontal: 12,
    paddingBottom: 8,
    gap: 8,
  },
  sideLeft: { width: 96, minWidth: 72, flexDirection: 'row', alignItems: 'center' },
  sideLeftWide: { flex: 1, width: undefined, minWidth: 0 },
  sideRight: { minWidth: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' },
  center: { flex: 1, alignItems: 'center', paddingHorizontal: 4, minWidth: 0 },
  projectName: {
    fontSize: 16,
    fontWeight: '600',
    color: RenovaTheme.colors.text,
    flexShrink: 1,
  },
  title: { fontSize: 16, fontWeight: '600', color: RenovaTheme.colors.text, textAlign: 'center' },
  sub: { fontSize: 11, color: RenovaTheme.colors.textMuted, marginTop: 2, textAlign: 'center' },
});
