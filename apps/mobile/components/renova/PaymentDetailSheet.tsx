/** Детализация счёта — sheet по tap из «Бюджет → Оплаты» */
import { useCallback, useEffect, useState } from 'react';
import { Modal, View, Text, StyleSheet, Pressable, Alert, AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { usePathname } from 'expo-router';
import { RenovaTheme, formatRub, card } from '@/constants/Theme';
import { formMetaText } from '@/constants/formTypography';
import { InfoBanner } from '@/components/ui/InfoBanner';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { api, ApiError, type Payment, type Stage } from '@/lib/api';
import type { OsRole } from '@/constants/osSections';
import { pushStageDetail } from '@/lib/navigation';
import { pushOsNav } from '@/lib/pushOsNav';
import { repairTabRoute } from '@/constants/osSections';
import { apiErrorMessage } from '@/lib/formatPhone';
import { paymentReceiptKey } from '@/constants/sessionKeys';

import { PAYMENT_TYPE_LABEL, PAYMENT_STATUS_LABEL, PAYMENT_BLOCKED_ACCEPTANCE_MSG } from '@/constants/labels';
import { buildPaymentHistory, formatPaymentEventDate } from '@/lib/domain/paymentHistory';

export { PAYMENT_TYPE_LABEL, PAYMENT_STATUS_LABEL } from '@/constants/labels';

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
}

