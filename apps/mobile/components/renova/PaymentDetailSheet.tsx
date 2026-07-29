/** Детализация счёта — sheet по tap из «Бюджет → Оплаты» */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Platform, Pressable, Text, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Clipboard from 'expo-clipboard';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { usePathname } from 'expo-router';

import { InfoBanner } from '@/components/ui/InfoBanner';
import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { SheetSurface, sheetContentStyles } from '@/components/renova/SheetSurface';
import { RenovaTheme, formatRub } from '@/constants/Theme';
import { screenTypography } from '@/constants/screenTypography';
import { formMetaText } from '@/constants/formTypography';
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
import { reportCatch } from '@/lib/reportError';

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
type PaymentMutation = 'card' | 'confirm' | null;

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
  const [mutation, setMutation] = useState<PaymentMutation>(null);
  const mutationRef = useRef(false);
  const [reqText, setReqText] = useState('');
  const [reqMissing, setReqMissing] = useState<string | null>(null);
  const [reqLoaded, setReqLoaded] = useState(false);

  const reloadReceiptFlag = useCallback(async () => {
    if (!payment) return;
    if (payment.receipt_id) {
      setReceiptAttached(true);
      setStep((current) => (current === 'info' ? 'confirm' : current));
      return;
    }
    try {
      const value = await AsyncStorage.getItem(paymentReceiptKey(payment.id));
      if (value === '1') {
        setReceiptAttached(true);
        setStep((current) => (current === 'info' ? 'confirm' : current));
      }
    } catch {
      // Storage is only a fallback until the API receipt relation is synced.
    }
  }, [payment?.id, payment?.receipt_id]);

  useEffect(() => {
    if (!payment) return;
    mutationRef.current = false;
    setMutation(null);
    setStep('info');
    setTransferAck(false);
    setReceiptAttached(false);
    void reloadReceiptFlag().catch(reportCatch('payment.receiptFlag'));
  }, [payment?.id, reloadReceiptFlag]);

  useEffect(() => {
    if (!payment) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && !mutationRef.current) {
        void reloadReceiptFlag().catch(reportCatch('payment.receiptFlag'));
      }
    });
    return () => subscription.remove();
  }, [payment?.id, reloadReceiptFlag]);

  useEffect(() => {
    if (!payment || !userId || !projectId) return;
    let cancelled = false;
    setReqLoaded(false);
    setReqText('');
    setReqMissing(null);
    void (async () => {
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
        const built = buildPaymentRequisites({ amount: payment.amount, title: payment.title });
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
  const stage = stages.find((candidate) => candidate.id === payment.stage_id);
  const isCustomer = role === 'customer';
  const canConfirm = isCustomer && !readOnly && payment.status === 'pending';
  const stageNeedsAcceptance = Boolean(stage && stage.status !== 'done');
  const statusLabel = PAYMENT_STATUS_LABEL[payment.status] || payment.status;
  const typeLabel = PAYMENT_TYPE_LABEL[payment.payment_type] || payment.payment_type;
  const history = buildPaymentHistory(payment);
  const busy = mutation !== null;

  const closeSafely = () => {
    if (!mutationRef.current) onClose();
  };

  const beginMutation = (next: Exclude<PaymentMutation, null>): boolean => {
    if (mutationRef.current) return false;
    mutationRef.current = true;
    setMutation(next);
    return true;
  };

  const endMutation = () => {
    mutationRef.current = false;
    setMutation(null);
  };

  const openReceipt = () => {
    if (mutationRef.current) return;
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
    if (mutationRef.current) return;
    if (reqMissing) {
      showActionConfirm({ title: 'Реквизиты не указаны', message: reqMissing });
      return;
    }
    try {
      await Clipboard.setStringAsync(String(Math.round(payment.amount)));
    } catch {
      showActionConfirm({ title: 'Сумма не скопирована', message: 'Скопируйте сумму вручную из карточки счёта.' });
      return;
    }
    showActionConfirm({
      title: 'Перевод',
      message: `${requisites}\n\nСумма скопирована в буфер. Откройте приложение банка или СБП и вставьте сумму.`,
      actions: [
        { label: 'Я перевёл', onPress: () => { setTransferAck(true); setStep('confirm'); } },
        ...(Platform.OS !== 'web'
          ? [{
              label: 'Открыть банк',
              onPress: () => showActionConfirm({
                title: 'Реквизиты скопированы',
                message: 'Откройте приложение вашего банка или СБП и вставьте реквизиты из буфера.',
                primaryLabel: 'Понятно',
                onPrimary: () => undefined,
              }),
            }]
          : []),
      ],
    });
  };

  const copySbpAmount = async () => {
    if (mutationRef.current) return;
    try {
      await Clipboard.setStringAsync(String(Math.round(payment.amount)));
      showActionConfirm({
        title: 'Сумма скопирована',
        message: `${formatRub(payment.amount)} в буфере обмена. Вставьте сумму в приложении банка или СБП.`,
        primaryLabel: 'Понятно',
        onPrimary: () => undefined,
      });
    } catch {
      showActionConfirm({ title: 'Сумма не скопирована', message: 'Скопируйте сумму вручную из карточки счёта.' });
    }
  };

  const copyRequisites = async () => {
    if (mutationRef.current) return;
    if (reqMissing) {
      showActionConfirm({ title: 'Реквизиты не указаны', message: reqMissing });
      return;
    }
    try {
      await Clipboard.setStringAsync(requisites);
      showActionConfirm({
        title: 'Реквизиты скопированы',
        message: 'Вставьте их в приложении банка для перевода по СБП или реквизитам.',
        primaryLabel: 'Понятно',
        onPrimary: () => undefined,
      });
    } catch {
      showActionConfirm({ title: 'Реквизиты не скопированы', message: 'Выделите и скопируйте реквизиты вручную.' });
    }
  };

  const goToAcceptance = () => {
    if (mutationRef.current) return;
    onClose();
    if (stage) {
      pushStageDetail(stage.id, pathname);
      return;
    }
    pushOsNav(repairTabRoute(role, 'control'), pathname, role);
  };

  const payWithCard = async () => {
    if (stageNeedsAcceptance) {
      confirmAcceptanceFirst(goToAcceptance);
      return;
    }
    if (!beginMutation('card')) return;
    try {
      const checkout = await api.checkoutYookassa(userId, projectId, payment.id);
      if (checkout.demo) {
        await syncProjectSideEffects({
          user: user ?? ({ id: userId, role } as never),
          project: activeProject ?? ({ id: projectId } as never),
          role,
        });
        onChanged?.();
        onClose();
        showActionConfirm({
          title: 'Оплата (demo)',
          message: checkout.message || 'Тестовая оплата без реального списания. Для prod настройте YOOKASSA_* на сервере.',
          primaryLabel: 'Понятно',
          onPrimary: () => undefined,
        });
        return;
      }
      if (checkout.confirmation_url) {
        await WebBrowser.openBrowserAsync(checkout.confirmation_url);
        showActionConfirm({
          title: 'ЮKassa',
          message: 'После оплаты вы вернётесь в приложение. Статус счёта обновится автоматически.',
          primaryLabel: 'Понятно',
          onPrimary: () => undefined,
        });
      }
    } catch (error: unknown) {
      if (error instanceof ApiError && error.status === 409) {
        confirmAcceptanceFirst(goToAcceptance);
      } else if (error instanceof ApiError && error.status === 503) {
        showActionConfirm({
          title: 'ЮKassa',
          message: 'Карточная оплата не настроена на сервере. Используйте перевод по реквизитам или приложите чек.',
          primaryLabel: 'Понятно',
          onPrimary: () => undefined,
        });
      } else {
        showActionConfirm({ title: 'Ошибка оплаты', message: apiErrorMessage(error, 'Не удалось открыть оплату картой') });
      }
    } finally {
      endMutation();
    }
  };

  const confirm = () => {
    if (mutationRef.current) return;
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
    showActionConfirm({
      title: 'Подтвердить оплату?',
      message: `${formatRub(payment.amount)}. Исполнитель увидит счёт как оплаченный.`,
      primaryLabel: 'Подтвердить',
      onPrimary: () => {
        void (async () => {
          if (!beginMutation('confirm')) return;
          try {
            const confirmed = await api.confirmPayment(userId, projectId, payment.id, {
              transfer_ack: Boolean(transferAck || receiptAttached),
            });
            await AsyncStorage.removeItem(paymentReceiptKey(payment.id)).catch(reportCatch('payment.receipt.remove'));
            await syncProjectSideEffects({
              user: user ?? ({ id: userId, role } as never),
              project: activeProject ?? ({ id: projectId } as never),
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
          } catch (error: unknown) {
            if (error instanceof ApiError && error.status === 409) {
              confirmAcceptanceFirst(goToAcceptance);
            } else {
              showActionConfirm({ title: 'Оплата не подтверждена', message: apiErrorMessage(error, 'Повторите операцию.') });
            }
          } finally {
            endMutation();
          }
        })();
      },
      secondaryLabel: 'Отмена',
      onSecondary: () => undefined,
    });
  };

  const footer = canConfirm ? (
    <>
      {step === 'info' ? (
        stageNeedsAcceptance ? (
          <PrimaryButton
            title="Перейти к приёмке"
            onPress={goToAcceptance}
            disabled={busy}
            fullWidth
          />
        ) : (
          <>
            <PrimaryButton
              title="Оплатить картой (ЮKassa)"
              onPress={() => { void payWithCard(); }}
              loading={mutation === 'card'}
              disabled={busy && mutation !== 'card'}
              fullWidth
            />
            <PrimaryButton
              title="Перевести (СБП / реквизиты)"
              variant="outline"
              onPress={() => setStep('transfer')}
              disabled={busy}
              fullWidth
            />
            <PrimaryButton
              title="Прикрепить чек"
              variant="outline"
              onPress={openReceipt}
              disabled={busy}
              fullWidth
            />
          </>
        )
      ) : null}
      {step === 'transfer' ? (
        <>
          <PrimaryButton
            title="Я перевёл — дальше"
            onPress={() => { setTransferAck(true); setStep('confirm'); }}
            disabled={busy}
            fullWidth
          />
          <PrimaryButton title="Назад" variant="ghost" onPress={() => setStep('info')} disabled={busy} fullWidth />
        </>
      ) : null}
      {step === 'confirm' ? (
        <>
          <PrimaryButton
            title="Я оплатил — подтвердить"
            onPress={confirm}
            loading={mutation === 'confirm'}
            disabled={stageNeedsAcceptance || (busy && mutation !== 'confirm')}
            fullWidth
          />
          {!receiptAttached ? (
            <PrimaryButton title="Прикрепить чек" variant="outline" onPress={openReceipt} disabled={busy} fullWidth />
          ) : null}
          <PrimaryButton title="Назад" variant="ghost" onPress={() => setStep('transfer')} disabled={busy} fullWidth />
        </>
      ) : null}
      <PrimaryButton title="Закрыть" variant="ghost" onPress={closeSafely} disabled={busy} fullWidth />
    </>
  ) : (
    <PrimaryButton title="Закрыть" variant="ghost" onPress={closeSafely} disabled={busy} fullWidth />
  );

  return (
    <SheetSurface
      visible
      value={formatRub(payment.amount)}
      title={payment.title}
      subtitle={`${statusLabel} · ${typeLabel}`}
      busy={busy}
      onClose={closeSafely}
      accessibilityLabel="Детали счёта"
      footer={footer}
    >
      {canConfirm ? (
        <Text style={formMetaText.caption}>
          Шаг {step === 'info' ? 1 : step === 'transfer' ? 2 : 3} из 3 · перевод → подтверждение
        </Text>
      ) : null}

      {canConfirm && step === 'info' ? (
        <View style={sheetContentStyles.section}>
          {stageNeedsAcceptance ? (
            <InfoBanner tone="warning" title="Этап ждёт приёмки" message={PAYMENT_BLOCKED_ACCEPTANCE_MSG} />
          ) : null}
          <Text style={formMetaText.caption}>
            Renova фиксирует факт внешнего перевода, СБП или чека, а не проводит банковскую транзакцию внутри приложения.
          </Text>
          <PrimaryButton
            title="Импорт выписки (пакетно)"
            variant="outline"
            disabled={busy}
            onPress={() => {
              onClose();
              pushOsNav('/documents', pathname, role);
            }}
            fullWidth
          />
        </View>
      ) : null}

      {canConfirm && step === 'transfer' ? (
        <View style={sheetContentStyles.section}>
          <Text style={screenTypography.section}>Реквизиты</Text>
          {reqMissing ? <Text style={[sheetContentStyles.note, { color: RenovaTheme.colors.warningText }]}>{reqMissing}</Text> : null}
          {!reqLoaded ? <ActivityIndicator color={RenovaTheme.colors.primary} /> : null}
          {requisites.split('\n').filter(Boolean).map((line, index) => (
            <Text key={`${line}:${index}`} style={formMetaText.caption}>{line}</Text>
          ))}
          <PrimaryButton title="Скопировать сумму" variant="outline" disabled={busy} onPress={() => { void copySbpAmount(); }} fullWidth />
          <PrimaryButton title="Скопировать реквизиты" variant="outline" disabled={busy} onPress={() => { void copyRequisites(); }} fullWidth />
          <PrimaryButton title="Открыть СБП / банк" variant="outline" disabled={busy} onPress={() => { void openSbp(); }} fullWidth />
        </View>
      ) : null}

      {canConfirm && step === 'confirm' ? (
        <Text style={formMetaText.caption}>
          {transferAck ? 'Перевод отмечен.' : ''}{receiptAttached ? ' Чек будет в расходах.' : ''} Подтвердите оплату для исполнителя.
        </Text>
      ) : null}

      <View style={sheetContentStyles.row}>
        <Text style={sheetContentStyles.label}>Тип</Text>
        <Text style={sheetContentStyles.value}>{typeLabel}</Text>
      </View>
      <View style={sheetContentStyles.row}>
        <Text style={sheetContentStyles.label}>Выставлен</Text>
        <Text style={sheetContentStyles.value}>{fmtDate(payment.created_at)}</Text>
      </View>
      {payment.confirmed_at ? (
        <View style={sheetContentStyles.row}>
          <Text style={sheetContentStyles.label}>Оплачен</Text>
          <Text style={sheetContentStyles.value}>{fmtDate(payment.confirmed_at)}</Text>
        </View>
      ) : null}
      {stage ? (
        <Pressable
          style={sheetContentStyles.row}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={`Открыть этап ${stage.name}`}
          onPress={() => { onClose(); pushStageDetail(stage.id, pathname); }}
        >
          <Text style={sheetContentStyles.label}>Этап</Text>
          <Text style={sheetContentStyles.link}>{stage.name} →</Text>
        </Pressable>
      ) : null}

      {history.length > 0 ? (
        <View style={sheetContentStyles.section}>
          <Text style={screenTypography.section}>История</Text>
          {history.map((event) => (
            <View key={event.id} style={sheetContentStyles.row}>
              <View style={{ flex: 1 }}>
                <Text style={screenTypography.listTitle}>{event.title}</Text>
                {event.subtitle ? <Text style={screenTypography.listMeta}>{event.subtitle}</Text> : null}
                <Text style={screenTypography.metricLabel}>{formatPaymentEventDate(event.at)}</Text>
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {!isCustomer && payment.status === 'pending' ? (
        <Text style={[sheetContentStyles.note, { color: RenovaTheme.colors.warningText }]}>Ожидает подтверждения заказчиком</Text>
      ) : null}
    </SheetSurface>
  );
}
