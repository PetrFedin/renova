/** Компактная карточка работы для раздела «Работы» */
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { RenovaTheme, card, formatRub } from '@/constants/Theme';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { WORK_CARD_STATUS_LABEL } from '@/constants/labels';

type StageLike = {
  id: string; name: string; status: string; planned_end?: string | null; payment_amount?: number;
  room_ids?: string[]; needs_rework?: boolean; contractor_ready?: boolean; checklist_progress?: number;
  work_type?: string | null;
  display_status_label?: string;
  works_total?: number;
  works_done?: number;
  overdue_days?: number;
};

type Props = {
  stage: StageLike;
  roomLabel?: string;
  onOpen: () => void;
  onPrimary?: () => void;
  primaryLabel?: string;
  readOnly?: boolean;
  blocked?: boolean;
  blockedReason?: string;
  selected?: boolean;
  onLongPress?: () => void;
};

export function WorkStageCard({ stage, roomLabel, onOpen, onPrimary, primaryLabel, readOnly, blocked, blockedReason, selected, onLongPress }: Props) {
  const progress = stage.checklist_progress ?? (stage.status === 'done' ? 100 : stage.status === 'review' ? 90 : 40);
  const overdue = stage.planned_end && stage.planned_end < new Date().toISOString().slice(0, 10) && stage.status !== 'done';
  return (
    <Pressable style={[s.card, overdue && s.overdue, blocked && s.blocked, selected && s.selected]} onPress={onOpen} onLongPress={onLongPress}>
      <View style={s.top}>
        <Text style={s.title} numberOfLines={1}>{stage.name}</Text>
        <Text style={[s.st, stage.status === 'review' && s.stWarn]}>{stage.display_status_label || WORK_CARD_STATUS_LABEL[stage.status] || stage.status}</Text>
      </View>
      <Text style={s.meta}>{roomLabel || '—'}{stage.works_total ? ` · ${stage.works_done ?? 0}/${stage.works_total} работ` : ''}{stage.overdue_days ? ` · +${stage.overdue_days} дн.` : ''}{blockedReason ? ` · ${blockedReason}` : ''}</Text>
      <View style={s.row}>
        <Text style={s.date}>{stage.planned_end || '—'}{overdue ? ' · +просрочка' : ''}</Text>
        <Text style={s.pay}>{formatRub(stage.payment_amount || 0)}</Text>
      </View>
      <View style={s.bar}><View style={[s.fill, { width: `${Math.min(100, progress)}%` }]} /></View>
      {!readOnly && onPrimary && primaryLabel && (
        <PrimaryButton title={primaryLabel} compact variant={stage.status === 'review' ? 'primary' : 'outline'} onPress={(e) => { e?.stopPropagation?.(); onPrimary(); }} />
      )}
    </Pressable>
  );
}

const s = StyleSheet.create({
  card: { ...card, marginBottom: 10 },
  overdue: { borderColor: '#D4A574', backgroundColor: '#FFFBF5' },
  blocked: { borderColor: '#C4B5A0', backgroundColor: '#FAFAF8' },
  selected: { borderWidth: 2, borderColor: RenovaTheme.colors.accent },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  title: { fontSize: 15, fontWeight: '700', flex: 1, color: RenovaTheme.colors.text },
  st: { fontSize: 11, color: RenovaTheme.colors.textMuted },
  stWarn: { color: RenovaTheme.colors.warning, fontWeight: '600' },
  meta: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginTop: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  date: { fontSize: 12, color: RenovaTheme.colors.textMuted },
  pay: { fontSize: 12, fontWeight: '600' },
  bar: { height: 4, backgroundColor: RenovaTheme.colors.border, borderRadius: 2, marginVertical: 8, overflow: 'hidden' },
  fill: { height: 4, backgroundColor: RenovaTheme.colors.primary },
});
