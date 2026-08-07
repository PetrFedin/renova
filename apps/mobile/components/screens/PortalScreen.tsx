import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  AppState,
  Linking,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import * as WebBrowser from 'expo-web-browser';

import { PrimaryButton } from '@/components/renova/PrimaryButton';
import { PaymentDetailSheet } from '@/components/renova/PaymentDetailSheet';
import { RenovaTheme, formatRub } from '@/constants/Theme';
import { PAYMENT_BLOCKED_ACCEPTANCE_MSG } from '@/constants/labels';
import { listRowStyles, screenTypography } from '@/constants/screenTypography';
import { api, ApiError, type Payment, type Stage } from '@/lib/api';
import { setAccessToken } from '@/lib/api/client';
import {
  buildPortalCapabilities,
  buildPortalPendingSummary,
  portalActionVariant,
  portalMutationKey,
  type PortalActionIntent,
} from '@/lib/domain/portalActions';
import { apiErrorMessage } from '@/lib/formatPhone';
import { buildPaymentRequisites } from '@/lib/paymentRequisites';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import { showActionConfirm } from '@/lib/actionConfirmBus';
import { reportError } from '@/lib/reportError';

const PORTAL_USER_KEY = 'renova:portal:user';

type PortalSession = Awaited<ReturnType<typeof api.exchangePortalToken>>;
type PortalSnapshot = Awaited<ReturnType<typeof api.portalSnapshot>>;
type PortalAcceptance = NonNullable<PortalSnapshot['pending_acceptances']>[number];
type PortalChangeOrder = NonNullable<PortalSnapshot['pending_change_orders']>[number];
type PortalPayment = PortalSnapshot['pending_payments'][number];
type PortalDocument = PortalSnapshot['documents'][number];
type PortalSchedule = { current_stage?: string; progress_percent?: number; planned_end?: string };

type MutationOptions<T> = {
  refresh?: boolean;
  errorTitle?: string;
  errorFallback?: string;
  onSuccess?: (result: T, next: PortalSnapshot | null) => void | Promise<void>;
  onError?: (error: unknown) => void;
};

type ConfirmedMutation<T> = MutationOptions<T> & {
  key: string;
  title: string;
  message: string;
  primaryLabel: string;
  intent?: PortalActionIntent;
  task: () => Promise<T>;
};

/**
 * RN 0.85 runtime still delivers View.onLayout as nativeEvent.layout. Keep the
 * portal boundary structural so React/RN type drift cannot leak `any` into the
 * rest of the screen, and ignore malformed events instead of crashing scroll.
 */
function portalLayoutY(event: unknown): number | null {
  if (typeof event !== 'object' || event === null || !('nativeEvent' in event)) return null;
  const nativeEvent = event.nativeEvent;
  if (typeof nativeEvent !== 'object' || nativeEvent === null || !('layout' in nativeEvent)) return null;
  const layout = nativeEvent.layout;
  if (typeof layout !== 'object' || layout === null || !('y' in layout)) return null;
  return typeof layout.y === 'number' && Number.isFinite(layout.y) ? layout.y : null;
}