type PayStep = 'info' | 'transfer' | 'confirm';

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
  const [step, setStep] = useState<PayStep>('info');
  const [transferAck, setTransferAck] = useState(false);
  const [receiptAttached, setReceiptAttached] = useState(false);

  const reloadReceiptFlag = useCallback(async () => {
    if (!payment) return;
    if (payment.receipt_id) {
      setReceiptAttached(true);
      setStep((s) => (s === 'info' ? 'confirm' : s));
      return;
    }
    try {
      const v = await AsyncStorage.getItem(paymentReceiptKey(payment.id));
      if (v === '1') {
        setReceiptAttached(true);
        setStep((s) => (s === 'info' ? 'confirm' : s));
      }
    } catch { /* storage fallback до синхронизации API */ }
  }, [payment?.id, payment?.receipt_id]);

  useEffect(() => {
    if (!payment) return;
    setStep('info');
    setTransferAck(false);
    setReceiptAttached(false);
    reloadReceiptFlag().catch(() => {});
  }, [payment?.id, reloadReceiptFlag]);

  useEffect(() => {
    if (!payment) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') reloadReceiptFlag().catch(() => {});
    });
    return () => sub.remove();
  }, [payment?.id, reloadReceiptFlag]);

  if (!payment) return null;

  const pathname = usePathname();
  const stage = stages.find((st) => st.id === payment.stage_id);
  const isCustomer = role === 'customer';
  const canConfirm = isCustomer && !readOnly && payment.status === 'pending';
  const stageNeedsAcceptance = !!stage && stage.status !== 'done';
  const statusLabel = PAYMENT_STATUS_LABEL[payment.status] || payment.status;
  const typeLabel = PAYMENT_TYPE_LABEL[payment.payment_type] || payment.payment_type;
  const history = buildPaymentHistory(payment);

  const requisites = [
    'Получатель: исполнитель по договору',
    'Сбербанк · карта 2202 2065 •••• 4521',
    `Сумма: ${formatRub(payment.amount)}`,
    `Назначение: ${payment.title}`,
  ].join('\n');

  const openReceipt = () => {
    setReceiptAttached(true);
    pushOsNav({ pathname: '/scan-receipt', params: { paymentId: payment.id } }, pathname);
    Alert.alert('Чек', 'После сканирования вернитесь к счёту и нажмите «Я оплатил — подтвердить».');
  };

  const openSbp = () => {
    Alert.alert(
      'Перевод',
      `${requisites}\n\nСкопируйте сумму и назначение в приложении банка или СБП.`,
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Я перевёл',
          onPress: () => {
            setTransferAck(true);
            setStep('confirm');
          },
        },
      ],
    );
  };

  const goToAcceptance = () => {
    onClose();
    if (stage) {
      pushStageDetail(stage.id, pathname);
      return;
    }
    pushOsNav(repairTabRoute(role, 'control'), pathname);
  };

  const confirm = async () => {
    if (stageNeedsAcceptance) {
      Alert.alert(
        'Сначала приёмка',
        PAYMENT_BLOCKED_ACCEPTANCE_MSG,
        [
          { text: 'Отмена', style: 'cancel' },
          { text: 'Перейти к приёмке', onPress: goToAcceptance },
        ],
      );
      return;
    }
    if (!transferAck && !receiptAttached) {
      Alert.alert('Подтверждение', 'Сначала переведите сумму или прикрепите чек.');
      return;
    }
    try {
      await api.confirmPayment(userId, projectId, payment.id);
      await AsyncStorage.removeItem(paymentReceiptKey(payment.id)).catch(() => {});
      onChanged?.();
      onClose();
      Alert.alert('Оплата подтверждена', 'Исполнитель увидит статус в бюджете и чате.');
    } catch (e: unknown) {
      if (e instanceof ApiError && e.status === 409) {
        Alert.alert('Сначала приёмка', PAYMENT_BLOCKED_ACCEPTANCE_MSG, [
          { text: 'Отмена', style: 'cancel' },
          { text: 'Перейти к приёмке', onPress: goToAcceptance },
        ]);
      } else {
        Alert.alert('Ошибка', apiErrorMessage(e, 'Не удалось подтвердить оплату'));
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

          {canConfirm && payment.status === 'pending' ? (
            <Text style={formMetaText.caption}>
              Шаг {step === 'info' ? 1 : step === 'transfer' ? 2 : 3} из 3 · перевод → подтверждение
            </Text>
          ) : null}

          {canConfirm && step === 'info' ? (
            <View style={s.block}>
              {stageNeedsAcceptance ? (
                <InfoBanner
                  tone="warning"
                  title="Этап ждёт приёмки"
                  message={PAYMENT_BLOCKED_ACCEPTANCE_MSG}
                />
              ) : null}
              <Text style={formMetaText.caption}>
                Подтверждение — фиксация факта оплаты. Сначала переведите сумму исполнителю или прикрепите чек.
              </Text>
              {stageNeedsAcceptance ? (
                <PrimaryButton title="Перейти к приёмке" onPress={goToAcceptance} />
              ) : (
                <>
                  <PrimaryButton title="Перевести (СБП / карта)" onPress={() => setStep('transfer')} />
                  <PrimaryButton title="Прикрепить чек" variant="outline" onPress={openReceipt} />
                </>
              )}
            </View>
          ) : null}

          {canConfirm && step === 'transfer' ? (
            <View style={s.block}>
              <Text style={s.sectionHead}>Реквизиты</Text>
              {requisites.split('\n').map((line) => (
                <Text key={line} style={formMetaText.caption}>{line}</Text>
              ))}
              <PrimaryButton title="Открыть СБП / банк" variant="outline" onPress={openSbp} />
              <PrimaryButton
                title="Я перевёл — дальше"
                onPress={() => { setTransferAck(true); setStep('confirm'); }}
              />
              <PrimaryButton title="Назад" variant="ghost" onPress={() => setStep('info')} />
            </View>
          ) : null}

          {canConfirm && step === 'confirm' ? (
            <View style={s.block}>
              <Text style={formMetaText.caption}>
                {transferAck ? 'Перевод отмечен.' : ''}{receiptAttached ? ' Чек будет в расходах.' : ''} Подтвердите оплату для исполнителя.
              </Text>
              <PrimaryButton
                title="Я оплатил — подтвердить"
                onPress={confirm}
                disabled={stageNeedsAcceptance}
              />
              {!receiptAttached ? (
                <PrimaryButton title="Прикрепить чек" variant="outline" onPress={openReceipt} />
              ) : null}
            </View>
          ) : null}

          <View style={s.block}>
            <View style={s.row}><Text style={s.label}>Тип</Text><Text style={s.val}>{typeLabel}</Text></View>
            <View style={s.row}><Text style={s.label}>Выставлен</Text><Text style={s.val}>{fmtDate(payment.created_at)}</Text></View>
            {payment.confirmed_at ? (
              <View style={s.row}><Text style={s.label}>Оплачен</Text><Text style={s.val}>{fmtDate(payment.confirmed_at)}</Text></View>
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
                  <View style={s.histBody}>
                    <Text style={s.histTitle}>{ev.title}</Text>
                    {ev.subtitle ? <Text style={s.histSub}>{ev.subtitle}</Text> : null}
                    <Text style={s.histDate}>{formatPaymentEventDate(ev.at)}</Text>
                  </View>
                </View>
              ))}
            </View>
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
  sheet: { ...card, borderBottomLeftRadius: 0, borderBottomRightRadius: 0, paddingBottom: 28, gap: 8 },
  head: { fontSize: 22, fontWeight: '700', color: RenovaTheme.colors.text },
  title: { fontSize: 16, fontWeight: '600', marginTop: 4, color: RenovaTheme.colors.textMuted },
  badge: { alignSelf: 'flex-start', marginTop: 8, marginBottom: 4, fontSize: 12, fontWeight: '700', color: RenovaTheme.colors.success, backgroundColor: '#ecfdf5', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  badgePending: { color: RenovaTheme.colors.warning, backgroundColor: '#fef9c3' },
  block: { marginBottom: 4, gap: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#f0f0f0' },
  label: { fontSize: 13, color: RenovaTheme.colors.textMuted },
  val: { fontSize: 13, fontWeight: '600' },
  linkRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#f0f0f0', marginBottom: 8 },
  link: { fontSize: 14, color: RenovaTheme.colors.primary, fontWeight: '600' },
  wait: { fontSize: 13, color: RenovaTheme.colors.warning, fontWeight: '600', marginBottom: 8 },
  sectionHead: { fontSize: 13, fontWeight: '700', color: RenovaTheme.colors.text, marginBottom: 4 },
  histRow: { flexDirection: 'row', gap: 10, marginBottom: 4 },
  histBody: { flex: 1, paddingBottom: 6 },
  histTitle: { fontSize: 13, fontWeight: '600', color: RenovaTheme.colors.text },
  histSub: { fontSize: 12, color: RenovaTheme.colors.textMuted, marginTop: 2 },
  histDate: { fontSize: 11, color: RenovaTheme.colors.textSubtle, marginTop: 2 },
});
