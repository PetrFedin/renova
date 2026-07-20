/** Слой «Итог» — сумма сметы и быстрые переходы в деньги / материалы */
import { Alert, View, Text, StyleSheet, Pressable } from 'react-native';
import { RenovaTheme, formatRub } from '@/constants/Theme';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { EstimateSourceLegend } from '@/components/renova/estimate/EstimateSourceLegend';
import { budgetTabRoute, objectTabRoute, repairTabRoute } from '@/constants/osSections';
import { pushOsNav } from '@/lib/pushOsNav';
import { router } from 'expo-router';
import type { ProjectDetail } from '@/lib/api';
import { estimateTotals } from '@/lib/domain/estimateFilters';

type Props = {
  project: ProjectDetail;
  totals: ReturnType<typeof estimateTotals>;
  pathname: string;
  roomsCount: number;
  stagesCount: number;
  pendingChanges: number;
  /** Заказчик / исполнитель может зафиксировать базовую смету (P0.4) */
  canLock?: boolean;
  locking?: boolean;
  onLockEstimate?: () => Promise<void>;
};

export function EstimateSummaryLayer({
  project,
  totals,
  pathname,
  roomsCount,
  stagesCount,
  pendingChanges,
  canLock,
  locking,
  onLockEstimate,
  canRejectProposal,
  canWithdrawProposal,
  clearingProposal,
  onRejectProposal,
  onWithdrawProposal,
}: Props) {
  const lockedAt = project.estimate_locked_at;
  return (
    <View style={s.wrap}>
      <View style={s.totalBox}>
        <Text style={s.totalLabel}>Итого по смете</Text>
        <Text style={s.total}>{formatRub(project.budget_planned)}</Text>
        {lockedAt ? (
          <Text style={s.locked}>Согласована · зафиксирована {lockedAt.slice(0, 10)}</Text>
        ) : project.estimate_lock_proposed_at ? (
          <Text style={s.unlocked}>На согласовании у заказчика · {project.estimate_lock_proposed_at.slice(0, 10)}</Text>
        ) : (
          <Text style={s.unlocked}>Черновик — согласуйте сумму, чтобы открыть договор и этапы</Text>
        )}
        <Text style={s.breakdown}>
          Работы {formatRub(totals.works)} ({totals.worksCount}) · Материалы {formatRub(totals.materials)} (
          {totals.materialsCount})
        </Text>
      </View>

      <View style={s.metaRow}>
        <MetaChip label="Комнаты" value={roomsCount ? `${roomsCount}` : '—'} />
        <MetaChip label="Этапы" value={stagesCount ? `${stagesCount}` : '—'} />
        <PendingChangesChip count={pendingChanges} pathname={pathname} />
      </View>

      <EstimateSourceLegend compact />

      <Text style={s.hint}>
        Детализация по комнатам — вкладка «Детализация». Доп. работы и решения — «Изменения». PDF и Excel — «Документы».
      </Text>

      {!lockedAt && canLock && onLockEstimate ? (
        <PrimaryButton
          title={locking ? 'Фиксация…' : 'Согласовать и зафиксировать смету'}
          disabled={!!locking || !!clearingProposal}
          onPress={() => {
            void onLockEstimate().catch((e: unknown) => {
              Alert.alert('Не удалось', e instanceof Error ? e.message : 'Ошибка фиксации сметы');
            });
          }}
        />
      ) : null}
      {!lockedAt && canRejectProposal && onRejectProposal ? (
        <PrimaryButton
          title={clearingProposal ? 'Отклонение…' : 'Отклонить — нужна правка'}
          variant="outline"
          disabled={!!clearingProposal || !!locking}
          onPress={() => {
            void onRejectProposal().catch((e: unknown) => {
              Alert.alert('Не удалось', e instanceof Error ? e.message : 'Ошибка отклонения');
            });
          }}
        />
      ) : null}
      {!lockedAt && canWithdrawProposal && onWithdrawProposal ? (
        <PrimaryButton
          title={clearingProposal ? 'Отзыв…' : 'Отозвать предложение'}
          variant="outline"
          disabled={!!clearingProposal}
          onPress={() => {
            void onWithdrawProposal().catch((e: unknown) => {
              Alert.alert('Не удалось', e instanceof Error ? e.message : 'Ошибка отзыва');
            });
          }}
        />
      ) : null}
      {lockedAt ? (
        <PrimaryButton
          title="→ Документы (договор)"
          variant="outline"
          compact
          onPress={() => pushOsNav('/documents', pathname)}
        />
      ) : null}

      <View style={s.links}>
        <PrimaryButton
          title="→ Деньги"
          variant="outline"
          compact
          onPress={() => pushOsNav(budgetTabRoute('customer', 'summary'), pathname)}
        />
        <PrimaryButton
          title="→ Материалы"
          variant="outline"
          compact
          onPress={() => pushOsNav(repairTabRoute('customer', 'materials'), pathname)}
        />
      </View>
    </View>
  );
}

function PendingChangesChip({ count, pathname }: { count: number; pathname: string }) {
  const chip = (
    <MetaChip label="На согласовании" value={count ? `${count}` : '0'} warn={count > 0} />
  );
  if (!count) return chip;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        const route = objectTabRoute('customer', 'estimate');
        router.push({ pathname: route.pathname, params: { ...route.params, estimateLayer: 'changes', returnTo: pathname } } as never);
      }}
    >
      {chip}
    </Pressable>
  );
}

function MetaChip({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <View style={[s.chip, warn && s.chipWarn]}>
      <Text style={s.chipLabel}>{label}</Text>
      <Text style={[s.chipVal, warn && s.chipValWarn]}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 10, marginTop: 12 },
  totalBox: { marginBottom: 4 },
  totalLabel: { fontSize: 12, fontWeight: '700', color: RenovaTheme.colors.textMuted, textTransform: 'uppercase' },
  total: { fontSize: 32, fontWeight: '800', color: RenovaTheme.colors.primary, marginTop: 4 },
  locked: { fontSize: 12, color: RenovaTheme.colors.warningText, marginTop: 4, fontWeight: '700' },
  unlocked: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginTop: 4, lineHeight: 16 },
  breakdown: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginTop: 4, lineHeight: 17 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexGrow: 1,
    minWidth: '28%',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
    backgroundColor: RenovaTheme.colors.surface,
  },
  chipWarn: { borderColor: '#FCD34D', backgroundColor: '#FFFBEB' },
  chipLabel: { fontSize: 10, fontWeight: '700', color: RenovaTheme.colors.textMuted, textTransform: 'uppercase' },
  chipVal: { fontSize: 14, fontWeight: '700', color: RenovaTheme.colors.text, marginTop: 2 },
  chipValWarn: { color: '#92400E' },
  hint: { fontSize: 12, color: RenovaTheme.colors.textMuted, lineHeight: 17 },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
