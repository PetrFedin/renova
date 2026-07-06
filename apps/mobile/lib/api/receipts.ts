/** API: receipts */
import { req, cachedGet, API_BASE } from './client';
import type { BudgetBreakdown, ReceiptItem, User } from './types';
export const receiptsApi = {
  addManualReceipt: async (userId: string, projectId: string, amount: number, description: string, expense_category = 'materials', room_id?: string | null, stage_id?: string | null) => {
    const body = { amount, description, expense_category, room_id, stage_id };
    try {
      return await req(`/api/v1/projects/${projectId}/receipts/manual`, { method: 'POST', body: JSON.stringify(body) }, userId);
    } catch {
      const { enqueue } = await import('@/lib/offlineQueue');
      await enqueue({ path: `/api/v1/projects/${projectId}/receipts/manual`, method: 'POST', body: JSON.stringify(body), userId });
      throw new Error('offline_queued');
    }
  },
  scanReceipt: async (userId: string, projectId: string, qr_raw: string, expense_category = 'materials', room_id?: string | null, stage_id?: string | null) => {
    const body = { qr_raw, expense_category, room_id, stage_id };
    try {
      return await req(`/api/v1/projects/${projectId}/receipts/scan`, { method: 'POST', body: JSON.stringify(body) }, userId);
    } catch {
      const { enqueue } = await import('@/lib/offlineQueue');
      await enqueue({ path: `/api/v1/projects/${projectId}/receipts/scan`, method: 'POST', body: JSON.stringify(body), userId });
      throw new Error('offline_queued');
    }
  },
  patchReceipt: (userId: string, projectId: string, receiptId: string, body: { expense_category?: string; room_id?: string | null; stage_id?: string | null; amount?: number; description?: string | null }) =>
    req(`/api/v1/projects/${projectId}/receipts/${receiptId}`, { method: 'PATCH', body: JSON.stringify(body) }, userId),
  deleteReceipt: (userId: string, projectId: string, receiptId: string) =>
    req<void>(`/api/v1/projects/${projectId}/receipts/${receiptId}`, { method: 'DELETE' }, userId),
  listReceipts: (userId: string, projectId: string) => req<ReceiptItem[]>(`/api/v1/projects/${projectId}/receipts`, {}, userId),
  exportExpensesCsv: async (userId: string, projectId: string) => {
    const { exportExpensesCsvFile } = await import('@/lib/exportExpensesCsv');
    await exportExpensesCsvFile(userId, projectId);
  },
  expensesSummary: (userId: string, projectId: string) => req<{ by_room: { room_id: string; room_name: string; plan: number; receipts_spent: number; expense_spent?: number; total_spent: number }[]; by_stage: { stage_id: string; stage_name: string; plan: number; receipts_spent: number; expense_spent?: number }[]; receipts_total: number; expenses_total?: number }>(`/api/v1/projects/${projectId}/analytics/expenses-summary`, {}, userId),
  budgetAlerts: async (userId: string, projectId: string) => { const { getBudgetThreshold } = await import('@/lib/budgetThreshold'); const t = await getBudgetThreshold(); return req<{ room_id: string; room_name: string; plan: number; fact: number; over_pct?: number }[]>(`/api/v1/projects/${projectId}/analytics/budget-alerts?threshold_pct=${t}`, {}, userId); },
  budgetRoomLines: (userId: string, projectId: string, roomId: string) => req<{ id: string; name: string; plan: number; fact: number; over: number }[]>(`/api/v1/projects/${projectId}/analytics/budget-room-lines/${roomId}`, {}, userId),
  budgetCategoryAlerts: (userId: string, projectId: string) => req<{ category: string; plan: number; fact: number; over_pct: number }[]>(`/api/v1/projects/${projectId}/analytics/budget-category-alerts`, {}, userId),
  budgetForecast: (userId: string, projectId: string) => req<{ forecast_total: number; forecast_over: number; risk: string }>(`/api/v1/projects/${projectId}/analytics/budget-forecast`, {}, userId),
  budgetScenario: (userId: string, projectId: string, pct?: number) => req<{ materials_plan: number; delta: number; new_total: number }>(`/api/v1/projects/${projectId}/analytics/budget-scenario?materials_pct=${pct||10}`, {}, userId),
  budgetBreakdown: (userId: string, projectId: string) => req<BudgetBreakdown>(`/api/v1/projects/${projectId}/analytics/budget-breakdown`, {}, userId),
};
