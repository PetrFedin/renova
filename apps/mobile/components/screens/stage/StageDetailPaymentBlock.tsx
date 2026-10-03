import { paymentCheckLabel } from '@/lib/domain/paymentReceiptCheck';
import { reportError } from '@/lib/reportError';
/** Оплата этапа — после приёмки, без scroll до счёта */
import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { RenovaTheme, formatRub, card } from '@/constants/Theme';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { PaymentDetailSheet } from '@/components/renova/PaymentDetailSheet';
import { api, type Payment, type Stage } from '@/lib/api';
import { useProjectDataReload } from '@/lib/useProjectDataReload';
import type { OsRole } from '@/constants/osSections';
import { PAYMENT_STATUS_LABEL } from '@/constants/labels';

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
  const [paymentExpectedOnAccept, setPaymentExpectedOnAccept] = useState(false);

  const reloadPayments = useCallback(() => {
    Promise.all([
      api.listPayments(userId, projectId),
      api.getStage(userId, projectId, stageId),
    ]).then(([rows, detail]) => {
      setPayments(rows);
      // Missing capability on a durable pre-upgrade cache is denied/fail-closed.
      setPaymentExpectedOnAccept(detail.capabilities?.payment_expected_on_accept === true);
    }).catch((e) => {
      reportError('stage.payments', e, { projectId, stageId });
      setPayments([]);
      setPaymentExpectedOnAccept(false);
    });
  }, [userId, projectId, stageId]);

  useEffect(() => {
    reloadPayments();
  }, [reloadPayments, stageStatus]);
  // W95: после YuKassa/confirm на другом экране — блок оплаты этапа без remount
  useProjectDataReload(reloadPayments);

  // Все живые счета этапа (частичные тоже), а не только первый pending:
  // отменённые и возвращённые сумму этапа не занимают и не показываются.
  const stagePayments = payments.filter(
    (p) => p.stage_id === stageId && p.status !== 'cancelled' && p.status !== 'refunded',
  );
  const pending = stagePayments.find((p) => p.status === 'pending');
  const isCustomer = role === 'customer';

  if (stageStatus === 'review' && isCustomer && stagePaymentAmount > 0 && paymentExpectedOnAccept) {
    return (
      <View style={s.hintBox}>
        <Text style={s.hint}>После приёмки: оплатить {formatRub(stagePaymentAmount)}</Text>
      </View>
    );
  }

  // Раньше здесь был молчаливый провал: при нулевой сумме блок ничего не
  // рисовал, и приёмка выглядела обычной. Человек принимал работу, а платежа
  // не возникало — и узнать об этом было неоткуда.
  if (stageStatus === 'review' && isCustomer && !paymentExpectedOnAccept) {
    return (
      <View style={s.hintBox}>
        <Text style={s.hint}>
          По этому этапу оплаты не возникнет: сумма не распределена. Порядок оплаты — «Деньги → Оплаты».
        </Text>
      </View>
    );
  }

  if (!stagePayments.length) return null;
  if (!isCustomer && stageStatus === 'review') return null;

  const needsRecipient = !isCustomer && stagePayments.some((p) => p.status === 'paid_unverified');

  return (
    <>
      <View style={s.box}>
        <Text style={s.head}>{stagePayments.length > 1 ? 'Счета этапа' : 'Оплата этапа'}</Text>
        {stagePayments.map((payment) => (
          <Pressable
            key={payment.id}
            style={s.row}
            accessibilityRole="button"
            accessibilityLabel={`Открыть счёт ${payment.title}, ${formatRub(payment.amount)}`}
            onPress={() => setSelected(payment)}
          >
            <View style={{ flex: 1 }}>
              <Text style={s.amount}>{formatRub(payment.amount)}</Text>
              <Text style={s.sub}>{payment.title}</Text>
              {paymentCheckLabel(payment) ? <Text style={s.sub}>Чек {paymentCheckLabel(payment)}</Text> : null}
            </View>
            <Text style={s.status}>{PAYMENT_STATUS_LABEL[payment.status] ?? payment.status}</Text>
          </Pressable>
        ))}
        {isCustomer && pending && !readOnly ? (
          <PrimaryButton title="Оплатить" variant="accent" onPress={() => setSelected(pending)} />
        ) : null}
        {isCustomer && pending && readOnly ? <Text style={s.hint}>Ожидает оплаты заказчиком</Text> : null}
        {!isCustomer && pending ? <Text style={s.hint}>Ожидает оплаты заказчиком</Text> : null}
        {needsRecipient ? (
          <Text style={s.hint}>Заказчик отметил перевод — подтвердите, что деньги пришли (откройте счёт).</Text>
        ) : null}
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
  amount: { fontSize: 22, fontWeight: '800', color: RenovaTheme.colors.primary },
  sub: { fontSize: 13, color: RenovaTheme.colors.textMuted },
  hint: { fontSize: 13, color: RenovaTheme.colors.textMuted, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, minHeight: RenovaTheme.minTouch },
  status: { fontSize: 12, fontWeight: '600', color: RenovaTheme.colors.warning },
});
