/** Слой «Итог» — сумма сметы и быстрые переходы в деньги / материалы */
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { RenovaTheme, formatRub } from '@/constants/Theme';
import { screenTypography } from '@/constants/screenTypography';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { EstimateSourceLegend } from '@/components/renova/estimate/EstimateSourceLegend';
import { budgetTabRoute, objectTabRoute, repairTabRoute } from '@/constants/osSections';
import { pushOsNav } from '@/lib/pushOsNav';
import type { ProjectDetail } from '@/lib/api';
import { estimateLineSource, estimateTotals } from '@/lib/domain/estimateFilters';
import { showActionConfirm } from '@/lib/actionConfirmBus';
import { writeResultMessage } from '@/lib/offlineResultMessage';
import { formatScheduleDayFull } from '@/lib/formatScheduleDate';

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
  canRejectProposal?: boolean;
  canWithdrawProposal?: boolean;
  clearingProposal?: boolean;
  onRejectProposal?: () => Promise<void>;
  onWithdrawProposal?: () => Promise<void>;
  /** W68 #39 */
  lockDiff?: {
    has_baseline: boolean;
    has_changes: boolean;
    added: { name: string }[];
    removed: { name: string }[];
    changed: { name?: string }[];
    baseline_total: number;
    current_total: number;
    delta_total: number;
  } | null;
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
  lockDiff,
}: Props) {
  const lockedAt = project.estimate_locked_at;
  const estimateLines = project.estimate_lines || [];
  const autoLines = estimateLines.filter((line) => estimateLineSource(line) === 'auto').length;
  const manualLines = estimateLines.length - autoLines;
  const unitsCount = new Set(estimateLines.map((line) => line.unit).filter(Boolean)).size;
  const baselineState = lockedAt
    ? 'Зафиксирован'
    : project.estimate_lock_proposed_at
      ? 'На согласовании'
      : 'Черновик';
  return (
    <View style={s.wrap}>
      <View style={s.totalBox}>
        <Text style={s.totalLabel}>Итого по смете</Text>
        <Text style={s.total}>{formatRub(project.budget_planned)}</Text>
        {(project.vat_rate ?? 0) > 0 ? (
          <Text style={s.breakdown}>
            НДС {project.vat_rate}% · сумма в смете с учётом ставки
          </Text>
        ) : (
          <Text style={s.breakdown}>Без НДС (ставка 0%)</Text>
        )}
        {lockedAt ? (
          <Text style={s.locked}>Согласована · зафиксирована {formatScheduleDayFull(lockedAt)}</Text>
        ) : project.estimate_lock_proposed_at ? (
          <Text style={s.unlocked}>На согласовании у заказчика · {formatScheduleDayFull(project.estimate_lock_proposed_at)}</Text>
        ) : (
          <Text style={s.unlocked}>Черновик — сумма ещё не согласована</Text>
        )}
        <Text style={s.breakdown}>
          Работы {formatRub(totals.works)} ({totals.worksCount}) · Материалы {formatRub(totals.materials)} (
          {totals.materialsCount})
        </Text>
        {lockDiff?.has_baseline ? (
          <Text style={s.breakdown}>
            {lockDiff.has_changes
              ? `Изменения с отправки: +${lockDiff.added.length} / −${lockDiff.removed.length} / Δ ${lockDiff.changed.length} · Δ ${formatRub(lockDiff.delta_total)}`
              : 'С момента отправки сметы изменений нет'}
          </Text>
        ) : null}
      </View>

      <View style={s.baselineBox}>
        <View style={s.baselineHead}>
          <Text style={s.baselineTitle}>Коммерческий baseline</Text>
          <Text style={[s.baselineState, lockedAt && s.baselineStateLocked]}>{baselineState}</Text>
        </View>
        <Text style={s.baselineMeta}>
          {estimateLines.length} поз. · авто из комнат {autoLines} · ручные {manualLines} · единиц измерения {unitsCount || '—'}
        </Text>
        <Text style={s.baselineHint}>
          {lockedAt
            ? 'Зафиксированная база не переписывается: новые scope/price изменения должны проходить через «Изменения».'
            : 'До фиксации это рабочая коммерческая база. Источник строки и единица измерения остаются видимыми в детализации.'}
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
            // Clarity S: фиксация сметы — money-critical confirm
            showActionConfirm({
              title: 'Зафиксировать смету?',
              message: `Итого ${formatRub(project.budget_planned)}. После фиксации базовые строки нельзя свободно менять.`,
              primaryLabel: 'Зафиксировать',
              onPrimary: () => {
                void onLockEstimate().catch((e: unknown) => {
                  showActionConfirm({
                    // EST-002/EST-003: сервер отвечает 409 proposal_expired /
                    // estimate_changed_since_proposal — это не «успех», смета не зафиксирована.
                    title: (e as { code?: string })?.code === 'proposal_expired'
                      || (e as { code?: string })?.code === 'estimate_changed_since_proposal'
                      ? 'Смета не зафиксирована'
                      : 'Не удалось',
                    message: writeResultMessage(e, 'Ошибка фиксации сметы'),
                  });
                });
              },
              secondaryLabel: 'Отмена',
              onSecondary: () => undefined,
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
            showActionConfirm({
              title: 'Отклонить смету?',
              message: 'Исполнитель получит задачу на правку предложения.',
              primaryLabel: 'Отклонить',
              onPrimary: () => {
                void onRejectProposal().catch((e: unknown) => {
                  showActionConfirm({
                    title: 'Не удалось',
                    message: writeResultMessage(e, 'Ошибка отклонения'),
                  });
                });
              },
              secondaryLabel: 'Отмена',
              onSecondary: () => undefined,
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
            showActionConfirm({
              title: 'Отозвать предложение?',
              message: 'Смета снова станет черновиком. Заказчик не увидит это предложение.',
              primaryLabel: 'Отозвать',
              onPrimary: () => {
                void onWithdrawProposal().catch((e: unknown) => {
                  showActionConfirm({
                    title: 'Не удалось',
                    message: writeResultMessage(e, 'Ошибка отзыва'),
                  });
                });
              },
              secondaryLabel: 'Отмена',
              onSecondary: () => undefined,
            });
          }}
        />
      ) : null}
      {lockedAt ? (
        <PrimaryButton
          title="→ Документы (договор)"
          variant="outline"
          compact
          onPress={() => pushOsNav('/documents', pathname, 'customer')}
        />
      ) : null}

      <View style={s.links}>
        <PrimaryButton
          title="→ Деньги"
          variant="outline"
          compact
          onPress={() => pushOsNav(budgetTabRoute('customer', 'summary'), pathname, 'customer')}
        />
        <PrimaryButton
          title="→ Материалы"
          variant="outline"
          compact
          onPress={() => pushOsNav(repairTabRoute('customer', 'materials'), pathname, 'customer')}
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
        // W118: слой доп. работ → SoT
        pushOsNav(
          { pathname: route.pathname, params: { ...route.params, estimateLayer: 'changes' } },
          pathname,
          'customer',
        );
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
  totalLabel: { ...screenTypography.metricLabel, fontWeight: '600' },
  total: { fontSize: 32, fontWeight: '800', color: RenovaTheme.colors.primary, marginTop: 4 },
  locked: { fontSize: 12, color: RenovaTheme.colors.warningText, marginTop: 4, fontWeight: '700' },
  unlocked: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginTop: 4, lineHeight: 16 },
  breakdown: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginTop: 4, lineHeight: 17 },
  baselineBox: {
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
    backgroundColor: RenovaTheme.colors.surface,
  },
  baselineHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  baselineTitle: { fontSize: 13, fontWeight: '800', color: RenovaTheme.colors.text },
  baselineState: { fontSize: 11, fontWeight: '700', color: RenovaTheme.colors.warningText },
  baselineStateLocked: { color: RenovaTheme.colors.success },
  baselineMeta: { fontSize: 12, color: RenovaTheme.colors.text, marginTop: 6, lineHeight: 17 },
  baselineHint: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginTop: 4, lineHeight: 17 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexGrow: 1,
    minWidth: '28%',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: RenovaTheme.colors.border,
    backgroundColor: RenovaTheme.colors.surface,
  },
  chipWarn: { borderColor: '#FCD34D', backgroundColor: '#FFFBEB' },
  chipLabel: { ...screenTypography.metricLabel, marginTop: 0 },
  chipVal: { fontSize: 14, fontWeight: '700', color: RenovaTheme.colors.text, marginTop: 2 },
  chipValWarn: { color: '#92400E' },
  hint: { ...screenTypography.empty },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
