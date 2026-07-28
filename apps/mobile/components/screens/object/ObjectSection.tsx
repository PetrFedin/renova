/** Секция внутри вкладок «Объект» — Clarity visual: sentence-case, без uppercase-крика */
import type { ReactNode } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { screenTypography, listRowStyles } from '@/constants/screenTypography';

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
  title: { ...screenTypography.section, marginTop: 0 },
  hint: { ...screenTypography.listMeta, marginBottom: 8 },
  body: { gap: 8 },
});

/** Строка позиции сметы (read-only) — list-row, не card */
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
  box: { ...listRowStyles.row },
  badge: { fontSize: 11, fontWeight: '600', color: RenovaTheme.colors.primary, marginBottom: 2 },
  name: { ...screenTypography.listTitle, fontSize: 14 },
  detail: { fontSize: 11, color: RenovaTheme.colors.primary, marginTop: 2 },
  notes: { ...screenTypography.listMeta, color: RenovaTheme.colors.text, marginTop: 4 },
  meta: { ...screenTypography.listMeta },
});
