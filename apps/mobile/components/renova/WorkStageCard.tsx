/** Компактная строка этапа для раздела «Работы» — Clarity F: list-row, не card-стек */
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { RenovaTheme, formatRub } from '@/constants/Theme';
import { screenTypography, listRowStyles } from '@/constants/screenTypography';
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
    <Pressable
      style={[
        listRowStyles.row,
        overdue && s.overdue,
        blocked && s.blocked,
        selected && listRowStyles.rowFocus,
      ]}
      onPress={onOpen}
      onLongPress={onLongPress}
    >
      <View style={s.top}>
        <Text style={screenTypography.listTitle} numberOfLines={1}>{stage.name}</Text>
        <Text style={[s.st, stage.status === 'review' && s.stWarn]}>
          {stage.display_status_label || WORK_CARD_STATUS_LABEL[stage.status] || stage.status}
        </Text>
      </View>
      <Text style={screenTypography.listMeta} numberOfLines={2}>
        {roomLabel || '—'}
        {stage.works_total ? ` · ${stage.works_done ?? 0}/${stage.works_total} работ` : ''}
        {stage.overdue_days ? ` · +${stage.overdue_days} дн.` : ''}
        {blockedReason ? ` · ${blockedReason}` : ''}
        {' · '}
        {stage.planned_end || 'без срока'}
        {overdue ? ' · просрочка' : ''}
        {' · '}
        {formatRub(stage.payment_amount || 0)}
      </Text>
      <View style={s.bar}><View style={[s.fill, { width: `${Math.min(100, progress)}%` }]} /></View>
      {!readOnly && onPrimary && primaryLabel && (
        <PrimaryButton
          title={primaryLabel}
          compact
          variant={stage.status === 'review' ? 'primary' : 'outline'}
          onPress={(e) => { e?.stopPropagation?.(); onPrimary(); }}
        />
      )}
    </Pressable>
  );
}

const s = StyleSheet.create({
  overdue: { borderLeftWidth: 3, borderLeftColor: '#D4A574', paddingLeft: 8 },
  blocked: { opacity: 0.72 },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  st: { fontSize: 11, color: RenovaTheme.colors.textMuted },
  stWarn: { color: RenovaTheme.colors.warning, fontWeight: '600' },
  bar: { height: 3, backgroundColor: RenovaTheme.colors.border, borderRadius: 2, marginTop: 8, marginBottom: 4, overflow: 'hidden' },
  fill: { height: 3, backgroundColor: RenovaTheme.colors.primary },
});
