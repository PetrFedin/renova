/** Детализация счёта — sheet по tap из «Бюджет → Оплаты» */
import { Modal, View, Text, StyleSheet, Pressable, Alert } from 'react-native';
import { usePathname } from 'expo-router';
import { RenovaTheme, formatRub, card } from '@/constants/Theme';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { api, ApiError, type Payment, type Stage } from '@/lib/api';
import type { OsRole } from '@/constants/osSections';
import { pushStageDetail } from '@/lib/navigation';

import { PAYMENT_TYPE_LABEL, PAYMENT_STATUS_LABEL } from '@/constants/labels';
import { buildPaymentHistory, formatPaymentEventDate } from '@/lib/domain/paymentHistory';

export { PAYMENT_TYPE_LABEL, PAYMENT_STATUS_LABEL } from '@/constants/labels';

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function PaymentDetailSheet({
  payment,
  stages,
  role,
  readOnly,
  userId,
  projectId,
  onClose,
  onChanged,
}: {
  payment: Payment | null;
  stages: Stage[];
  role: OsRole;
  readOnly?: boolean;
  userId: string;
  projectId: string;
  onClose: () => void;
  onChanged?: () => void;
}) {
  if (!payment) return null;

  const pathname = usePathname();
  const stage = stages.find((st) => st.id === payment.stage_id);
  const isCustomer = role === 'customer';
  const canConfirm = isCustomer && !readOnly && payment.status === 'pending';
  const statusLabel = PAYMENT_STATUS_LABEL[payment.status] || payment.status;
  const typeLabel = PAYMENT_TYPE_LABEL[payment.payment_type] || payment.payment_type;
  const history = buildPaymentHistory(payment);

  const confirm = async () => {
    try {
      await api.confirmPayment(userId, projectId, payment.id);
      onChanged?.();
      onClose();
    } catch (e: unknown) {
      if (e instanceof ApiError && e.status === 409) {
        Alert.alert('Нельзя оплатить', 'Сначала примите этап — оплата без приёмки запрещена.');
      } else {
        Alert.alert('Ошибка', 'Не удалось подтвердить оплату');
      }
    }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose}>
        <Pressable style={s.sheet} onPress={(e) => e.stopPropagation()}>
          <Text style={s.head}>{formatRub(payment.amount)}</Text>
          <Text style={s.title}>{payment.title}</Text>
          <Text style={[s.badge, payment.status === 'pending' && s.badgePending]}>{statusLabel}</Text>

          <View style={s.block}>
            <View style={s.row}><Text style={s.label}>Тип</Text><Text style={s.val}>{typeLabel}</Text></View>
            <View style={s.row}><Text style={s.label}>Выставлен</Text><Text style={s.val}>{fmtDate(payment.created_at)}</Text></View>
            {payment.confirmed_at ? (
              <View style={s.row}><Text style={s.label}>Оплачен</Text><Text style={s.val}>{fmtDate(payment.confirmed_at)}</Text></View>
            ) : null}
            {payment.notes ? (
              <View style={s.rowCol}>
                <Text style={s.label}>Комментарий</Text>
                <Text style={s.notes}>{payment.notes}</Text>
              </View>
            ) : null}
          </View>

          {stage ? (
            <Pressable
              style={s.linkRow}
              onPress={() => { onClose(); pushStageDetail(stage.id, pathname); }}
            >
              <Text style={s.label}>Этап</Text>
              <Text style={s.link}>{stage.name} →</Text>
            </Pressable>
          ) : null}

          {history.length > 0 && (
            <View style={s.block}>
              <Text style={s.sectionHead}>История</Text>
              {history.map((ev, i) => (
                <View key={ev.id} style={s.histRow}>
                  <View style={s.histDotWrap}>
                    <View style={[s.histDot, i === history.length - 1 && s.histDotLast]} />
                    {i < history.length - 1 ? <View style={s.histLine} /> : null}
                  </View>
                  <View style={s.histBody}>
                    <Text style={s.histTitle}>{ev.title}</Text>
                    {ev.subtitle ? <Text style={s.histSub}>{ev.subtitle}</Text> : null}
                    <Text style={s.histDate}>{formatPaymentEventDate(ev.at)}</Text>
                  </View>
                </View>
              ))}
            </View>
          )}

          {canConfirm && (
            <PrimaryButton title="Подтвердить оплату" onPress={confirm} />
          )}
          {!isCustomer && payment.status === 'pending' && (
            <Text style={s.wait}>Ожидает подтверждения заказчиком</Text>
          )}

          <PrimaryButton title="Закрыть" variant="outline" onPress={onClose} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: { ...card, borderBottomLeftRadius: 0, borderBottomRightRadius: 0, paddingBottom: 28 },
  head: { fontSize: 22, fontWeight: '700', color: RenovaTheme.colors.text },
  title: { fontSize: 16, fontWeight: '600', marginTop: 4, color: RenovaTheme.colors.textMuted },
  badge: { alignSelf: 'flex-start', marginTop: 8, marginBottom: 12, fontSize: 12, fontWeight: '700', color: RenovaTheme.colors.success, backgroundColor: '#ecfdf5', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  badgePending: { color: RenovaTheme.colors.warning, backgroundColor: '#fef9c3' },
  block: { marginBottom: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#f0f0f0' },
  rowCol: { paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#f0f0f0' },
  label: { fontSize: 13, color: RenovaTheme.colors.textMuted },
  val: { fontSize: 13, fontWeight: '600' },
  notes: { fontSize: 14, marginTop: 4, lineHeight: 20 },
  linkRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#f0f0f0', marginBottom: 12 },
  link: { fontSize: 14, color: RenovaTheme.colors.primary, fontWeight: '600' },
  wait: { fontSize: 13, color: RenovaTheme.colors.warning, fontWeight: '600', marginBottom: 12 },
  sectionHead: { fontSize: 13, fontWeight: '700', color: RenovaTheme.colors.text, marginBottom: 8 },
  histRow: { flexDirection: 'row', gap: 10, marginBottom: 4 },
  histDotWrap: { width: 12, alignItems: 'center' },
  histDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: RenovaTheme.colors.border, marginTop: 4 },
  histDotLast: { backgroundColor: RenovaTheme.colors.accent },
  histLine: { flex: 1, width: 2, backgroundColor: RenovaTheme.colors.border, minHeight: 20, marginTop: 2 },
  histBody: { flex: 1, paddingBottom: 10 },
  histTitle: { fontSize: 13, fontWeight: '600', color: RenovaTheme.colors.text },
  histSub: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginTop: 2 },
  histDate: { fontSize: 11, color: RenovaTheme.colors.textSubtle, marginTop: 2 },
});
