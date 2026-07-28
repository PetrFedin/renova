/** Детализация счёта — sheet по tap из «Бюджет → Оплаты» */
import { useCallback, useEffect, useState } from 'react';
import { Modal, View, Text, StyleSheet, Pressable, Alert, AppState, ActivityIndicator, Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { usePathname } from 'expo-router';
import { RenovaTheme, formatRub, card } from '@/constants/Theme';
import { screenTypography } from '@/constants/screenTypography';
import { formMetaText } from '@/constants/formTypography';
import { InfoBanner } from '@/components/ui/InfoBanner';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { api, ApiError, type Payment, type Stage } from '@/lib/api';
import { useRenova } from '@/lib/context/RenovaContext';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import type { OsRole } from '@/constants/osSections';
import { pushStageDetail } from '@/lib/navigation';
import { pushOsNav } from '@/lib/pushOsNav';
import { repairTabRoute } from '@/constants/osSections';
import { apiErrorMessage } from '@/lib/formatPhone';
import { paymentReceiptKey } from '@/constants/sessionKeys';

import { PAYMENT_TYPE_LABEL, PAYMENT_STATUS_LABEL, PAYMENT_BLOCKED_ACCEPTANCE_MSG } from '@/constants/labels';
import { buildPaymentHistory, formatPaymentEventDate } from '@/lib/domain/paymentHistory';
import { buildPaymentRequisites } from '@/lib/paymentRequisites';
import { alertPaymentConfirmed } from '@/lib/estimatePayNav';
import { showActionConfirm } from '@/lib/actionConfirmBus';
import { reportCatch, reportError } from '@/lib/reportError';

export { PAYMENT_TYPE_LABEL, PAYMENT_STATUS_LABEL } from '@/constants/labels';

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Clarity I: gate приёмки — sheet с CTA, не Alert */
function confirmAcceptanceFirst(goToAcceptance: () => void) {
  showActionConfirm({
    title: 'Сначала приёмка',
    message: PAYMENT_BLOCKED_ACCEPTANCE_MSG,
    primaryLabel: 'Перейти к приёмке',
    onPrimary: goToAcceptance,
    secondaryLabel: 'Отмена',
    onSecondary: () => undefined,
  });
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
  const { user, activeProject } = useRenova();
  const pathname = usePathname();
  const [step, setStep] = useState<PayStep>('info');
  const [transferAck, setTransferAck] = useState(false);
  const [receiptAttached, setReceiptAttached] = useState(false);
  const [cardBusy, setCardBusy] = useState(false);
  const [confirmBusy, setConfirmBusy] = useState(false);

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
    setCardBusy(false);
    setConfirmBusy(false);
    reloadReceiptFlag().catch(reportCatch('payment.receiptFlag'));
  }, [payment?.id, reloadReceiptFlag]);

  useEffect(() => {
    if (!payment) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') reloadReceiptFlag().catch(reportCatch('payment.receiptFlag'));
    });
    return () => sub.remove();
  }, [payment?.id, reloadReceiptFlag]);

  const [reqText, setReqText] = useState('');
  const [reqMissing, setReqMissing] = useState<string | null>(null);
  const [reqLoaded, setReqLoaded] = useState(false);

  useEffect(() => {
    if (!payment || !userId || !projectId) return;
    let cancelled = false;
    (async () => {
      try {
        const raw = await api.getPaymentRequisites(userId, projectId);
        if (cancelled) return;
        const built = buildPaymentRequisites({
          recipientName: raw.recipient_name,
          paymentRequisites: raw.payment_requisites,
          amount: payment.amount,
          title: payment.title,
        });
        setReqText(built.text);
        setReqMissing(built.missingHint);
      } catch {
        if (cancelled) return;
        const built = buildPaymentRequisites({
          amount: payment.amount,
          title: payment.title,
        });
        setReqText(built.text);
        setReqMissing(built.missingHint);
      } finally {
        if (!cancelled) setReqLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [payment?.id, payment?.amount, payment?.title, userId, projectId]);

  if (!payment) return null;

  const requisites = reqText || buildPaymentRequisites({ amount: payment.amount, title: payment.title }).text;
  const stage = stages.find((st) => st.id === payment.stage_id);
  const isCustomer = role === 'customer';
  const canConfirm = isCustomer && !readOnly && payment.status === 'pending';
  const stageNeedsAcceptance = !!stage && stage.status !== 'done';
  const statusLabel = PAYMENT_STATUS_LABEL[payment.status] || payment.status;
  const typeLabel = PAYMENT_TYPE_LABEL[payment.payment_type] || payment.payment_type;
  const history = buildPaymentHistory(payment);
  const busy = cardBusy || confirmBusy;
  const closeSafely = () => {
    if (!busy) onClose();
  };

  const openReceipt = () => {
    if (busy) return;
    setReceiptAttached(true);
    pushOsNav({ pathname: '/scan-receipt', params: { paymentId: payment.id } }, pathname, role);
    showActionConfirm({
      title: 'Чек',
      message: 'После сканирования вернитесь к счёту и нажмите «Я оплатил — подтвердить».',
      primaryLabel: 'К подтверждению',
      onPrimary: () => setStep('confirm'),
      secondaryLabel: 'Позже',
      onSecondary: () => undefined,
    });
  };

  const openSbp = async () => {
    if (busy) return;
    if (reqMissing) {
      showActionConfirm({ title: 'Реквизиты не указаны', message: reqMissing });
      return;
    }
    try {
      await Clipboard.setStringAsync(String(Math.round(payment.amount)));
    } catch { /* fallback — пользователь скопирует вручную */ }
    showActionConfirm({
      title: 'Перевод',
      message: `${requisites}\n\nСумма скопирована в буфер. Откройте приложение банка или СБП и вставьте сумму.`,
      actions: [
        {
          label: 'Я перевёл',
          onPress: () => { setTransferAck(true); setStep('confirm'); },
        },
        ...(Platform.OS !== 'web'
          ? [{
              label: 'Открыть банк',
              onPress: () => {
                showActionConfirm({
                  title: 'Реквизиты скопированы',
                  message: 'Откройте приложение вашего банка или СБП и вставьте реквизиты из буфера.',
                  primaryLabel: 'Понятно',
                  onPrimary: () => undefined,
                });
              },
            }]
          : []),
      ],
    });
  };

  const copySbpAmount = async () => {
    if (busy) return;
    const amountText = String(Math.round(payment.amount));
    await Clipboard.setStringAsync(amountText);
    showActionConfirm({
      title: 'Сумма скопирована',
      message: `${formatRub(payment.amount)} в буфере обмена. Откройте приложение банка и вставьте сумму для перевода по СБП.`,
      primaryLabel: 'Понятно',
      onPrimary: () => undefined,
      ...(Platform.OS !== 'web'
        ? {
            secondaryLabel: 'Подсказка',
            onSecondary: () => {
              showActionConfirm({
                title: 'Сумма в буфере',
                message: 'Откройте приложение банка или СБП и вставьте сумму вручную.',
                primaryLabel: 'Понятно',
                onPrimary: () => undefined,
              });
            },
          }
        : {}),
    });
  };

  const copyRequisites = async () => {
    if (busy) return;
    if (reqMissing) {
      showActionConfirm({ title: 'Реквизиты не указаны', message: reqMissing });
      return;
    }
    await Clipboard.setStringAsync(requisites);
    showActionConfirm({
      title: 'Реквизиты скопированы',
      message: 'Вставьте в приложении банка для перевода по СБП или реквизитам.',
      primaryLabel: 'Понятно',
      onPrimary: () => undefined,
    });
  };

  const goToAcceptance = () => {
    if (busy) return;
    onClose();
    if (stage) {
      pushStageDetail(stage.id, pathname);
      return;
    }
    pushOsNav(repairTabRoute(role, 'control'), pathname, role);
  };

  const payWithCard = async () => {
    if (busy) return;
    if (stageNeedsAcceptance) {
      confirmAcceptanceFirst(goToAcceptance);
      return;
    }
    setCardBusy(true);
    try {
      const pay = await api.checkoutYookassa(userId, projectId, payment.id);
      if (pay.demo) {
        await syncProjectSideEffects({
          user: user ?? ({ id: userId, role: role === 'contractor' ? 'contractor' : 'customer' } as any),
          project: activeProject ?? ({ id: projectId } as any),
          role,
        });
        onChanged?.();
        onClose();
        showActionConfirm({
          title: 'Оплата (demo)',
          message: pay.message || 'Тестовая оплата без реального списания. Для prod настройте YOOKASSA_* на сервере.',
          primaryLabel: 'Понятно',
          onPrimary: () => undefined,
        });
        return;
      }
      if (pay.confirmation_url) {
        await WebBrowser.openBrowserAsync(pay.confirmation_url);
        showActionConfirm({
          title: 'ЮKassa',
          message: 'После оплаты вы вернётесь в приложение. Статус счёта обновится автоматически.',
          primaryLabel: 'Понятно',
          onPrimary: () => undefined,
        });
      }
    } catch (e: unknown) {
      if (e instanceof ApiError && e.status === 409) {
        confirmAcceptanceFirst(goToAcceptance);
      } else if (e instanceof ApiError && e.status === 503) {
        showActionConfirm({
          title: 'ЮKassa',
          message: 'Нет ключей YOOKASSA_* на сервере (staging/prod demo выключен). Задайте YOOKASSA_SHOP_ID и YOOKASSA_SECRET или оплатите по реквизитам/чеку.',
          primaryLabel: 'Понятно',
          onPrimary: () => undefined,
        });
      } else {
        showActionConfirm({
          title: 'Ошибка оплаты',
          message: apiErrorMessage(e, 'Не удалось открыть оплату картой'),
          primaryLabel: 'Понятно',
          onPrimary: () => undefined,
        });
      }
    } finally {
      setCardBusy(false);
    }
  };

  const confirm = async () => {
    if (busy) return;
    if (stageNeedsAcceptance) {
      confirmAcceptanceFirst(goToAcceptance);
      return;
    }
    if (!transferAck && !receiptAttached) {
      showActionConfirm({
        title: 'Подтверждение',
        message: 'Сначала переведите сумму или прикрепите чек.',
        primaryLabel: 'Понятно',
        onPrimary: () => undefined,
      });
      return;
    }
    // Clarity V: money-critical — pre-confirm перед api.confirmPayment
    showActionConfirm({
      title: 'Подтвердить оплату?',
      message: `${formatRub(payment.amount)}. Исполнитель увидит счёт как оплаченный.`,
      primaryLabel: 'Подтвердить',
      onPrimary: () => {
        void (async () => {
          if (confirmBusy) return;
          setConfirmBusy(true);
          try {
            const confirmed = await api.confirmPayment(userId, projectId, payment.id, {
              transfer_ack: Boolean(transferAck || receiptAttached),
            });
            await AsyncStorage.removeItem(paymentReceiptKey(payment.id)).catch(reportCatch('components.renova.PaymentDetailSheet.1'));
            await syncProjectSideEffects({
              user: user ?? ({ id: userId, role: role === 'contractor' ? 'contractor' : 'customer' } as any),
              project: activeProject ?? ({ id: projectId } as any),
              role,
            });
            onChanged?.();
            onClose();
            if (confirmed?.status === 'paid_unverified') {
              showActionConfirm({
                title: 'Принято без проверки',
                message: 'Статус «оплачено, не верифицировано». Прикрепите чек — тогда сумма войдёт в бюджет как подтверждённый факт.',
                primaryLabel: 'Понятно',
                onPrimary: () => undefined,
              });
            } else {
              alertPaymentConfirmed(role);
            }
          } catch (e: unknown) {
            if (e instanceof ApiError && e.status === 409) {
              confirmAcceptanceFirst(goToAcceptance);
            } else {
              showActionConfirm({
                title: 'Ошибка',
                message: apiErrorMessage(e, 'Не удалось подтвердить оплату'),
              });
            }
          } finally {
            setConfirmBusy(false);
          }
        })();
      },
      secondaryLabel: 'Отмена',
      onSecondary: () => undefined,
    });
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={closeSafely}>
      <Pressable style={s.backdrop} onPress={closeSafely}>
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
                Renova фиксирует факт внешнего перевода (СБП/реквизиты/чек), а не проводит банковскую транзакцию внутри приложения.
                Карта — через ЮKassa. Сначала перевод или чек, затем отдельное подтверждение.
              </Text>
              {/* W123: пакетное подтверждение из выписки (1С/банк) */}
              <PrimaryButton
                title="Импорт выписки (пакетно)"
                variant="outline"
                disabled={busy}
                onPress={() => {
                  onClose();
                  pushOsNav('/documents', pathname, role);
                }}
              />
              {stageNeedsAcceptance ? (
                <PrimaryButton title="Перейти к приёмке" onPress={goToAcceptance} disabled={busy} />
              ) : (
                <>
                  <PrimaryButton
                    title="Оплатить картой (ЮKassa)"
                    onPress={payWithCard}
                    loading={cardBusy}
                    disabled={confirmBusy}
                  />
                  <PrimaryButton title="Перевести (СБП / реквизиты)" variant="outline" onPress={() => setStep('transfer')} disabled={busy} />
                  <PrimaryButton title="Прикрепить чек" variant="outline" onPress={openReceipt} disabled={busy} />
                </>
              )}
            </View>
          ) : null}

          {canConfirm && step === 'transfer' ? (
            <View style={s.block}>
              <Text style={s.sectionHead}>Реквизиты</Text>
              {reqMissing ? <Text style={{ color: RenovaTheme.colors.warningText, marginBottom: 8, fontSize: 13 }}>{reqMissing}</Text> : null}
              {!reqLoaded ? <ActivityIndicator /> : null}
              {requisites.split('\n').map((line) => (
                <Text key={line} style={formMetaText.caption}>{line}</Text>
              ))}
              <PrimaryButton title="Скопировать сумму" variant="outline" disabled={busy} onPress={() => { copySbpAmount().catch(() => Alert.alert('Ошибка', 'Не удалось скопировать сумму')); }} />
              <PrimaryButton title="Скопировать реквизиты" variant="outline" disabled={busy} onPress={() => { copyRequisites().catch(() => Alert.alert('Ошибка', 'Не удалось скопировать реквизиты')); }} />
              <PrimaryButton title="Открыть СБП / банк" variant="outline" disabled={busy} onPress={() => { openSbp().catch(reportCatch('payment.openSbp')); }} />
              <PrimaryButton
                title="Я перевёл — дальше"
                disabled={busy}
                onPress={() => { setTransferAck(true); setStep('confirm'); }}
              />
              <PrimaryButton title="Назад" variant="ghost" disabled={busy} onPress={() => setStep('info')} />
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
                loading={confirmBusy}
                disabled={stageNeedsAcceptance || cardBusy}
              />
              {!receiptAttached ? (
                <PrimaryButton title="Прикрепить чек" variant="outline" onPress={openReceipt} disabled={busy} />
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
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={`Открыть этап ${stage.name}`}
              onPress={() => { onClose(); pushStageDetail(stage.id, pathname); }}
            >
              <Text style={s.label}>Этап</Text>
              <Text style={s.link}>{stage.name} →</Text>
            </Pressable>
          ) : null}

          {history.length > 0 && (
            <View style={s.block}>
              <Text style={s.sectionHead}>История</Text>
              {history.map((ev) => (
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

          <PrimaryButton title="Закрыть" variant="ghost" onPress={closeSafely} disabled={busy} />
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
  linkRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: RenovaTheme.minTouch, paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#f0f0f0', marginBottom: 8 },
  link: { fontSize: 14, color: RenovaTheme.colors.primary, fontWeight: '600' },
  wait: { fontSize: 13, color: RenovaTheme.colors.warning, fontWeight: '600', marginBottom: 8 },
  sectionHead: { ...screenTypography.section, color: RenovaTheme.colors.text, marginTop: 0, marginBottom: 2 },
  histRow: { borderTopWidth: 1, borderTopColor: '#f0f0f0', paddingTop: 8 },
  histBody: { gap: 2 },
  histTitle: { fontSize: 13, fontWeight: '700', color: RenovaTheme.colors.text },
  histSub: { fontSize: 12, color: RenovaTheme.colors.textMuted },
  histDate: { fontSize: 11, color: RenovaTheme.colors.textMuted },
});
