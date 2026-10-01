import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useRenova } from '@/lib/context/RenovaContext';
import { syncProjectSideEffects } from '@/lib/projectDataBus';
import { api } from '@/lib/api';
import { RenovaTheme } from '@/constants/Theme';
import { budgetTabRoute } from '@/constants/osSections';
import { replaceOsNav } from '@/lib/pushOsNav';
import { reportCatch } from '@/lib/reportError';
import { showActionConfirm } from '@/lib/actionConfirmBus';

/** Deep link renova://payment-return?projectId=&paymentId= после ЮKassa redirect. */
export default function PaymentReturnScreen() {
  const { projectId, paymentId } = useLocalSearchParams<{ projectId?: string; paymentId?: string }>();
  const { user, loading, loadProject, refreshProjects } = useRenova();
  const [note, setNote] = useState('Проверяем статус оплаты…');

  /** W120: возврат всегда во вкладку «Оплаты» через SoT (не голый /budget) */
  const goBudgetPayments = () => {
    replaceOsNav(budgetTabRoute('customer', 'payments'), undefined, 'customer');
  };

  useEffect(() => {
    // SCR-014: при холодном старте по ссылке сессия ещё восстанавливается — не ругаемся раньше времени.
    if (loading) return;
    if (!user?.id || !projectId || !paymentId) {
      showActionConfirm({ title: 'Оплата', message: 'Неверная ссылка возврата', primaryLabel: 'К оплатам', onPrimary: goBudgetPayments });
      return;
    }
    let cancelled = false;
    // Статус меняется по вебхуку ЮKassa с задержкой: опрашиваем несколько раз, а не показываем «ожидайте» сразу.
    const POLL_ATTEMPTS = 5;
    const POLL_DELAY_MS = 2000;
    (async () => {
      try {
        let pay: Awaited<ReturnType<typeof api.listPayments>>[number] | undefined;
        for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
          const items = await api.listPayments(user.id, projectId);
          pay = items.find((p) => p.id === paymentId);
          if (pay?.status === 'confirmed' || pay?.status === 'cancelled' || pay?.status === 'disputed') break;
          if (cancelled) return;
          if (attempt < POLL_ATTEMPTS - 1) await new Promise((resolve) => setTimeout(resolve, POLL_DELAY_MS));
        }
        await refreshProjects();
        await loadProject(projectId).catch(reportCatch('app.paymentreturn.1'));
        // W94: бюджет/inbox после YuKassa return (loadProject → void)
        await syncProjectSideEffects({ user, project: { id: projectId } as any });
        if (cancelled) return;
        if (pay?.status === 'confirmed') {
          setNote('Оплата подтверждена');
          showActionConfirm({
            title: 'Готово',
            message: 'Оплата через ЮKassa зафиксирована.',
            primaryLabel: 'К оплатам',
            onPrimary: goBudgetPayments,
          });
        } else {
          setNote('Ожидаем подтверждение от ЮKassa…');
          showActionConfirm({
            title: 'Оплата',
            message: 'Подтверждение ещё не пришло. Если оплата прошла, статус обновится в течение нескольких минут — проверьте раздел «Оплаты».',
            primaryLabel: 'К оплатам',
            onPrimary: goBudgetPayments,
          });
        }
      } catch (e) {
        if (cancelled) return;
        reportCatch('app.paymentreturn.check')(e);
        setNote('Не удалось проверить статус оплаты');
        showActionConfirm({
          title: 'Статус оплаты не проверен',
          message: 'Не удалось связаться с сервером. Оплата могла пройти — проверьте раздел «Оплаты».',
          primaryLabel: 'К оплатам',
          onPrimary: goBudgetPayments,
        });
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id, projectId, paymentId, loadProject, refreshProjects]);

  return (
    <View style={s.wrap}>
      <ActivityIndicator size="large" color={RenovaTheme.colors.primary} />
      <Text style={s.text}>{note}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16, backgroundColor: RenovaTheme.colors.background, padding: 24 },
  text: { fontSize: 15, color: RenovaTheme.colors.textMuted, textAlign: 'center' },
});
