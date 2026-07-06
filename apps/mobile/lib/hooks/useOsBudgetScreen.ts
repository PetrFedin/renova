/** Данные экрана «Бюджет» — загрузка и перезагрузка (отделено от UI вкладок) */
import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { api, MaterialPick, OsBudgetSummary, OsExpense, Payment, ReceiptItem } from '@/lib/api';
import { useRenova } from '@/lib/context/RenovaContext';
import type { BudgetAlert } from '@/components/renova/BudgetAlerts';

export type PaymentFilter = 'all' | 'pending' | 'confirmed';

export function useOsBudgetScreen() {
  const { user, activeProject, loadProject } = useRenova();
  const [summary, setSummary] = useState<OsBudgetSummary | null>(null);
  const [expenses, setExpenses] = useState<OsExpense[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [receipts, setReceipts] = useState<ReceiptItem[]>([]);
  const [picks, setPicks] = useState<MaterialPick[]>([]);
  const [budgetAlerts, setBudgetAlerts] = useState<BudgetAlert[]>([]);
  const [payFilter, setPayFilter] = useState<PaymentFilter>('all');

  const reload = useCallback(async () => {
    if (!user || !activeProject) return;
    api.osBudget(user.id, activeProject.id).then(setSummary).catch(() => setSummary(null));
    api.osExpenses(user.id, activeProject.id).then(setExpenses).catch(() => setExpenses([]));
    api.listPayments(user.id, activeProject.id).then(setPayments).catch(() => setPayments([]));
    api.listReceipts(user.id, activeProject.id).then(setReceipts).catch(() => setReceipts([]));
    api.listMaterialPicks(user.id, activeProject.id).then(setPicks).catch(() => setPicks([]));
    api.budgetAlerts(user.id, activeProject.id).then(setBudgetAlerts).catch(() => setBudgetAlerts([]));
    // Фоновая синхронизация сметы/этапов — без блокировки UI (см. useProjectScope)
    loadProject(activeProject.id).catch(() => {});
  }, [user?.id, activeProject?.id, loadProject]);

  useFocusEffect(useCallback(() => { reload().catch(() => {}); }, [reload]));

  const pending = payments.filter((p) => p.status === 'pending');
  const sortedPayments = [...payments].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  const filteredPayments = payFilter === 'pending'
    ? sortedPayments.filter((p) => p.status === 'pending')
    : payFilter === 'confirmed'
      ? sortedPayments.filter((p) => p.status === 'confirmed')
      : sortedPayments;

  return {
    user,
    activeProject,
    summary,
    expenses,
    payments,
    receipts,
    picks,
    budgetAlerts,
    payFilter,
    setPayFilter,
    pending,
    filteredPayments,
    reload,
  };
}
