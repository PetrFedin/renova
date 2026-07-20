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
    const { downloadApiPath } = await import('@/lib/downloadFile');
    await downloadApiPath(userId, `/api/v1/projects/${projectId}/activity-dossier.pdf`, 'dossier.pdf');
  },
  exportFullDossier: async (userId: string, projectId: string) => {
    const { downloadApiPath } = await import('@/lib/downloadFile');
    await downloadApiPath(userId, `/api/v1/projects/${projectId}/full-dossier.pdf`, 'full-dossier.pdf');
  },
  exportProjectPdf: async (userId: string, projectId: string) => {
    const { downloadApiPath } = await import('@/lib/downloadFile');
    await downloadApiPath(userId, `/api/v1/projects/${projectId}/export.pdf`, `project-${projectId.slice(0, 8)}.pdf`);
  },
  exportKpiWeeklyPdf: async (userId: string, projectId: string) => {
    const { downloadApiPath } = await import('@/lib/downloadFile');
    await downloadApiPath(userId, `/api/v1/projects/${projectId}/kpi-weekly.pdf`, 'kpi-week.pdf');
  },
  kpiHistory: (userId: string, projectId: string) => req<{ margin: number; at: string }[]>(`/api/v1/projects/${projectId}/kpi-history`, {}, userId),
  kpiSnapshot: (userId: string, projectId: string) => req(`/api/v1/projects/${projectId}/kpi-snapshot`, { method: 'POST' }, userId),

  export1cPaymentsCsv: async (userId: string, projectId: string) => {
    const { exportProjectCsvFile } = await import('@/lib/exportProjectCsv');
    await exportProjectCsvFile(userId, `/api/v1/projects/${projectId}/export/1c-payments.csv`, `renova-1c-${projectId.slice(0, 8)}.csv`);
  },
  export1cPaymentsXml: async (userId: string, projectId: string) => {
    const { exportProjectCsvFile } = await import('@/lib/exportProjectCsv');
    await exportProjectCsvFile(userId, `/api/v1/projects/${projectId}/export/1c-payments.xml`, `renova-1c-${projectId.slice(0, 8)}.xml`);
  },
  export1cCommercemlXml: async (userId: string, projectId: string) => {
    const { exportProjectCsvFile } = await import('@/lib/exportProjectCsv');
    await exportProjectCsvFile(userId, `/api/v1/projects/${projectId}/export/1c-commerceml.xml`, `renova-cml-${projectId.slice(0, 8)}.xml`);
  },
  exportBankRegisterCsv: async (userId: string, projectId: string) => {
    const { exportProjectCsvFile } = await import('@/lib/exportProjectCsv');
    await exportProjectCsvFile(userId, `/api/v1/projects/${projectId}/export/bank-register.csv`, `renova-bank-${projectId.slice(0, 8)}.csv`);
  },
  previewWeeklyDigest: (userId: string, projectId: string) =>
    req<{
      ok: boolean;
      title: string;
      body: string;
      source: string;
      mode: string;
      kpi_path?: string;
      weekly?: {
        warranty_open?: number | null;
        warranty_overdue?: number | null;
        pending_acceptances?: number | null;
        open_issues_count?: number | null;
      };
    }>(`/api/v1/projects/${projectId}/digest/weekly/preview`, {}, userId),
  pushWeeklyDigest: (userId: string, projectId: string) =>
    req<{
      ok: boolean;
      notified: number;
      source?: string;
      mode?: string;
      body?: string;
      document_id?: string;
      kpi_path?: string;
      ai_narrative?: boolean;
    }>(`/api/v1/projects/${projectId}/digest/weekly`, { method: 'POST' }, userId),
  importBankStatement: (userId: string, projectId: string, csv_text: string, opts?: { create_expenses?: boolean }) =>
    req<{
      ok: boolean;
      parsed_rows: number;
      matched: number;
      unmatched_rows: number;
      expenses_created?: number;
      matches: {
        payment_id: string;
        payment_title: string;
        payment_status: string;
        payment_amount: number;
        score: number;
      }[];
    }>(
      `/api/v1/projects/${projectId}/import/bank-statement`,
      { method: 'POST', body: JSON.stringify({ csv_text, create_expenses: Boolean(opts?.create_expenses) }) },
      userId,
    ),
  confirmBankStatementMatches: (userId: string, projectId: string, payment_ids: string[]) =>
    req<{
      ok: boolean;
      confirmed: string[];
      blocked: string[];
      confirmed_count: number;
      blocked_count: number;
    }>(
      `/api/v1/projects/${projectId}/import/bank-statement/confirm`,
      { method: 'POST', body: JSON.stringify({ payment_ids }) },
      userId,
    ),
  createWarrantyClaim: async (
    userId: string,
    projectId: string,
    body: { title?: string; description?: string },
  ) => {
    try {
      return await req<{ ok: boolean; issue_id: string; document_id: string; qc_path?: string; due_at?: string | null; post_closeout?: boolean; sla_days?: number }>(
        `/api/v1/projects/${projectId}/warranty-claims`,
        { method: 'POST', body: JSON.stringify(body) },
        userId,
      );
    } catch (e) {
      const { ApiError } = await import('./client');
      if (e instanceof ApiError) throw e;
      const { enqueue } = await import('@/lib/offlineQueue');
      await enqueue({
        path: `/api/v1/projects/${projectId}/warranty-claims`,
        method: 'POST',
        body: JSON.stringify(body),
        userId,
      });
      throw new Error('offline_queued');
    }
  },
  listWarrantyClaims: (userId: string, projectId: string) =>
    req<{
      items: { id: string; title: string; status: string; created_at?: string; overdue?: boolean }[];
      open: number;
      overdue?: number;
      post_closeout_allowed?: boolean;
    }>(
      `/api/v1/projects/${projectId}/warranty-claims`,
      {},
      userId,
    ),
  closeWarrantyClaim: async (userId: string, projectId: string, issueId: string) => {
    try {
      return await req<{ ok: boolean }>(`/api/v1/projects/${projectId}/warranty-claims/${issueId}/close`, { method: 'POST' }, userId);
    } catch (e) {
      const { ApiError } = await import('./client');
      if (e instanceof ApiError) throw e;
      const { enqueue } = await import('@/lib/offlineQueue');
      await enqueue({
        path: `/api/v1/projects/${projectId}/warranty-claims/${issueId}/close`,
        method: 'POST',
        body: '',
        userId,
      });
      throw new Error('offline_queued');
    }
  },
  closeoutChecklist: (userId: string, projectId: string) =>
    req<{
      ready: boolean;
      all_stages_done: boolean;
      pending_payments: number;
      warranty_open: number;
      warranty_overdue?: number;
      post_closeout?: boolean;
      warranty_post_closeout_allowed?: boolean;
      acceptance_acts_active: number;
      next_action: string;
      archived: boolean;
    }>(`/api/v1/projects/${projectId}/closeout-checklist`, {}, userId),
  closeoutProject: (userId: string, projectId: string) =>
    req<{ ok: boolean; ready: boolean; next_action: string }>(
      `/api/v1/projects/${projectId}/closeout`,
      { method: 'POST' },
      userId,
    ),
};
