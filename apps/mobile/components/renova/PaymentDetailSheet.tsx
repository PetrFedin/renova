/** Детализация счёта — sheet по tap из «Бюджет → Оплаты» */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Platform, Pressable, Text, TextInput, View } from 'react-native';
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
import { reportCatch, reportError } from '@/lib/reportError';

export { PAYMENT_TYPE_LABEL, PAYMENT_STATUS_LABEL } from '@/constants/labels';

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Clarity I: gate приёмки — sheet с CTA, не Alert */
/** 409 «сначала приёмка» отличаем от прочих конфликтов (сумма чека, лимит этапа, счёт уже обработан). */
function isAcceptanceConflict(error: unknown): boolean {
  if (!(error instanceof ApiError) || error.status !== 409) return false;
  if (error.code === 'stage_not_accepted') return true;
  return /примите этап|приёмк/i.test(error.message || '');
}

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
type PaymentMutation = 'card' | 'confirm' | 'dispute' | 'resolveDispute' | 'cancel' | 'edit' | 'received' | 'notReceived' | null;

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
  const [reqError, setReqError] = useState<string | null>(null);
  const [reqReloadTick, setReqReloadTick] = useState(0);
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [disputeReason, setDisputeReason] = useState('');
  const [resolutionOpen, setResolutionOpen] = useState(false);
  const [resolutionNote, setResolutionNote] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [editAmount, setEditAmount] = useState('');

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
    } catch (error) {
      reportError('payment.receiptFlag.storage', error, { paymentId: payment.id });
    }
  }, [payment?.id, payment?.receipt_id]);

  useEffect(() => {
    if (!payment) return;
    mutationRef.current = false;
    setMutation(null);
    setStep('info');
    setTransferAck(false);
    setReceiptAttached(false);
    setDisputeOpen(false);
    setDisputeReason('');
    setResolutionOpen(false);
    setResolutionNote('');
    setEditOpen(false);
    setEditAmount(payment.amount ? String(payment.amount) : '');
    void reloadReceiptFlag().catch(reportCatch('payment.receiptFlag'));
  }, [payment?.id, reloadReceiptFlag]);

  useEffect(() => {
    if (!payment) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && !mutationRef.current) {
        void reloadReceiptFlag().catch(reportCatch('payment.receiptFlag'));
        // Чек мог быть приложен к счёту «без чека» на экране скана — сервер сам подтвердит счёт.
        if (payment.status === 'paid_unverified' || payment.status === 'processing') onChanged?.();
      }
    });
    return () => subscription.remove();
  }, [payment?.id, payment?.status, reloadReceiptFlag, onChanged]);

  useEffect(() => {
    if (!payment || !userId || !projectId) return;
    let cancelled = false;
    setReqLoaded(false);
    setReqText('');
    setReqMissing(null);
    setReqError(null);
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
      } catch (error) {
        if (cancelled) return;
        reportError('payment.requisites.load', error, { userId, projectId, paymentId: payment.id });
        setReqError('Не удалось подтвердить реквизиты на сервере. Не переводите средства до повторной проверки.');
      } finally {
        if (!cancelled) setReqLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [payment?.id, payment?.amount, payment?.title, userId, projectId, reqReloadTick]);

  if (!payment) return null;

  const requisites = reqText;
  const canUseRequisites = reqLoaded && !reqError && !reqMissing && Boolean(reqText.trim());
  const stage = stages.find((candidate) => candidate.id === payment.stage_id);
  const isCustomer = role === 'customer';
  const isContractor = role === 'contractor';
  const canConfirm = isCustomer && !readOnly && payment.status === 'pending';
  // Выходы из «оплачено без проверки» и «в обработке» без админа платформы.
  const canAttachReceiptLater = isCustomer && !readOnly && payment.status === 'paid_unverified';
  const canResumeCard = isCustomer && !readOnly && payment.status === 'processing';
  const canRecipientRespond = isContractor && !readOnly && payment.status === 'paid_unverified';
  const canCancelInvoice = !readOnly && payment.status === 'pending';
  const canEditInvoice = isContractor && !readOnly && payment.status === 'pending';
  const canDispute = isCustomer && !readOnly && ['confirmed', 'paid_unverified'].includes(payment.status);
  const canResolveDispute = isCustomer && !readOnly && payment.status === 'disputed';
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

  const reconcileCommittedPayment = async (operation: string): Promise<boolean> => {
    // Mutation truth comes first: ask the parent to refresh even if broader side effects fail.
    onChanged?.();
    if (!user || user.id !== userId) {
      reportError('payment.postCommit.context', new Error('payment_user_context_mismatch'), {
        operation,
        userId,
        contextUserId: user?.id ?? null,
        projectId,
        paymentId: payment.id,
      });
      return false;
    }
    try {
      const project = activeProject?.id === projectId
        ? activeProject
        : await api.getProject(userId, projectId);
      await syncProjectSideEffects({ user, project, role });
      return true;
    } catch (error) {
      reportError('payment.postCommit.sync', error, { operation, userId, projectId, paymentId: payment.id });
      return false;
    }
  };

  const openReceipt = () => {
    if (mutationRef.current) return;
    // Флаг «чек приложен» ставит только успешный скан (reloadReceiptFlag), а не нажатие кнопки.
    pushOsNav({ pathname: '/scan-receipt', params: { paymentId: payment.id } }, pathname, role);
    showActionConfirm({
      title: 'Чек',
      message: canAttachReceiptLater
        ? 'Чек должен покрывать всю сумму счёта. После сканирования счёт подтвердится автоматически.'
        : 'После сканирования вернитесь к счёту и нажмите «Я оплатил — подтвердить». Чек должен покрывать всю сумму счёта.',
      primaryLabel: canAttachReceiptLater ? 'Понятно' : 'К подтверждению',
      onPrimary: () => { if (!canAttachReceiptLater) setStep('confirm'); },
      secondaryLabel: 'Позже',
      onSecondary: () => undefined,
    });
  };

  const showRequisitesUnavailable = () => {
    showActionConfirm({
      title: reqMissing ? 'Реквизиты не указаны' : 'Реквизиты не подтверждены',
      message: reqMissing || reqError || 'Дождитесь загрузки реквизитов с сервера и повторите.',
      primaryLabel: 'Повторить проверку',
      onPrimary: () => setReqReloadTick((value) => value + 1),
      secondaryLabel: 'Отмена',
      onSecondary: () => undefined,
    });
  };

  const openSbp = async () => {
    if (mutationRef.current) return;
    if (!canUseRequisites) {
      showRequisitesUnavailable();
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
                title: 'Реквизиты подтверждены',
                message: 'Откройте приложение вашего банка или СБП и используйте подтверждённые реквизиты выше.',
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
    if (!canUseRequisites) {
      showRequisitesUnavailable();
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
      if (checkout.demo || checkout.status === 'demo' || checkout.provider === 'mock') {
        reportError('payment.checkout.mockProvider', new Error('payment_checkout_mock_provider'), {
          userId,
          projectId,
          paymentId: payment.id,
          provider: checkout.provider,
          status: checkout.status,
        });
        showActionConfirm({
          title: 'Онлайн-оплата недоступна',
          message: 'Платёжный провайдер находится в тестовом режиме. Реальное списание не выполняется. Используйте только подтверждённые реквизиты или повторите позже.',
          primaryLabel: 'Понятно',
          onPrimary: () => undefined,
        });
        return;
      }
      if (!checkout.confirmation_url) {
        reportError('payment.checkout.missingConfirmationUrl', new Error('payment_confirmation_url_missing'), {
          userId,
          projectId,
          paymentId: payment.id,
          provider: checkout.provider,
          status: checkout.status,
        });
        showActionConfirm({
          title: 'Онлайн-оплата недоступна',
          message: 'Провайдер не вернул ссылку на безопасную оплату. Используйте перевод по подтверждённым реквизитам или повторите позже.',
          primaryLabel: 'Понятно',
          onPrimary: () => undefined,
        });
        return;
      }
      await WebBrowser.openBrowserAsync(checkout.confirmation_url);
      onChanged?.();
      showActionConfirm({
        title: 'ЮKassa',
        message: 'После оплаты статус счёта обновится после подтверждения платёжного провайдера.',
        primaryLabel: 'Понятно',
        onPrimary: () => undefined,
      });
    } catch (error: unknown) {
      if (isAcceptanceConflict(error)) {
        confirmAcceptanceFirst(goToAcceptance);
      } else if (error instanceof ApiError && error.status === 409) {
        onChanged?.();
        showActionConfirm({ title: 'Оплату нельзя начать', message: apiErrorMessage(error, 'Счёт уже обработан. Обновите список.') });
      } else if (error instanceof ApiError && error.status === 503) {
        showActionConfirm({
          title: 'ЮKassa',
          message: 'Карточная оплата не настроена на сервере. Используйте перевод по подтверждённым реквизитам или приложите чек.',
          primaryLabel: 'Понятно',
          onPrimary: () => undefined,
        });
      } else {
        reportError('payment.checkout.open', error, { userId, projectId, paymentId: payment.id });
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
            let confirmed: Awaited<ReturnType<typeof api.confirmPayment>>;
            try {
              confirmed = await api.confirmPayment(userId, projectId, payment.id, {
                transfer_ack: Boolean(transferAck || receiptAttached),
              });
            } catch (error: unknown) {
              if (isAcceptanceConflict(error)) {
                confirmAcceptanceFirst(goToAcceptance);
              } else if (error instanceof ApiError && error.status === 409) {
                showActionConfirm({ title: 'Оплата не подтверждена', message: apiErrorMessage(error, 'Проверьте счёт и повторите.') });
              } else {
                reportError('payment.confirm.mutation', error, { userId, projectId, paymentId: payment.id });
                showActionConfirm({ title: 'Оплата не подтверждена', message: apiErrorMessage(error, 'Повторите операцию.') });
              }
              return;
            }

            await AsyncStorage.removeItem(paymentReceiptKey(payment.id)).catch(reportCatch('payment.receipt.remove'));
            const reconciled = await reconcileCommittedPayment('confirm');
            onClose();
            if (!reconciled) {
              showActionConfirm({
                title: 'Оплата сохранена',
                message: confirmed?.status === 'paid_unverified'
                  ? 'Подтверждение принято без проверки. Не удалось обновить связанные данные — они синхронизируются при следующем обновлении.'
                  : 'Статус оплаты сохранён. Не удалось обновить связанные данные — они синхронизируются при следующем обновлении.',
                primaryLabel: 'Понятно',
                onPrimary: () => undefined,
              });
            } else if (confirmed?.status === 'paid_unverified') {
              showActionConfirm({
                title: 'Принято без проверки',
                message: 'Статус «оплачено без проверки». Приложите чек на полную сумму (кнопка в карточке счёта) или дождитесь, пока исполнитель подтвердит получение денег — тогда сумма войдёт в бюджет.',
                primaryLabel: 'Понятно',
                onPrimary: () => undefined,
              });
            } else {
              alertPaymentConfirmed(role);
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

  const submitDispute = () => {
    if (mutationRef.current) return;
    const reason = disputeReason.trim().replace(/\s+/g, ' ');
    if (reason.length < 10) {
      showActionConfirm({
        title: 'Укажите причину',
        message: 'Опишите основание спора минимум десятью символами.',
        primaryLabel: 'Понятно',
        onPrimary: () => undefined,
      });
      return;
    }
    showActionConfirm({
      title: 'Оспорить оплату?',
      message: `${formatRub(payment.amount)} будет исключено из подтверждённого факта бюджета до разрешения спора. Причина: ${reason}`,
      primaryLabel: 'Оспорить',
      primaryDestructive: true,
      onPrimary: () => {
        void (async () => {
          if (!beginMutation('dispute')) return;
          try {
            try {
              await api.disputePayment(userId, projectId, payment.id, { reason });
            } catch (error: unknown) {
              reportError('payment.dispute.mutation', error, { userId, projectId, paymentId: payment.id });
              showActionConfirm({
                title: 'Спор не открыт',
                message: apiErrorMessage(error, 'Проверьте статус оплаты и повторите операцию.'),
                primaryLabel: 'Понятно',
                onPrimary: () => undefined,
              });
              return;
            }
            const reconciled = await reconcileCommittedPayment('dispute');
            onClose();
            showActionConfirm({
              title: 'Спор открыт',
              message: reconciled
                ? 'Оплата помечена как оспоренная и исключена из подтверждённого факта бюджета.'
                : 'Спор сохранён. Связанные данные не обновились сразу и синхронизируются при следующем обновлении.',
              primaryLabel: 'Понятно',
              onPrimary: () => undefined,
            });
          } finally {
            endMutation();
          }
        })();
      },
      secondaryLabel: 'Отмена',
      onSecondary: () => undefined,
    });
  };

  const submitResolution = () => {
    if (mutationRef.current) return;
    const note = resolutionNote.trim().replace(/\s+/g, ' ');
    if (note.length < 10) {
      showActionConfirm({
        title: 'Добавьте пояснение',
        message: 'Опишите основание отзыва спора минимум десятью символами.',
        primaryLabel: 'Понятно',
        onPrimary: () => undefined,
      });
      return;
    }
    showActionConfirm({
      title: 'Отозвать спор?',
      message: `Сервер восстановит исходный статус оплаты из доказательной истории. Если оплата была подтверждена, ${formatRub(payment.amount)} снова войдёт в факт бюджета.`,
      primaryLabel: 'Отозвать спор',
      onPrimary: () => {
        void (async () => {
          if (!beginMutation('resolveDispute')) return;
          try {
            let result: Awaited<ReturnType<typeof api.resolvePaymentDispute>>;
            try {
              result = await api.resolvePaymentDispute(userId, projectId, payment.id, { note });
            } catch (error: unknown) {
              reportError('payment.dispute.resolve.mutation', error, { userId, projectId, paymentId: payment.id });
              showActionConfirm({
                title: 'Спор не отозван',
                message: apiErrorMessage(error, 'Проверьте статус оплаты и повторите операцию.'),
                primaryLabel: 'Понятно',
                onPrimary: () => undefined,
              });
              return;
            }
            const reconciled = await reconcileCommittedPayment('resolve_dispute');
            onClose();
            showActionConfirm({
              title: 'Спор отозван',
              message: !reconciled
                ? 'Решение сохранено. Связанные данные не обновились сразу и синхронизируются при следующем обновлении.'
                : result.payment.status === 'confirmed'
                  ? 'Оплата и связанный расход снова учитываются в подтверждённом факте бюджета.'
                  : 'Оплата возвращена в статус «оплачено, не верифицировано». Подтверждённый расход не создавался.',
              primaryLabel: 'Понятно',
              onPrimary: () => undefined,
            });
          } finally {
            endMutation();
          }
        })();
      },
      secondaryLabel: 'Отмена',
      onSecondary: () => undefined,
    });
  };

  const runInvoiceMutation = async (
    kind: 'cancel' | 'edit' | 'received' | 'notReceived',
    operation: string,
    call: () => Promise<unknown>,
    doneTitle: string,
    doneMessage: string,
  ) => {
    if (!beginMutation(kind)) return;
    try {
      try {
        await call();
      } catch (error: unknown) {
        reportError(`payment.${operation}.mutation`, error, { userId, projectId, paymentId: payment.id });
        onChanged?.();
        showActionConfirm({
          title: 'Не удалось выполнить',
          message: apiErrorMessage(error, 'Проверьте статус счёта и повторите операцию.'),
          primaryLabel: 'Понятно',
          onPrimary: () => undefined,
        });
        return;
      }
      await reconcileCommittedPayment(operation);
      onClose();
      showActionConfirm({ title: doneTitle, message: doneMessage, primaryLabel: 'Понятно', onPrimary: () => undefined });
    } finally {
      endMutation();
    }
  };

  const cancelInvoice = () => {
    if (mutationRef.current) return;
    showActionConfirm({
      title: isCustomer ? 'Отклонить счёт?' : 'Отозвать счёт?',
      message: `${formatRub(payment.amount)} — «${payment.title}». Счёт станет отменённым; при необходимости можно выставить новый.`,
      primaryLabel: isCustomer ? 'Отклонить' : 'Отозвать',
      primaryDestructive: true,
      onPrimary: () => {
        void runInvoiceMutation(
          'cancel',
          'cancel',
          () => api.cancelPayment(userId, projectId, payment.id, {
            reason: isCustomer ? 'Отклонён заказчиком' : 'Отозван исполнителем',
          }),
          'Счёт отменён',
          'Отменённый счёт не учитывается в оплатах этапа и не мешает завершению объекта.',
        );
      },
      secondaryLabel: 'Назад',
      onSecondary: () => undefined,
    });
  };

  const saveEdit = () => {
    if (mutationRef.current) return;
    const amount = Number(String(editAmount).replace(/\s/g, '').replace(',', '.'));
    if (!Number.isFinite(amount) || amount <= 0) {
      showActionConfirm({ title: 'Проверьте сумму', message: 'Введите сумму счёта больше нуля.', primaryLabel: 'Понятно', onPrimary: () => undefined });
      return;
    }
    void runInvoiceMutation(
      'edit',
      'edit',
      () => api.updatePayment(userId, projectId, payment.id, { amount: Math.round(amount * 100) / 100 }),
      'Счёт исправлен',
      'Заказчик увидит новую сумму счёта.',
    );
  };

  const respondReceived = (received: boolean) => {
    if (mutationRef.current) return;
    showActionConfirm({
      title: received ? 'Деньги получены?' : 'Деньги не получены?',
      message: received
        ? `${formatRub(payment.amount)} войдёт в подтверждённый факт бюджета проекта.`
        : 'Счёт вернётся к заказчику как неоплаченный, он увидит ваш ответ.',
      primaryLabel: received ? 'Деньги получены' : 'Не получены',
      primaryDestructive: !received,
      onPrimary: () => {
        void runInvoiceMutation(
          received ? 'received' : 'notReceived',
          received ? 'recipient_received' : 'recipient_denied',
          () => api.respondPaymentReceived(userId, projectId, payment.id, received
            ? { received: true }
            : { received: false, note: 'Исполнитель не получил перевод' }),
          received ? 'Получение подтверждено' : 'Ответ отправлен',
          received
            ? 'Счёт оплачен, сумма учтена в факте бюджета.'
            : 'Счёт снова ожидает оплаты заказчиком.',
        );
      },
      secondaryLabel: 'Назад',
      onSecondary: () => undefined,
    });
  };

  const footer = canConfirm ? (
    <>
      {step === 'info' ? (
        stageNeedsAcceptance ? (
          <PrimaryButton title="Перейти к приёмке" variant="accent" onPress={goToAcceptance} disabled={busy} fullWidth />
        ) : (
          <>
            <PrimaryButton title="Оплатить картой (ЮKassa)" variant="accent" onPress={() => { void payWithCard(); }} loading={mutation === 'card'} disabled={busy && mutation !== 'card'} fullWidth />
            <PrimaryButton title="Перевести (СБП / реквизиты)" variant="outline" onPress={() => setStep('transfer')} disabled={busy} fullWidth />
            <PrimaryButton title="Прикрепить чек" variant="outline" onPress={openReceipt} disabled={busy} fullWidth />
            {canCancelInvoice ? <PrimaryButton title="Отклонить счёт" variant="dangerOutline" onPress={cancelInvoice} loading={mutation === 'cancel'} disabled={busy && mutation !== 'cancel'} fullWidth /> : null}
          </>
        )
      ) : null}
      {step === 'transfer' ? (
        <>
          <PrimaryButton title="Я перевёл — дальше" onPress={() => { setTransferAck(true); setStep('confirm'); }} disabled={busy || !canUseRequisites} fullWidth />
          <PrimaryButton title="Назад" variant="ghost" onPress={() => setStep('info')} disabled={busy} fullWidth />
        </>
      ) : null}
      {step === 'confirm' ? (
        <>
          <PrimaryButton title="Я оплатил — подтвердить" onPress={confirm} loading={mutation === 'confirm'} disabled={stageNeedsAcceptance || (busy && mutation !== 'confirm')} fullWidth />
          {!receiptAttached ? <PrimaryButton title="Прикрепить чек" variant="outline" onPress={openReceipt} disabled={busy} fullWidth /> : null}
          <PrimaryButton title="Назад" variant="ghost" onPress={() => setStep('transfer')} disabled={busy} fullWidth />
        </>
      ) : null}
      <PrimaryButton title="Закрыть" variant="ghost" onPress={closeSafely} disabled={busy} fullWidth />
    </>
  ) : canDispute ? (
    <>
      {disputeOpen ? (
        <>
          <PrimaryButton title="Подтвердить спор" variant="danger" onPress={submitDispute} loading={mutation === 'dispute'} disabled={busy && mutation !== 'dispute'} fullWidth />
          <PrimaryButton title="Отмена" variant="ghost" onPress={() => { setDisputeOpen(false); setDisputeReason(''); }} disabled={busy} fullWidth />
        </>
      ) : (
        <>
          {canAttachReceiptLater ? <PrimaryButton title="Приложить чек" variant="accent" onPress={openReceipt} disabled={busy} fullWidth /> : null}
          <PrimaryButton title="Оспорить оплату" variant="dangerOutline" onPress={() => setDisputeOpen(true)} disabled={busy} fullWidth />
        </>
      )}
      <PrimaryButton title="Закрыть" variant="ghost" onPress={closeSafely} disabled={busy} fullWidth />
    </>
  ) : canResolveDispute ? (
    <>
      {resolutionOpen ? (
        <>
          <PrimaryButton title="Подтвердить отзыв спора" onPress={submitResolution} loading={mutation === 'resolveDispute'} disabled={busy && mutation !== 'resolveDispute'} fullWidth />
          <PrimaryButton title="Отмена" variant="ghost" onPress={() => { setResolutionOpen(false); setResolutionNote(''); }} disabled={busy} fullWidth />
        </>
      ) : (
        <PrimaryButton title="Отозвать спор" variant="outline" onPress={() => setResolutionOpen(true)} disabled={busy} fullWidth />
      )}
      <PrimaryButton title="Закрыть" variant="ghost" onPress={closeSafely} disabled={busy} fullWidth />
    </>
  ) : canResumeCard ? (
    <>
      <PrimaryButton title="Продолжить оплату картой" variant="accent" onPress={() => { void payWithCard(); }} loading={mutation === 'card'} disabled={busy && mutation !== 'card'} fullWidth />
      <PrimaryButton title="Проверить статус" variant="outline" onPress={() => { onChanged?.(); onClose(); }} disabled={busy} fullWidth />
      <PrimaryButton title="Закрыть" variant="ghost" onPress={closeSafely} disabled={busy} fullWidth />
    </>
  ) : canRecipientRespond ? (
    <>
      <PrimaryButton title="Деньги получены" variant="accent" onPress={() => respondReceived(true)} loading={mutation === 'received'} disabled={busy && mutation !== 'received'} fullWidth />
      <PrimaryButton title="Не получены" variant="dangerOutline" onPress={() => respondReceived(false)} loading={mutation === 'notReceived'} disabled={busy && mutation !== 'notReceived'} fullWidth />
      <PrimaryButton title="Закрыть" variant="ghost" onPress={closeSafely} disabled={busy} fullWidth />
    </>
  ) : canCancelInvoice ? (
    <>
      {editOpen ? (
        <>
          <PrimaryButton title="Сохранить сумму" variant="accent" onPress={saveEdit} loading={mutation === 'edit'} disabled={busy && mutation !== 'edit'} fullWidth />
          <PrimaryButton title="Отмена" variant="ghost" onPress={() => setEditOpen(false)} disabled={busy} fullWidth />
        </>
      ) : (
        <>
          {canEditInvoice ? <PrimaryButton title="Исправить сумму" variant="outline" onPress={() => setEditOpen(true)} disabled={busy} fullWidth /> : null}
          <PrimaryButton title={isCustomer ? 'Отклонить счёт' : 'Отозвать счёт'} variant="dangerOutline" onPress={cancelInvoice} loading={mutation === 'cancel'} disabled={busy && mutation !== 'cancel'} fullWidth />
        </>
      )}
      <PrimaryButton title="Закрыть" variant="ghost" onPress={closeSafely} disabled={busy} fullWidth />
    </>
  ) : (
    <PrimaryButton title="Закрыть" variant="ghost" onPress={closeSafely} disabled={busy} fullWidth />
  );

  return (
    <SheetSurface visible value={formatRub(payment.amount)} title={payment.title} subtitle={`${statusLabel} · ${typeLabel}`} busy={busy} onClose={closeSafely} accessibilityLabel="Детали счёта" footer={footer}>
      {canConfirm ? <Text style={formMetaText.caption}>Шаг {step === 'info' ? 1 : step === 'transfer' ? 2 : 3} из 3 · перевод → подтверждение</Text> : null}

      {canConfirm && step === 'info' ? (
        <View style={sheetContentStyles.section}>
          {stageNeedsAcceptance ? <InfoBanner tone="warning" title="Этап ждёт приёмки" message={PAYMENT_BLOCKED_ACCEPTANCE_MSG} /> : null}
          <Text style={formMetaText.caption}>Renova фиксирует факт внешнего перевода, СБП или чека, а не проводит банковскую транзакцию внутри приложения.</Text>
          <PrimaryButton title="Импорт выписки (пакетно)" variant="outline" disabled={busy} onPress={() => { onClose(); pushOsNav('/documents', pathname, role); }} fullWidth />
        </View>
      ) : null}

      {canConfirm && step === 'transfer' ? (
        <View style={sheetContentStyles.section}>
          <Text style={screenTypography.section}>Реквизиты</Text>
          {!reqLoaded ? <ActivityIndicator color={RenovaTheme.colors.primary} /> : null}
          {reqError ? <InfoBanner tone="warning" title="Реквизиты не подтверждены" message={reqError} /> : null}
          {reqMissing && !reqError ? <InfoBanner tone="warning" title="Реквизиты не заполнены" message={reqMissing} /> : null}
          {canUseRequisites ? requisites.split('\n').filter(Boolean).map((line, index) => <Text key={`${line}:${index}`} style={formMetaText.caption}>{line}</Text>) : null}
          {!canUseRequisites && reqLoaded ? <PrimaryButton title="Повторить проверку реквизитов" variant="outline" disabled={busy} onPress={() => setReqReloadTick((value) => value + 1)} fullWidth /> : null}
          <PrimaryButton title="Скопировать сумму" variant="outline" disabled={busy} onPress={() => { void copySbpAmount(); }} fullWidth />
          <PrimaryButton title="Скопировать реквизиты" variant="outline" disabled={busy || !canUseRequisites} onPress={() => { void copyRequisites(); }} fullWidth />
          <PrimaryButton title="Открыть СБП / банк" variant="outline" disabled={busy || !canUseRequisites} onPress={() => { void openSbp(); }} fullWidth />
        </View>
      ) : null}

      {canConfirm && step === 'confirm' ? <Text style={formMetaText.caption}>{transferAck ? 'Перевод отмечен.' : ''}{receiptAttached ? ' Чек будет в расходах.' : ''} Подтвердите оплату для исполнителя.</Text> : null}

      {canDispute && disputeOpen ? (
        <View style={sheetContentStyles.section}>
          <InfoBanner tone="warning" title="Финансовый спор" message="После подтверждения оплата и связанный расход перестанут учитываться как подтверждённый факт бюджета. Причина сохранится в истории." />
          <Text style={sheetContentStyles.fieldLabel}>Причина спора</Text>
          <TextInput value={disputeReason} onChangeText={setDisputeReason} editable={!busy} multiline maxLength={1000} textAlignVertical="top" placeholder="Опишите недостатки, расхождение суммы или отсутствие подтверждения" accessibilityLabel="Причина спора по оплате" style={[sheetContentStyles.input, { minHeight: 96 }]} />
          <Text style={formMetaText.caption}>{disputeReason.trim().length}/1000 · минимум 10 символов</Text>
        </View>
      ) : null}

      {canResolveDispute && resolutionOpen ? (
        <View style={sheetContentStyles.section}>
          <InfoBanner tone="info" title="Отзыв спора" message="Исходный статус будет восстановлен только из серверной истории. Для подтверждённой оплаты связанный расход снова войдёт в бюджет." />
          <Text style={sheetContentStyles.fieldLabel}>Основание отзыва</Text>
          <TextInput value={resolutionNote} onChangeText={setResolutionNote} editable={!busy} multiline maxLength={1000} textAlignVertical="top" placeholder="Опишите, почему спор урегулирован или был открыт ошибочно" accessibilityLabel="Основание отзыва спора" style={[sheetContentStyles.input, { minHeight: 96 }]} />
          <Text style={formMetaText.caption}>{resolutionNote.trim().length}/1000 · минимум 10 символов</Text>
        </View>
      ) : null}

      {editOpen && canEditInvoice ? (
        <View style={sheetContentStyles.section}>
          <Text style={sheetContentStyles.fieldLabel}>Новая сумма, ₽</Text>
          <TextInput value={editAmount} onChangeText={setEditAmount} editable={!busy} keyboardType="decimal-pad" accessibilityLabel="Новая сумма счёта" style={sheetContentStyles.input} />
          <Text style={formMetaText.caption}>Сумма всех счетов этапа не может быть больше суммы этапа.</Text>
        </View>
      ) : null}

      {payment.status === 'paid_unverified' ? (
        <InfoBanner
          tone="warning"
          title="Оплачено без проверки"
          message={isContractor
            ? `Заказчик отметил перевод на ${formatRub(payment.amount)}. Если деньги пришли, подтвердите — сумма войдёт в факт бюджета. Если нет — счёт вернётся заказчику.`
            : 'Сумма пока не в подтверждённом факте. Приложите чек на полную сумму счёта или дождитесь, пока исполнитель подтвердит получение денег.'}
        />
      ) : null}

      {payment.status === 'processing' ? (
        <InfoBanner tone="info" title="Оплата в обработке" message="Платёж передан в ЮKassa и ждёт подтверждения. Если вы закрыли страницу оплаты — продолжите её или проверьте статус." />
      ) : null}

      {payment.status === 'cancelled' ? <InfoBanner tone="info" title="Счёт отменён" message="Сумма не учитывается в оплатах этапа. При необходимости исполнитель выставит новый счёт." /> : null}

      {payment.status === 'disputed' ? <InfoBanner tone="warning" title="Оплата оспорена" message="Сумма не учитывается как подтверждённый факт бюджета до разрешения спора или возврата." /> : null}

      <View style={sheetContentStyles.row}><Text style={sheetContentStyles.label}>Тип</Text><Text style={sheetContentStyles.value}>{typeLabel}</Text></View>
      <View style={sheetContentStyles.row}><Text style={sheetContentStyles.label}>Выставлен</Text><Text style={sheetContentStyles.value}>{fmtDate(payment.created_at)}</Text></View>
      {payment.confirmed_at ? <View style={sheetContentStyles.row}><Text style={sheetContentStyles.label}>Оплачен</Text><Text style={sheetContentStyles.value}>{fmtDate(payment.confirmed_at)}</Text></View> : null}
      {stage ? (
        <Pressable style={sheetContentStyles.row} disabled={busy} accessibilityRole="button" accessibilityLabel={`Открыть этап ${stage.name}`} onPress={() => { onClose(); pushStageDetail(stage.id, pathname); }}>
          <Text style={sheetContentStyles.label}>Этап</Text><Text style={sheetContentStyles.link}>{stage.name} →</Text>
        </Pressable>
      ) : null}

      {history.length > 0 ? (
        <View style={sheetContentStyles.section}>
          <Text style={screenTypography.section}>История</Text>
          {history.map((event) => (
            <View key={event.id} style={sheetContentStyles.row}><View style={{ flex: 1 }}><Text style={screenTypography.listTitle}>{event.title}</Text>{event.subtitle ? <Text style={screenTypography.listMeta}>{event.subtitle}</Text> : null}<Text style={screenTypography.metricLabel}>{formatPaymentEventDate(event.at)}</Text></View></View>
          ))}
        </View>
      ) : null}

      {!isCustomer && payment.status === 'pending' ? <Text style={[sheetContentStyles.note, { color: RenovaTheme.colors.warningText }]}>Ожидает оплаты заказчиком</Text> : null}
    </SheetSurface>
  );
}
