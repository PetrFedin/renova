/** Секция внутри вкладок «Объект» */
import { View, Text, StyleSheet, type ReactNode } from 'react-native';
import { RenovaTheme, card } from '@/constants/Theme';

export function ObjectSection({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <View style={s.wrap}>
      <Text style={s.title}>{title}</Text>
      {hint ? <Text style={s.hint}>{hint}</Text> : null}
      <View style={s.body}>{children}</View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginTop: 16, marginBottom: 4 },
  title: {
    fontSize: 12,
    fontWeight: '700',
    color: RenovaTheme.colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 6,
  },
  hint: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginBottom: 8, lineHeight: 17 },
  body: { gap: 8 },
});

/** Строка позиции сметы (read-only) */
export function EstimateLineRow({
  name,
  detail,
  meta,
  badge,
  notes,
}: {
  name: string;
  detail?: string | null;
  meta: string;
  badge?: string;
  notes?: string | null;
}) {
  return (
    <View style={row.box}>
      {badge ? <Text style={row.badge}>{badge}</Text> : null}
      <Text style={row.name}>{name}</Text>
      {detail ? <Text style={row.detail}>{detail}</Text> : null}
      {notes ? <Text style={row.notes}>{notes}</Text> : null}
      <Text style={row.meta}>{meta}</Text>
    </View>
  );
}

const row = StyleSheet.create({
  box: { ...card, paddingVertical: 10 },
  badge: { fontSize: 10, fontWeight: '700', color: RenovaTheme.colors.primary, marginBottom: 2 },
  name: { fontWeight: '600', fontSize: 14 },
  detail: { fontSize: 11, color: RenovaTheme.colors.primary, marginTop: 2, fontStyle: 'italic' },
  notes: { fontSize: 12, color: RenovaTheme.colors.text, marginTop: 4, lineHeight: 16 },
  meta: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginTop: 4 },
});
