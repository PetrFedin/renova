/** Оплата этапа — после приёмки, без scroll до счёта */
import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { RenovaTheme, formatRub, card } from '@/constants/Theme';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { PaymentDetailSheet } from '@/components/renova/PaymentDetailSheet';
import { api, type Payment, type Stage } from '@/lib/api';
import { useProjectDataReload } from '@/lib/useProjectDataReload';
import type { OsRole } from '@/constants/osSections';

type Props = {
  stageId: string;
  stageStatus: string;
  stagePaymentAmount: number;
  userId: string;
  projectId: string;
  role: OsRole;
  readOnly?: boolean;
  stages: Stage[];
  onChanged?: () => void;
};

export function StageDetailPaymentBlock({
  stageId,
  stageStatus,
  stagePaymentAmount,
  userId,
  projectId,
  role,
  readOnly,
  stages,
  onChanged,
}: Props) {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [selected, setSelected] = useState<Payment | null>(null);

  const reloadPayments = useCallback(() => {
    api.listPayments(userId, projectId).then(setPayments).catch(() => setPayments([]));
  }, [userId, projectId]);

  useEffect(() => {
    reloadPayments();
  }, [reloadPayments, stageId, stageStatus]);
  // W95: после YuKassa/confirm на другом экране — блок оплаты этапа без remount
  useProjectDataReload(reloadPayments);

  const pending = payments.find((p) => p.stage_id === stageId && p.status === 'pending');
  const isCustomer = role === 'customer';
  const showContractorPending = role === 'contractor' && !!pending && stageStatus !== 'review';

  if (stageStatus === 'review' && isCustomer && stagePaymentAmount > 0) {
    return (
      <View style={s.hintBox}>
        <Text style={s.hint}>После приёмки: оплатить {formatRub(stagePaymentAmount)}</Text>
      </View>
    );
  }

  if (!pending) return null;

  if (showContractorPending) {
    return (
      <View style={s.hintBox}>
        <Text style={s.hint}>Ожидает оплаты заказчиком</Text>
      </View>
    );
  }

  if (!isCustomer) return null;

  return (
    <>
      <View style={s.box}>
        <Text style={s.head}>Оплата этапа</Text>
        <Text style={s.amount}>{formatRub(pending.amount)}</Text>
        <Text style={s.sub}>{pending.title}</Text>
        <PrimaryButton title="Оплатить" onPress={() => setSelected(pending)} disabled={readOnly} />
      </View>
      <PaymentDetailSheet
        payment={selected}
        stages={stages}
        role={role}
        readOnly={readOnly}
        userId={userId}
        projectId={projectId}
        onClose={() => setSelected(null)}
        onChanged={() => {
          onChanged?.();
          reloadPayments();
        }}
      />
    </>
  );
}

const s = StyleSheet.create({
  box: { ...card, padding: RenovaTheme.spacing.md, marginTop: RenovaTheme.spacing.md, gap: 6 },
  hintBox: {
    marginTop: RenovaTheme.spacing.md,
    padding: 12,
    borderRadius: RenovaTheme.radius.md,
    backgroundColor: RenovaTheme.colors.surfaceMuted,
  },
  head: { fontSize: 14, fontWeight: '700', color: RenovaTheme.colors.text },
  amount: { fontSize: 28, fontWeight: '800', color: RenovaTheme.colors.primary },
  sub: { fontSize: 13, color: RenovaTheme.colors.textMuted },
  hint: { fontSize: 13, color: RenovaTheme.colors.textMuted, textAlign: 'center' },
});
