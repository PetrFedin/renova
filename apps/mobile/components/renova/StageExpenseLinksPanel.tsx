/** Этап ↔ комнаты ↔ траты — одна сводка для заказчика на «Бюджет → Сводка» */
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { router } from 'expo-router';
import { RenovaTheme, formatRub } from '@/constants/Theme';
import { buildStageExpenseLinks, type StageExpenseLink } from '@/lib/domain/buildStageExpenseLinks';
import type { ExpenseDetailRow } from '@/lib/domain/expenseAnalytics';
import type { MaterialPick, Room, Stage } from '@/lib/api';

type Props = {
  rows: ExpenseDetailRow[];
  stages: Stage[];
  rooms: Room[];
  picks?: MaterialPick[];
  returnTo?: string;
  limit?: number;
};

export function StageExpenseLinksPanel({ rows, stages, rooms, picks = [], returnTo, limit = 6 }: Props) {
  const links = buildStageExpenseLinks(rows, stages, rooms, picks).slice(0, limit);
  if (!links.length) return null;

  return (
    <View style={s.box}>
      <Text style={s.head}>Этапы · комнаты · траты</Text>
      <Text style={s.hint}>Связь работ, помещений и учтённых расходов. Нажмите этап — детали.</Text>
      {links.map((link) => (
        <StageRow key={link.stageId} link={link} returnTo={returnTo} />
      ))}
    </View>
  );
}

function StageRow({ link, returnTo }: { link: StageExpenseLink; returnTo?: string }) {
  const roomsLabel = link.roomNames.length ? link.roomNames.slice(0, 3).join(', ') : 'комната не указана';
  const meta = [
    link.expenseCount ? `${link.expenseCount} трат` : null,
    link.materialCount ? `${link.materialCount} мат.` : null,
  ].filter(Boolean).join(' · ');

  return (
    <Pressable
      style={s.row}
      onPress={() => router.push({ pathname: `/stage/${link.stageId}`, params: returnTo ? { returnTo } : {} } as any)}
    >
      <View style={s.main}>
        <Text style={s.name}>{link.stageName}</Text>
        <Text style={s.sub}>{roomsLabel}{meta ? ` · ${meta}` : ''}</Text>
      </View>
      <Text style={s.val}>{formatRub(link.spent)}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  box: { backgroundColor: RenovaTheme.colors.surface, borderRadius: 12, padding: 14, marginBottom: 12 },
  head: { fontWeight: '800', marginBottom: 4, fontSize: 14 },
  hint: { fontSize: 11, color: RenovaTheme.colors.textMuted, marginBottom: 10, lineHeight: 15 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#f0f0f0' },
  main: { flex: 1, paddingRight: 8 },
  name: { fontWeight: '700', fontSize: 13 },
  sub: { fontSize: 11, color: RenovaTheme.colors.textMuted, marginTop: 2 },
  val: { fontWeight: '700', fontSize: 13, color: RenovaTheme.colors.primary },
});
