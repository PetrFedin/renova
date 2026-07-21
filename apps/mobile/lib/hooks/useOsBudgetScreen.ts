/** Данные экрана «Бюджет» — загрузка и перезагрузка (P2.5 BFF + fallback) */
import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { api, MaterialPick, OsBudgetSummary, OsExpense, Payment, Purchase, ReceiptItem } from '@/lib/api';
import { useRenova } from '@/lib/context/RenovaContext';
import type { BudgetAlert } from '@/components/renova/BudgetAlerts';
import { reportError } from '@/lib/reportError';

export type PaymentFilter = 'all' | 'pending' | 'confirmed' | 'paid_unverified';
export type BudgetLoadState = 'loading' | 'loaded' | 'error';

export function useOsBudgetScreen() {
  const { user, activeProject, loadProject } = useRenova();
  const [summary, setSummary] = useState<OsBudgetSummary | null>(null);
  const [expenses, setExpenses] = useState<OsExpense[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [receipts, setReceipts] = useState<ReceiptItem[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [picks, setPicks] = useState<MaterialPick[]>([]);
  const [budgetAlerts, setBudgetAlerts] = useState<BudgetAlert[]>([]);
  const [payFilter, setPayFilter] = useState<PaymentFilter>('all');
  const [loadState, setLoadState] = useState<BudgetLoadState>('loading');

  const reloadLegacy = useCallback(async () => {
    if (!user || !activeProject) return;
    const [sm, ex, pay, rc, pur, pk, al] = await Promise.all([
      api.osBudget(user.id, activeProject.id),
      api.osExpenses(user.id, activeProject.id),
      api.listPayments(user.id, activeProject.id),
      api.listReceipts(user.id, activeProject.id),
      api.listPurchases(user.id, activeProject.id),
      api.listMaterialPicks(user.id, activeProject.id),
      api.budgetAlerts(user.id, activeProject.id),
    ]);
    setSummary(sm);
    setExpenses(ex);
    setPayments(pay);
    setReceipts(rc);
    setPurchases(pur);
    setPicks(pk);
    setBudgetAlerts(al);
  }, [user?.id, activeProject?.id]);

  const reload = useCallback(async () => {
    if (!user || !activeProject) return;
    setLoadState('loading');
    try {
      const [hub, purchaseRows] = await Promise.all([
        api.budgetSummaryHub(user.id, activeProject.id),
        api.listPurchases(user.id, activeProject.id),
      ]);
      setSummary(hub.summary);
      setExpenses(hub.expenses);
      setPayments(hub.payments);
      setReceipts(hub.receipts);
      setPurchases(purchaseRows);
      setPicks(hub.material_picks);
      setBudgetAlerts(hub.budget_alerts);
      setLoadState('loaded');
    } catch (e) {
      try {
        await reloadLegacy();
        setLoadState('loaded');
      } catch (e2) {
        reportError('budget.reload', e2);
        setLoadState('error');
      }
    }
    loadProject(activeProject.id).catch((err) => reportError('budget.loadProject', err));
  }, [user?.id, activeProject?.id, loadProject, reloadLegacy]);

  useFocusEffect(useCallback(() => { reload().catch((e) => reportError('budget.focus', e)); }, [reload]));

  const pending = payments.filter((p) => p.status === 'pending' || p.status === 'paid_unverified');
  const sortedPayments = [...payments].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  const filteredPayments = payFilter === 'pending'
    ? sortedPayments.filter((p) => p.status === 'pending')
    : payFilter === 'paid_unverified'
      ? sortedPayments.filter((p) => p.status === 'paid_unverified')
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
    purchases,
    picks,
    budgetAlerts,
    payFilter,
    setPayFilter,
    pending,
    filteredPayments,
    reload,
    loadState,
  };
}