function PortalSection({
  title,
  subtitle,
  children,
  focused,
  onLayout,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  focused?: boolean;
  onLayout?: (event: unknown) => void;
}) {
  return (
    <View style={[styles.section, focused && styles.sectionFocused]} onLayout={onLayout}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {subtitle ? <Text style={styles.meta}>{subtitle}</Text> : null}
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function PortalActionRow({ children }: { children: ReactNode }) {
  return <View style={styles.actionRow}>{children}</View>;
}

function PortalState({ title, hint, loading }: { title: string; hint?: string; loading?: boolean }) {
  return (
    <View style={styles.center}>
      {loading ? <ActivityIndicator size="large" color={RenovaTheme.colors.primary} /> : null}
      <Text style={styles.stateTitle}>{title}</Text>
      {hint ? <Text style={styles.meta}>{hint}</Text> : null}
    </View>
  );
}

export default function PortalScreen() {
  const { token, paid, paymentId } = useLocalSearchParams<{
    token?: string;
    paid?: string;
    paymentId?: string;
  }>();
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [session, setSession] = useState<PortalSession | null>(null);
  const [portalToken, setPortalToken] = useState('');
  const [snapshot, setSnapshot] = useState<PortalSnapshot | null>(null);
  const [focusSection, setFocusSection] = useState<'payments' | 'documents' | null>(null);
  const [mutationKey, setMutationKey] = useState<string | null>(null);
  const mutationRef = useRef(false);
  const scrollRef = useRef<ScrollView>(null);
  const paymentsY = useRef(0);
  const documentsY = useRef(0);
  const [sheetPayment, setSheetPayment] = useState<Payment | null>(null);
  const [sheetStages, setSheetStages] = useState<Stage[]>([]);

  const refreshPortalSnapshot = useCallback(async (currentSession: PortalSession) => {
    const next = await api.portalSnapshot(currentSession.user_id, currentSession.project_id);
    setSnapshot(next);

    // Portal snapshot itself is enough to render this surface. Global inbox/home
    // sync is best-effort and must use real API entities, never fabricated IDs.
    void Promise.all([
      api.me(currentSession.user_id),
      api.getProject(currentSession.user_id, currentSession.project_id),
    ]).then(([realUser, realProject]) => syncProjectSideEffects({
      user: realUser,
      project: realProject,
      role: 'customer',
    })).catch((error) => reportError('components.screens.PortalScreen.SideEffectRefresh', error));
    return next;
  }, []);

  const runPortalMutation = useCallback(async <T,>(
    key: string,
    task: () => Promise<T>,
    options: MutationOptions<T> = {},
  ): Promise<T | null> => {
    if (!session || mutationRef.current) return null;
    mutationRef.current = true;
    setMutationKey(key);
    try {
      let result: T;
      try {
        result = await task();
      } catch (error) {
        if (options.onError) {
          options.onError(error);
        } else {
          showActionConfirm({
            title: options.errorTitle ?? 'Не удалось выполнить действие',
            message: apiErrorMessage(error, options.errorFallback ?? 'Повторите попытку.'),
          });
        }
        return null;
      }

      // Everything below is post-commit reconciliation. A refresh or success-UI
      // failure must never make a completed server mutation look rejected.
      let next = snapshot;
      if (options.refresh !== false) {
        try {
          next = await refreshPortalSnapshot(session);
        } catch (error) {
          reportError('components.screens.PortalScreen.PostCommitRefresh', error);
        }
      }
      try {
        await options.onSuccess?.(result, next);
      } catch (error) {
        reportError('components.screens.PortalScreen.PostCommitSuccessUi', error);
      }
      return result;
    } finally {
      mutationRef.current = false;
      setMutationKey(null);
    }
  }, [refreshPortalSnapshot, session, snapshot]);

  const confirmMutation = useCallback(<T,>({
    key,
    title,
    message,
    primaryLabel,
    intent = 'primary',
    task,
    ...options
  }: ConfirmedMutation<T>) => {
    if (mutationRef.current) return;
    showActionConfirm({
      title,
      message,
      primaryLabel,
      primaryDestructive: intent === 'destructive',
      onPrimary: () => { void runPortalMutation(key, task, options); },
      secondaryLabel: 'Отмена',
      onSecondary: () => undefined,
    });
  }, [runPortalMutation]);

  const scrollToSection = useCallback((section: 'payments' | 'documents') => {
    setFocusSection(section);
    const y = section === 'payments' ? paymentsY.current : documentsY.current;
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ y: Math.max(0, y - 12), animated: true });
    });
  }, []);

  const openPaymentSheet = useCallback((payment: PortalPayment) => {
    const stageId = payment.stage_id ?? null;
    const needsAcceptance = Boolean(payment.needs_acceptance);
    setSheetPayment({
      id: payment.id,
      title: payment.title,
      amount: payment.amount,
      payment_type: payment.payment_type || 'stage',
      status: payment.status,
      stage_id: stageId,
      notes: null,
      confirmed_at: null,
      created_at: '',
    });
    setSheetStages(stageId ? [{
      id: stageId,
      name: 'Этап',
      sort_order: 0,
      status: needsAcceptance ? 'review' : 'done',
      percent_complete: needsAcceptance ? 90 : 100,
      payment_amount: payment.amount,
      customer_accepted_at: needsAcceptance ? null : new Date().toISOString(),
    }] : []);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const rawToken = typeof token === 'string' ? token : '';
      if (!rawToken) {
        if (!cancelled) {
          setErrorMessage('Нужна действующая ссылка на портал.');
          setLoadState('error');
        }
        return;
      }
      try {
        setPortalToken(rawToken);
        const nextSession = await api.exchangePortalToken(rawToken);
        if (nextSession.access_token) setAccessToken(nextSession.access_token);
        await AsyncStorage.setItem(PORTAL_USER_KEY, nextSession.user_id);
        const nextSnapshot = await api.portalSnapshot(nextSession.user_id, nextSession.project_id);
        if (cancelled) return;
        setSession(nextSession);
        setSnapshot(nextSnapshot);
        setLoadState('ready');
        if (paid === '1') {
          showActionConfirm({
            title: 'Оплата',
            message: paymentId ? `Платёж ${paymentId} обрабатывается.` : 'Статус оплаты обновлён.',
          });
        }
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(apiErrorMessage(error, 'Ссылка недействительна, истекла или объект недоступен.'));
          setLoadState('error');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [token, paid, paymentId]);

  useEffect(() => {
    if (!session) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active' || mutationRef.current) return;
      void refreshPortalSnapshot(session).catch((error) => reportError('components.screens.PortalScreen.AppStateRefresh', error));
    });
    return () => subscription.remove();
  }, [refreshPortalSnapshot, session]);

  if (loadState === 'loading') {
    return <PortalState loading title="Открываем портал…" />;
  }

  if (loadState === 'error' || !session || !snapshot) {
    return <PortalState title="Портал недоступен" hint={errorMessage || 'Не удалось загрузить объект.'} />;
  }

  const capabilities = buildPortalCapabilities(session, snapshot);
  const pending = buildPortalPendingSummary(snapshot);
  const schedule = snapshot.schedule as PortalSchedule;
  const progress = Math.min(100, Math.max(0, Number(schedule.progress_percent ?? snapshot.project.progress_percent ?? 0)));
  const busy = mutationKey !== null;
  const pendingDocuments = snapshot.documents.filter((document) => document.status === 'draft');
  const canDecideEstimate = capabilities.accept
    && Boolean(snapshot.estimate_summary?.proposed_at)
    && !snapshot.estimate_summary?.locked_at;

  const shareStatus = async () => {
    if (mutationRef.current) return;
    const message = [
      `Renova · ${snapshot.project.name}`,
      snapshot.project.address || '',
      `Прогресс ${progress}%`,
      snapshot.contractor_company_name ? `Исполнитель: ${snapshot.contractor_company_name}` : '',
      pending.total > 0 ? `Сейчас: ${pending.label}` : 'Срочных действий нет',
      `Документов: ${snapshot.documents_total}`,
      'Статус из портала заказчика.',
    ].filter(Boolean).join('\n');
    try {
      await Share.share({ message, title: snapshot.project.name });
    } catch {
      await Clipboard.setStringAsync(message);
      showActionConfirm({ title: 'Скопировано', message: 'Статус объекта сохранён в буфер обмена.' });
    }
  };

  const acceptStage = (acceptance: PortalAcceptance) => {
    confirmMutation({
      key: portalMutationKey('acceptance:accept', acceptance.id),
      title: 'Принять этап?',
      message: `«${acceptance.stage_name || 'Работы'}». После приёмки могут стать доступны оплата и подпись.`,
      primaryLabel: 'Принять',
      task: () => api.portalAcceptStage(session.project_id, acceptance.id, portalToken),
      errorTitle: 'Не удалось принять этап',
      onSuccess: async (_result, next) => {
        const paymentCount = next?.pending_payments.length ?? 0;
        const documentCount = next?.pending_draft_documents?.length ?? 0;
        const actions: { label: string; onPress: () => void }[] = [];
        if (paymentCount > 0 && capabilities.pay) {
          actions.push({ label: 'К оплате', onPress: () => scrollToSection('payments') });
        }
        if (paymentCount === 0 && documentCount > 0 && capabilities.sign) {
          actions.push({ label: 'К подписи', onPress: () => scrollToSection('documents') });
        }
        showActionConfirm({
          title: 'Этап принят',
          message: `«${acceptance.stage_name || 'Работы'}» принят.`,
          ...(actions.length > 0
            ? { actions }
            : { primaryLabel: 'Готово', onPrimary: () => undefined }),
        });
      },
      onError: (error) => {
        const message = apiErrorMessage(error, 'Не удалось принять этап.');
        const code = error instanceof ApiError ? error.code : undefined;
        if (code === 'photos_required' || /фото/i.test(message)) {
          showActionConfirm({ title: 'Нужны фото', message });
          return;
        }
        if (code === 'checklist_required' || code === 'checklist_incomplete' || /чеклист/i.test(message)) {
          showActionConfirm({
            title: 'Нужен чек-лист',
            message: `${message}\n\nОткройте этап в приложении Renova и заполните чек-лист приёмки.`,
            actions: [{
              label: 'Открыть этап',
              onPress: () => {
                void Linking.openURL(`renova://stage/${acceptance.stage_id}`).catch(() => {
                  showActionConfirm({
                    title: 'Приложение Renova',
                    message: 'Откройте Ремонт → Приёмка → этап → чек-лист.',
                  });
                });
              },
            }],
          });
          return;
        }
        showActionConfirm({ title: 'Ошибка', message });
      },
    });
  };

  const returnStage = (acceptance: PortalAcceptance) => {
    confirmMutation({
      key: portalMutationKey('acceptance:return', acceptance.id),
      title: 'Вернуть этап на доработку?',
      message: `«${acceptance.stage_name || 'Работы'}» вернутся исполнителю с задачей исправить результат.`,
      primaryLabel: 'Вернуть',
      intent: 'destructive',
      task: () => api.portalReturnStage(session.project_id, acceptance.id, portalToken, 'Нужна доработка'),
      errorTitle: 'Не удалось вернуть этап',
      onSuccess: () => {
        showActionConfirm({ title: 'Возвращено', message: 'Исполнитель получил задачу на доработку.' });
      },
    });
  };

  const decideChangeOrder = (order: PortalChangeOrder, decision: 'approve' | 'reject') => {
    const approving = decision === 'approve';
    confirmMutation({
      key: portalMutationKey(`change-order:${decision}`, order.id),
      title: approving ? 'Согласовать доп. работу?' : 'Отклонить доп. работу?',
      message: approving
        ? `«${order.title}» · ${formatRub(order.amount)} будет добавлена в смету.`
        : `«${order.title}» не будет добавлена в смету.`,
      primaryLabel: approving ? 'Согласовать' : 'Отклонить',
      intent: approving ? 'primary' : 'destructive',
      task: () => approving
        ? api.portalApproveChangeOrder(session.project_id, order.id, portalToken)
        : api.portalRejectChangeOrder(session.project_id, order.id, portalToken),
      errorTitle: approving ? 'Не удалось согласовать' : 'Не удалось отклонить',
      onSuccess: () => showActionConfirm({
        title: approving ? 'Согласовано' : 'Отклонено',
        message: `«${order.title}»`,
      }),
    });
  };

  const decideEstimate = (decision: 'lock' | 'reject') => {
    const locking = decision === 'lock';
    confirmMutation({
      key: portalMutationKey(`estimate:${decision}`),
      title: locking ? 'Зафиксировать смету?' : 'Отклонить смету?',
      message: locking
        ? `Итого ${formatRub(snapshot.estimate_summary?.total ?? 0)}. После фиксации базовые строки нельзя свободно менять.`
        : 'Исполнитель получит уведомление о необходимости скорректировать смету.',
      primaryLabel: locking ? 'Зафиксировать' : 'Отклонить',
      intent: locking ? 'primary' : 'destructive',
      task: () => locking
        ? api.portalLockEstimate(session.project_id, portalToken)
        : api.portalRejectEstimate(session.project_id, portalToken, 'Нужна правка сметы'),
      errorTitle: locking ? 'Не удалось зафиксировать смету' : 'Не удалось отклонить смету',
      onSuccess: () => showActionConfirm({
        title: locking ? 'Смета зафиксирована' : 'Смета возвращена',
        message: locking ? 'Базовая смета зафиксирована.' : 'Исполнитель получил уведомление.',
      }),
    });
  };

  const openCardCheckout = (payment: PortalPayment) => {
    if (payment.needs_acceptance) {
      showActionConfirm({
        title: 'Сначала приёмка',
        message: PAYMENT_BLOCKED_ACCEPTANCE_MSG,
        ...(capabilities.acceptStage
          ? {
              primaryLabel: 'К приёмке',
              onPrimary: () => scrollRef.current?.scrollTo({ y: 0, animated: true }),
              secondaryLabel: 'Отмена',
              onSecondary: () => undefined,
            }
          : { primaryLabel: 'Понятно', onPrimary: () => undefined }),
      });
      return;
    }

    const runCheckout = () => runPortalMutation(
      portalMutationKey('payment:checkout', payment.id),
      () => api.checkoutYookassa(session.user_id, session.project_id, payment.id, { portal_token: portalToken }),
      {
        refresh: false,
        errorTitle: 'Оплата картой недоступна',
        errorFallback: 'Используйте перевод по реквизитам.',
        onSuccess: async (checkout) => {
          if (checkout.demo) {
            try {
              await refreshPortalSnapshot(session);
            } catch (error) {
              reportError('components.screens.PortalScreen.DemoPaymentRefresh', error);
            }
            showActionConfirm({
              title: 'Оплата (demo)',
              message: checkout.message || 'Тестовая оплата выполнена без реального списания.',
            });
            return;
          }
          if (checkout.confirmation_url) {
            await WebBrowser.openBrowserAsync(checkout.confirmation_url);
            try {
              await refreshPortalSnapshot(session);
            } catch (error) {
              reportError('components.screens.PortalScreen.PaymentRefresh', error);
            }
            showActionConfirm({
              title: 'ЮKassa',
              message: 'Статус оплаты обновляется после возврата из банка. Обработка может занять несколько минут.',
            });
          }
        },
      },
    );

    if (snapshot.payments_mode === 'demo') {
      showActionConfirm({
        title: 'Demo-оплата',
        message: 'Деньги с карты не спишутся. Для реального пилота нужны live-ключи ЮKassa.',
        primaryLabel: 'Продолжить demo',
        onPrimary: () => { void runCheckout(); },
        secondaryLabel: 'Отмена',
        onSecondary: () => undefined,
      });
      return;
    }
    void runCheckout();
  };

  const openRequisites = (payment: PortalPayment) => {
    if (payment.needs_acceptance) {
      showActionConfirm({ title: 'Сначала приёмка', message: PAYMENT_BLOCKED_ACCEPTANCE_MSG });
      return;
    }
    const built = buildPaymentRequisites({
      recipientName: snapshot.contractor_recipient_name,
      paymentRequisites: snapshot.contractor_payment_requisites,
      amount: payment.amount,
      title: payment.title,
    });
    if (built.missingHint) {
      showActionConfirm({ title: 'Реквизиты не указаны', message: built.missingHint });
      return;
    }
    void runPortalMutation(
      portalMutationKey('payment:requisites', payment.id),
      async () => Clipboard.setStringAsync(built.text),
      {
        refresh: false,
        onSuccess: () => {
          showActionConfirm({
            title: 'Реквизиты скопированы',
            message: `${built.text}\n\nПосле перевода приложите чек или подтвердите перевод.`,
            primaryLabel: 'К подтверждению',
            onPrimary: () => openPaymentSheet(payment),
            secondaryLabel: 'Позже',
            onSecondary: () => undefined,
          });
        },
      },
    );
  };

  const signDocument = (document: PortalDocument, provider: 'in_app' | 'kontur') => {
    const key = portalMutationKey(`document:${provider}`, document.id);
    void runPortalMutation(
      key,
      () => api.portalSignDocument(session.project_id, document.id, portalToken, provider),
      {
        refresh: false,
        errorTitle: provider === 'kontur' ? 'Контур недоступен' : 'Не удалось подписать документ',
        onSuccess: async (result) => {
          if (provider === 'kontur' && result.signing_url) {
            await Linking.openURL(result.signing_url);
            showActionConfirm({
              title: 'Контур',
              message: 'Завершите подписание в браузере. Статус обновится после webhook.',
            });
          } else {
            let next = snapshot;
            try {
              next = await refreshPortalSnapshot(session);
            } catch (error) {
              reportError('components.screens.PortalScreen.SignRefresh', error);
            }
            showActionConfirm({
              title: 'Подписано',
              message: result.status === 'signed' ? document.title : 'Запрос на подпись создан.',
              ...(next.pending_payments.length > 0 && capabilities.pay
                ? {
                    primaryLabel: 'К оплате',
                    onPrimary: () => scrollToSection('payments'),
                    secondaryLabel: 'Готово',
                    onSecondary: () => undefined,
                  }
                : { primaryLabel: 'Готово', onPrimary: () => undefined }),
            });
          }
          if (provider === 'kontur') {
            try {
              await refreshPortalSnapshot(session);
            } catch (error) {
              reportError('components.screens.PortalScreen.KonturRefresh', error);
            }
          }
        },
      },
    );
  };

  return (
    <>
      <ScrollView ref={scrollRef} style={styles.screen} contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <Text style={styles.brand}>RENOVA</Text>
          <Text style={styles.heroTitle}>{snapshot.project.name}</Text>
          {snapshot.project.address ? <Text style={styles.meta}>{snapshot.project.address}</Text> : null}
          {snapshot.contractor_company_name || snapshot.contractor_recipient_name ? (
            <Text style={styles.meta}>
              Исполнитель · {snapshot.contractor_company_name || snapshot.contractor_recipient_name}
            </Text>
          ) : null}
          <Text style={styles.progressLabel}>Прогресс · {progress}%</Text>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progress}%` }]} />
          </View>
          <Text style={styles.priorityLine}>{pending.total > 0 ? `Сейчас: ${pending.label}` : pending.label}</Text>
          <Text style={styles.accessLine}>
            {capabilities.readOnly
              ? 'Только просмотр'
              : [capabilities.accept ? 'Приёмка' : null, capabilities.sign ? 'Подпись' : null, capabilities.pay ? 'Оплата' : null]
                  .filter(Boolean)
                  .join(' · ') || 'Решения по объекту'}
          </Text>
          <PrimaryButton
            title="Поделиться статусом"
            variant="outline"
            fullWidth
            disabled={busy}
            accessibilityLabel="Поделиться статусом объекта"
            onPress={() => { void shareStatus(); }}
          />
        </View>

        {snapshot.pending_work_schedule ? (
          <PortalSection title="План-график" subtitle={`${snapshot.pending_work_schedule.title || 'График работ'} · на согласовании`}>
            {capabilities.confirmSchedule ? (
              <PortalActionRow>
                <PrimaryButton
                  title="Согласовать график"
                  compact
                  loading={mutationKey === portalMutationKey('schedule:confirm', snapshot.pending_work_schedule.id)}
                  disabled={busy}
                  onPress={() => confirmMutation({
                    key: portalMutationKey('schedule:confirm', snapshot.pending_work_schedule!.id),
                    title: 'Согласовать график?',
                    message: 'Сроки этапов станут рабочим планом.',
                    primaryLabel: 'Согласовать',
                    task: () => api.portalConfirmSchedule(
                      session.user_id,
                      session.project_id,
                      snapshot.pending_work_schedule!.id,
                      portalToken,
                    ),
                    errorTitle: 'Не удалось согласовать график',
                    onSuccess: () => showActionConfirm({ title: 'График согласован', message: 'Сроки стали рабочим планом.' }),
                  })}
                />
                <PrimaryButton
                  title="Отклонить"
                  variant="dangerOutline"
                  compact
                  loading={mutationKey === portalMutationKey('schedule:reject', snapshot.pending_work_schedule.id)}
                  disabled={busy}
                  onPress={() => confirmMutation({
                    key: portalMutationKey('schedule:reject', snapshot.pending_work_schedule!.id),
                    title: 'Отклонить график?',
                    message: 'Исполнитель получит задачу скорректировать сроки.',
                    primaryLabel: 'Отклонить',
                    intent: 'destructive',
                    task: () => api.portalRejectSchedule(
                      session.user_id,
                      session.project_id,
                      snapshot.pending_work_schedule!.id,
                      portalToken,
                      'Нужна правка сроков',
                    ),
                    errorTitle: 'Не удалось отклонить график',
                    onSuccess: () => showActionConfirm({ title: 'График возвращён', message: 'Исполнитель получил задачу на правку.' }),
                  })}
                />
              </PortalActionRow>
            ) : <Text style={styles.meta}>Ожидает решения пользователя с правом согласования.</Text>}
          </PortalSection>
        ) : null}

        {(snapshot.pending_acceptances?.length ?? 0) > 0 ? (
          <PortalSection title={`Приёмка этапов (${snapshot.pending_acceptances!.length})`}>
            {snapshot.pending_acceptances!.map((acceptance) => {
              const acceptKey = portalMutationKey('acceptance:accept', acceptance.id);
              const returnKey = portalMutationKey('acceptance:return', acceptance.id);
              return (
                <View key={acceptance.id} style={styles.row}>
                  <Text style={styles.rowTitle}>{acceptance.stage_name || 'Этап'}</Text>
                  <Text style={styles.meta}>Ждёт решения{acceptance.hours_waiting != null ? ` · ${acceptance.hours_waiting} ч` : ''}</Text>
                  {capabilities.acceptStage ? (
                    <PortalActionRow>
                      <PrimaryButton
                        title="Принять этап"
                        compact
                        loading={mutationKey === acceptKey}
                        disabled={busy}
                        onPress={() => acceptStage(acceptance)}
                      />
                      <PrimaryButton
                        title="На доработку"
                        variant="dangerOutline"
                        compact
                        loading={mutationKey === returnKey}
                        disabled={busy}
                        onPress={() => returnStage(acceptance)}
                      />
                    </PortalActionRow>
                  ) : <Text style={styles.meta}>Нет права принимать этап по этой ссылке.</Text>}
                </View>
              );
            })}
          </PortalSection>
        ) : null}

        {(snapshot.pending_change_orders?.length ?? 0) > 0 ? (
          <PortalSection title={`Доп. работы (${snapshot.pending_change_orders!.length})`} subtitle="Решение изменяет согласованный объём и смету.">
            {snapshot.pending_change_orders!.map((order) => (
              <View key={order.id} style={styles.row}>
                <Text style={styles.rowTitle}>{order.title} · {formatRub(order.amount)}</Text>
                {order.description ? <Text style={styles.meta}>{order.description}</Text> : null}
                {capabilities.decideChangeOrders ? (
                  <PortalActionRow>
                    <PrimaryButton
                      title="Согласовать"
                      compact
                      loading={mutationKey === portalMutationKey('change-order:approve', order.id)}
                      disabled={busy}
                      onPress={() => decideChangeOrder(order, 'approve')}
                    />
                    <PrimaryButton
                      title="Отклонить"
                      variant="dangerOutline"
                      compact
                      loading={mutationKey === portalMutationKey('change-order:reject', order.id)}
                      disabled={busy}
                      onPress={() => decideChangeOrder(order, 'reject')}
                    />
                  </PortalActionRow>
                ) : null}
              </View>
            ))}
          </PortalSection>
        ) : null}

        {snapshot.estimate_summary ? (
          <PortalSection
            title="Смета"
            subtitle={`${snapshot.estimate_summary.lines_count} поз. · ${formatRub(snapshot.estimate_summary.total)}`}
          >
            <Text style={styles.meta}>
              {snapshot.estimate_summary.locked_at
                ? `Зафиксирована ${snapshot.estimate_summary.locked_at.slice(0, 10)}`
                : snapshot.estimate_summary.proposed_at
                  ? 'На согласовании'
                  : 'Черновик — ожидает отправки исполнителем'}
            </Text>
            {snapshot.estimate_summary.lines.slice(0, 5).map((line, index) => (
              <Text key={`${line.name}:${index}`} style={styles.line}>{line.name} · {formatRub(line.total)}</Text>
            ))}
            {canDecideEstimate ? (
              <PortalActionRow>
                <PrimaryButton
                  title="Зафиксировать смету"
                  compact
                  loading={mutationKey === portalMutationKey('estimate:lock')}
                  disabled={busy}
                  onPress={() => decideEstimate('lock')}
                />
                <PrimaryButton
                  title="Отклонить"
                  variant="dangerOutline"
                  compact
                  loading={mutationKey === portalMutationKey('estimate:reject')}
                  disabled={busy}
                  onPress={() => decideEstimate('reject')}
                />
              </PortalActionRow>
            ) : null}
          </PortalSection>
        ) : null}

        <PortalSection title="Расписание">
          <Text style={styles.line}>Этап: {schedule.current_stage || '—'}</Text>
          <Text style={styles.line}>Прогресс: {progress}%</Text>
          {schedule.planned_end ? <Text style={styles.line}>План окончания: {schedule.planned_end}</Text> : null}
        </PortalSection>

        <PortalSection
          title={`Ожидают оплаты (${snapshot.pending_payments.length})`}
          focused={focusSection === 'payments'}
          onLayout={(event) => {
            const y = portalLayoutY(event);
            if (y !== null) paymentsY.current = y;
          }}
          subtitle={snapshot.payments_mode === 'live'
            ? 'Оплата картой через ЮKassa или перевод по реквизитам.'
            : snapshot.payments_mode === 'requisites'
              ? 'Оплата переводом по реквизитам.'
              : snapshot.payments_mode === 'demo'
                ? 'Demo-режим: карта не списывает реальные деньги.'
                : 'Карточная оплата отключена на сервере.'}
        >
          {capabilities.readOnly ? (
            <Text style={styles.meta}>Оплата недоступна в режиме просмотра.</Text>
          ) : snapshot.pending_payments.length === 0 ? (
            <Text style={styles.meta}>Нет счетов, ожидающих оплаты.</Text>
          ) : snapshot.pending_payments.map((payment) => (
            <View key={payment.id} style={styles.row}>
              <Text style={styles.rowTitle}>{payment.title} · {formatRub(payment.amount)}</Text>
              {payment.needs_acceptance ? <Text style={styles.warning}>{PAYMENT_BLOCKED_ACCEPTANCE_MSG}</Text> : null}
              {capabilities.pay ? (
                <PortalActionRow>
                  <PrimaryButton
                    title="Реквизиты / СБП"
                    variant={snapshot.payments_mode === 'demo' ? 'primary' : 'outline'}
                    compact
                    loading={mutationKey === portalMutationKey('payment:requisites', payment.id)}
                    disabled={busy}
                    onPress={() => openRequisites(payment)}
                  />
                  {(snapshot.payments_mode === 'live' || snapshot.payments_mode === 'demo') ? (
                    <PrimaryButton
                      title={snapshot.payments_mode === 'live' ? 'Оплатить картой' : 'Карта (demo)'}
                      variant={snapshot.payments_mode === 'live' ? 'primary' : 'outline'}
                      compact
                      loading={mutationKey === portalMutationKey('payment:checkout', payment.id)}
                      disabled={busy || Boolean(payment.needs_acceptance)}
                      onPress={() => openCardCheckout(payment)}
                    />
                  ) : null}
                </PortalActionRow>
              ) : <Text style={styles.meta}>По этой ссылке оплата недоступна.</Text>}
            </View>
          ))}
        </PortalSection>

        <PortalSection title={`Подбор материалов (${snapshot.selections_total})`}>
          {snapshot.selections.length === 0 ? (
            <Text style={styles.meta}>Нет позиций.</Text>
          ) : snapshot.selections.slice(0, 6).map((selection) => (
            <Text key={selection.id} style={styles.line}>{selection.title} · {selection.status}</Text>
          ))}
        </PortalSection>

        <PortalSection
          title={`Документы (${snapshot.documents_total})`}
          focused={focusSection === 'documents'}
          onLayout={(event) => {
            const y = portalLayoutY(event);
            if (y !== null) documentsY.current = y;
          }}
        >
          {pendingDocuments.length > 0 ? (
            <View style={styles.documentBlock}>
              <Text style={styles.subsectionTitle}>Ожидают подписи</Text>
              {pendingDocuments.map((document) => (
                <View key={document.id} style={styles.row}>
                  <Text style={styles.rowTitle}>{document.title}</Text>
                  {capabilities.signDocuments ? (
                    <PortalActionRow>
                      <PrimaryButton
                        title={snapshot.kontur_available ? 'Подписать в приложении' : 'Подписать (in_app)'}
                        compact
                        loading={mutationKey === portalMutationKey('document:in_app', document.id)}
                        disabled={busy}
                        onPress={() => signDocument(document, 'in_app')}
                      />
                      {snapshot.kontur_available ? (
                        <PrimaryButton
                          title="Контур"
                          variant="outline"
                          compact
                          loading={mutationKey === portalMutationKey('document:kontur', document.id)}
                          disabled={busy}
                          onPress={() => signDocument(document, 'kontur')}
                        />
                      ) : null}
                    </PortalActionRow>
                  ) : <Text style={styles.meta}>По этой ссылке подпись недоступна.</Text>}
                </View>
              ))}
              <Text style={styles.meta}>
                {snapshot.kontur_available
                  ? 'Доступна подпись через Контур или подтверждение в приложении.'
                  : 'Подпись in_app не является квалифицированной электронной подписью.'}
              </Text>
            </View>
          ) : <Text style={styles.meta}>Документов на подпись нет.</Text>}
          {snapshot.documents.slice(0, 8).map((document) => (
            <Text key={document.id} style={styles.line}>{document.title}{document.status === 'draft' ? ' · черновик' : ''}</Text>
          ))}
        </PortalSection>
      </ScrollView>

      <PaymentDetailSheet
        payment={sheetPayment}
        stages={sheetStages}
        role="customer"
        readOnly={capabilities.readOnly || !capabilities.pay}
        userId={session.user_id}
        projectId={session.project_id}
        onClose={() => { setSheetPayment(null); setSheetStages([]); }}
        onChanged={() => { void refreshPortalSnapshot(session).catch((error) => reportError('components.screens.PortalScreen.PaymentSheetRefresh', error)); }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: RenovaTheme.colors.background },
  content: { padding: RenovaTheme.spacing.lg, paddingBottom: 40, gap: RenovaTheme.spacing.md },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: RenovaTheme.spacing.xl,
    gap: RenovaTheme.spacing.sm,
    backgroundColor: RenovaTheme.colors.background,
  },
  stateTitle: { ...screenTypography.hero, textAlign: 'center' },
  hero: {
    paddingBottom: RenovaTheme.spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: RenovaTheme.colors.border,
    gap: RenovaTheme.spacing.sm,
  },
  brand: {
    ...screenTypography.section,
    marginTop: 0,
    marginBottom: 0,
    color: RenovaTheme.colors.primary,
    letterSpacing: 1,
  },
  heroTitle: { ...screenTypography.hero },
  progressLabel: { ...screenTypography.listTitle, marginTop: 4 },
  progressTrack: {
    height: 6,
    borderRadius: RenovaTheme.radius.pill,
    backgroundColor: RenovaTheme.colors.border,
    overflow: 'hidden',
  },
  progressFill: { height: 6, backgroundColor: RenovaTheme.colors.primary },
  priorityLine: { ...screenTypography.listTitle },
  accessLine: { ...screenTypography.listMeta, color: RenovaTheme.colors.warningText },
  section: {
    paddingVertical: RenovaTheme.spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: RenovaTheme.colors.border,
    gap: RenovaTheme.spacing.sm,
  },
  sectionFocused: {
    backgroundColor: RenovaTheme.colors.infoBg,
    marginHorizontal: -RenovaTheme.spacing.sm,
    paddingHorizontal: RenovaTheme.spacing.sm,
    borderRadius: RenovaTheme.radius.md,
  },
  sectionTitle: { ...screenTypography.section, marginTop: 0, marginBottom: 0, color: RenovaTheme.colors.text },
  sectionBody: { gap: RenovaTheme.spacing.sm },
  subsectionTitle: { ...screenTypography.listTitle, color: RenovaTheme.colors.warningText },
  row: { ...listRowStyles.row, gap: RenovaTheme.spacing.xs },
  rowTitle: { ...screenTypography.listTitle },
  line: { ...screenTypography.listMeta, color: RenovaTheme.colors.text },
  meta: { ...screenTypography.listMeta },
  warning: { ...screenTypography.listMeta, color: RenovaTheme.colors.warningText },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: RenovaTheme.spacing.sm, marginTop: 4 },
  documentBlock: { gap: RenovaTheme.spacing.sm },
});
