/** API: os */
import { req, cachedGet, API_BASE } from './client';
import type { ActivityItem, OsBudgetSummary, OsExpense, OsInsight, OsReport, OsRisk, User } from './types';
import type { MaterialPick, Payment, ReceiptItem } from './types';

export type BudgetHubResponse = {
  summary: OsBudgetSummary;
  expenses: OsExpense[];
  payments: Payment[];
  receipts: ReceiptItem[];
  material_picks: MaterialPick[];
  budget_alerts: { room_id: string; room_name: string; plan: number; fact: number; over_pct?: number }[];
  pending_payments_count: number;
  threshold_pct: number;
};

export const osApi = {
  osBudget: (userId: string, projectId: string) => req<OsBudgetSummary>(`/api/v1/projects/${projectId}/os/budget`, {}, userId),
  budgetSummaryHub: async (userId: string, projectId: string) => {
    const { getBudgetThreshold } = await import('@/lib/budgetThreshold');
    const t = await getBudgetThreshold();
    return req<BudgetHubResponse>(`/api/v1/projects/${projectId}/budget-summary?threshold_pct=${t}`, {}, userId);
  },
  osExpenses: (userId: string, projectId: string, status?: string) => req<OsExpense[]>(`/api/v1/projects/${projectId}/os/expenses${status ? `?status=${status}` : ''}`, {}, userId),
  deleteOsExpense: (userId: string, projectId: string, expenseId: string) =>
    req<void>(`/api/v1/projects/${projectId}/os/expenses/${expenseId}`, { method: 'DELETE' }, userId),
  patchOsExpense: (userId: string, projectId: string, expenseId: string, body: { amount?: number; title?: string; category?: string; room_id?: string | null; stage_id?: string | null }) =>
    req<import('./types').OsExpense>(`/api/v1/projects/${projectId}/os/expenses/${expenseId}`, { method: 'PATCH', body: JSON.stringify(body) }, userId),
  reportDaily: (userId: string, projectId: string) => req<OsReport>(`/api/v1/projects/${projectId}/reports/daily`, {}, userId),
  reportWeekly: (userId: string, projectId: string) => req<OsReport>(`/api/v1/projects/${projectId}/reports/weekly`, {}, userId),
  reportFinal: (userId: string, projectId: string) => req<OsReport>(`/api/v1/projects/${projectId}/reports/final`, {}, userId),
  exportReportPdf: async (userId: string, projectId: string, kind: 'daily' | 'weekly' | 'final') => {
    const { downloadReportPdf } = await import('@/lib/reports/reportPdf');
    await downloadReportPdf(userId, projectId, kind);
  },
  osRisks: (userId: string, projectId: string) => req<{ count: number; items: OsRisk[] }>(`/api/v1/projects/${projectId}/os/risks`, {}, userId),
  osInsights: (userId: string, projectId: string) => req<{ count: number; items: OsInsight[] }>(`/api/v1/projects/${projectId}/os/insights`, {}, userId),
  activityFeed: (userId: string, projectId: string, kind?: string, workType?: string) => {
    const q = new URLSearchParams();
    if (kind) q.set('kind', kind);
    if (workType) q.set('work_type', workType);
    const qs = q.toString();
    return req<ActivityItem[]>(`/api/v1/projects/${projectId}/activity${qs ? `?${qs}` : ''}`, {}, userId);
  },
  exportActivityDossier: async (userId: string, projectId: string) => {
    const base = process.env.EXPO_PUBLIC_API_URL ?? 'http://127.0.0.1:8100';
    const r = await fetch(`${base}/api/v1/projects/${projectId}/activity-dossier.pdf`, { headers: { 'X-User-Id': userId } });
    if (!r.ok) throw new Error('dossier');
    const blob = await r.blob();
    if (typeof window !== 'undefined') { const u = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = u; a.download = 'dossier.pdf'; a.click(); URL.revokeObjectURL(u); }
  },
  exportFullDossier: async (userId: string, projectId: string) => { const base = process.env.EXPO_PUBLIC_API_URL ?? 'http://127.0.0.1:8100'; const r = await fetch(`${base}/api/v1/projects/${projectId}/full-dossier.pdf`, { headers: { 'X-User-Id': userId } }); if (!r.ok) throw new Error('pdf'); const blob = await r.blob(); if (typeof window !== 'undefined') { const u = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = u; a.download = 'full-dossier.pdf'; a.click(); URL.revokeObjectURL(u); } },
  exportProjectPdf: async (userId: string, projectId: string) => {
    const base = process.env.EXPO_PUBLIC_API_URL ?? 'http://127.0.0.1:8100';
    const r = await fetch(`${base}/api/v1/projects/${projectId}/export.pdf`, { headers: { 'X-User-Id': userId } });
    if (!r.ok) throw new Error('export failed');
    const blob = await r.blob();
    if (typeof window !== 'undefined') { const u = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = u; a.download = `project-${projectId.slice(0,8)}.pdf`; a.click(); URL.revokeObjectURL(u); }
  },
  exportKpiWeeklyPdf: async (userId: string, projectId: string) => { const base = process.env.EXPO_PUBLIC_API_URL ?? 'http://127.0.0.1:8100'; const r = await fetch(`${base}/api/v1/projects/${projectId}/kpi-weekly.pdf`, { headers: { 'X-User-Id': userId } }); if (!r.ok) throw new Error('kpi pdf'); const blob = await r.blob(); if (typeof window !== 'undefined') { const u = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = u; a.download = 'kpi-week.pdf'; a.click(); URL.revokeObjectURL(u); } },
  kpiHistory: (userId: string, projectId: string) => req<{ margin: number; at: string }[]>(`/api/v1/projects/${projectId}/kpi-history`, {}, userId),
  kpiSnapshot: (userId: string, projectId: string) => req(`/api/v1/projects/${projectId}/kpi-snapshot`, { method: 'POST' }, userId),
};
