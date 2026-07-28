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
  const { user, loadProject, refreshProjects } = useRenova();
  const [note, setNote] = useState('Проверяем статус оплаты…');

  /** W120: возврат всегда во вкладку «Оплаты» через SoT (не голый /budget) */
  const goBudgetPayments = () => {
    replaceOsNav(budgetTabRoute('customer', 'payments'), undefined, 'customer');
  };

  useEffect(() => {
    if (!user?.id || !projectId || !paymentId) {
      showActionConfirm({ title: 'Оплата', message: 'Неверная ссылка возврата', primaryLabel: 'К оплатам', onPrimary: goBudgetPayments });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const items = await api.listPayments(user.id, projectId);
        const pay = items.find((p) => p.id === paymentId);
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
            message: 'Если оплата прошла, статус обновится через несколько секунд. Проверьте раздел «Оплаты».',
            primaryLabel: 'К оплатам',
            onPrimary: goBudgetPayments,
          });
        }
      } catch {
        if (!cancelled) goBudgetPayments();
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
