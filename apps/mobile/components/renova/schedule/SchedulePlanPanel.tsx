/**
 * Блок план-графика: not_created ≠ error.
 */
import { Alert, View, Text, StyleSheet, Pressable } from 'react-native';
import { RenovaTheme } from '@/constants/Theme';
import { InlineError, StaleDataBanner, LoadingSkeleton } from '@/components/async';
import {
  schedulePlanStatusLabel,
  type SchedulePlan,
  type SchedulePlanState,
  type SchedulePlanActionFlags,
} from '@/lib/domain/schedulePlanState';
import type { OsRole } from '@/constants/osSections';

export function SchedulePlanPanel({
  state,
  actions,
  role,
  planBusy,
  onRetry,
  onCreate,
  onSubmit,
  onConfirm,
  onReject,
  onRejectQuick,
}: {
  state: SchedulePlanState;
  actions: SchedulePlanActionFlags;
  role: OsRole;
  planBusy: boolean;
  onRetry: () => void;
  onCreate: () => void;
  onSubmit: () => void;
  onConfirm: () => void;
  onReject: () => void;
  onRejectQuick: () => void;
}) {
  const plan: SchedulePlan | null =
    state.status === 'draft'
    || state.status === 'submitted'
    || state.status === 'confirmed'
    || state.status === 'rejected'
    || state.status === 'stale'
      ? state.plan
      : null;

  return (
    <View style={s.agreeBox}>
      <Text style={s.agreeTitle}>План-график</Text>

      {state.status === 'stale' ? (
        <StaleDataBanner
          error={state.error}
          offline={state.error.kind === 'offline'}
          onRetry={onRetry}
          busy={planBusy}
        />
      ) : null}

      {state.status === 'loading' || state.status === 'idle' ? (
        <LoadingSkeleton rows={1} height={40} />
      ) : null}

      {state.status === 'error' ? (
        <InlineError
          error={state.error}
          title="Не удалось загрузить план"
          onRetry={onRetry}
          busy={planBusy}
        />
      ) : null}

      {state.status === 'forbidden' ? (
        <InlineError
          error={state.error}
          title="Нет доступа к плану-графику"
        />
      ) : null}

      {state.status === 'not_created' ? (
        <>
          <Text style={s.planSub}>План работ ещё не создан</Text>
          {actions.canCreate ? (
            <Pressable style={s.planCta} disabled={planBusy} onPress={onCreate}>
              <Text style={s.planCtaT}>{planBusy ? 'Создаём…' : 'Создать план-график из этапов'}</Text>
            </Pressable>
          ) : role === 'customer' ? (
            <Text style={s.hint}>Исполнитель создаст план и отправит на согласование.</Text>
          ) : null}
        </>
      ) : null}

      {plan && state.status !== 'error' && state.status !== 'forbidden' && state.status !== 'loading' ? (
        <>
          <Text style={s.planSub}>{schedulePlanStatusLabel(state)}</Text>
          {plan.status === 'rejected' && plan.rejection_reason ? (
            <Text style={[s.planSub, { color: '#b45309' }]}>Причина: {plan.rejection_reason}</Text>
          ) : null}
          {actions.immutable ? (
            <Text style={s.hint}>Согласованный план зафиксирован.</Text>
          ) : null}
          {actions.canSubmit ? (
            <Pressable style={s.planCta} disabled={planBusy} onPress={onSubmit}>
              <Text style={s.planCtaT}>{planBusy ? '…' : 'Отправить заказчику на согласование'}</Text>
            </Pressable>
          ) : null}
          {actions.canConfirm || actions.canReject ? (
            <View style={s.agreeActions}>
              {actions.canConfirm ? (
                <Pressable
                  style={[s.planCta, s.agreeConfirm]}
                  disabled={planBusy}
                  onPress={onConfirm}
                >
                  <Text style={s.planCtaT}>{planBusy ? '…' : 'Согласовать график'}</Text>
                </Pressable>
              ) : null}
              {actions.canReject ? (
                <Pressable
                  style={s.planCta}
                  disabled={planBusy}
                  onPress={() => {
                    Alert.alert('Отклонить график', 'Укажите причину (опционально)', [
                      { text: 'Отмена', style: 'cancel' },
                      { text: 'С причиной…', onPress: onReject },
                      { text: 'Нужна правка сроков', onPress: onRejectQuick },
                    ]);
                  }}
                >
                  <Text style={s.planCtaT}>Отклонить</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  agreeBox: {
    marginBottom: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: RenovaTheme.colors.surface,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
  },
  agreeTitle: { fontWeight: '800', fontSize: 15, color: RenovaTheme.colors.text, marginBottom: 4 },
  planSub: { fontSize: 13, color: RenovaTheme.colors.textMuted, marginBottom: 6, lineHeight: 18 },
  hint: { fontSize: 12, color: RenovaTheme.colors.textSubtle, marginTop: 4 },
  planCta: {
    marginTop: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: RenovaTheme.colors.surfaceMuted,
    borderWidth: 1,
    borderColor: RenovaTheme.colors.border,
  },
  agreeConfirm: { backgroundColor: RenovaTheme.colors.successBg, borderColor: RenovaTheme.colors.successBorder },
  planCtaT: { fontWeight: '700', fontSize: 13, color: RenovaTheme.colors.primary, textAlign: 'center' },
  agreeActions: { gap: 8 },
});
