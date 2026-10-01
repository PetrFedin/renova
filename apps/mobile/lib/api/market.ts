/** API: market */
import { req, cachedGet, API_BASE } from './client';
import { buildJobLeadsQueryString } from '@/lib/domain/jobLeadUi';

/** W140: тело создания заявки — совпадает с backend LeadIn */
export type JobLeadCreateBody = {
  title: string;
  address?: string;
  area_sqm: number;
  renovation_type: string;
  budget_hint: number;
  description?: string;
};

export const marketApi = {

  listWorkTypes: (category?: string) => req<{ code: string; name: string; category: string }[]>(`/api/v1/work-types${category ? `?category=${category}` : ''}`),
  listMarketRegions: () => req<{ code: string; name: string; labor_index: number; material_index: number }[]>('/api/v1/market/regions'),
  marketEstimate: (body: object) => req<import('@/constants/regions').MarketEstimate>('/api/v1/market/estimate', { method: 'POST', body: JSON.stringify(body) }),
  projectMarketEstimate: (userId: string, projectId: string, body: object) =>
    req<import('@/constants/regions').MarketEstimate>(`/api/v1/projects/${projectId}/budget/market-estimate`, { method: 'POST', body: JSON.stringify(body) }, userId),
  listContractors: (userId: string, city?: string) => req<{ id: string; user_id?: string; name: string; company?: string; specialties?: string; rating: number | null; jobs_done: number | null; city?: string }[]>(`/api/v1/contractors${city ? `?city=${city}` : ''}`, {}, userId),
  getMyContractorProfile: (userId: string) =>
    req<{ id?: string; company_name?: string | null; payment_requisites?: string | null; specialties?: string | null; city?: string | null; bio?: string | null; full_name?: string | null; phone?: string }>(
      '/api/v1/contractors/me/profile',
      {},
      userId,
    ),
  upsertContractorProfile: (userId: string, body: object) => req('/api/v1/contractors/profile', { method: 'POST', body: JSON.stringify(body) }, userId),
  matchContractors: (userId: string, renovationType?: string, specialty?: string) => { const q = new URLSearchParams(); if (renovationType) q.set('renovation_type', renovationType); if (specialty) q.set('specialty', specialty); return req<{ id: string; user_id?: string; name: string; company?: string; score: number; rating: number | null; match_basis?: string }[]>(`/api/v1/contractors/match?${q}`, {}, userId); },
  contractorPortfolio: (userId: string, profileId: string) => req<{ id: string; image_url: string; caption?: string }[]>(`/api/v1/contractors/${profileId}/portfolio`, {}, userId),
  listJobLeads: (
    userId: string,
    status?: string,
    page?: { limit?: number; offset?: number; city?: string; renovation_type?: string; budget_min?: number; budget_max?: number },
  ) =>
    req<
      {
        id: string;
        title: string;
        address?: string;
        location_public?: string;
        address_precision?: 'full' | 'public';
        area_sqm?: number;
        renovation_type: string;
        budget_hint?: number;
        pre_estimate?: number;
        description?: string | null;
        status: string;
        assigned_contractor_id?: string | null;
        quotes_count?: number;
        quotes?: { id: string; contractor_id: string; pre_estimate: number; note?: string | null }[];
      }[]
    >(`/api/v1/job-leads${buildJobLeadsQueryString(status, page)}`, {}, userId),
  createJobLead: (userId: string, body: JobLeadCreateBody) =>
    req('/api/v1/job-leads', { method: 'POST', body: JSON.stringify(body) }, userId),
  quoteJobLead: (userId: string, leadId: string, pre_estimate: number) =>
    req(`/api/v1/job-leads/${leadId}/quote`, { method: 'POST', body: JSON.stringify({ pre_estimate }) }, userId),
  /** Исполнитель отзывает свой отклик (пока заявка открыта). */
  withdrawJobLeadQuote: (userId: string, leadId: string) =>
    req(`/api/v1/job-leads/${leadId}/quote/withdraw`, { method: 'POST' }, userId),
  /** Заказчик закрывает свою открытую заявку; причина необязательна. */
  closeJobLead: (userId: string, leadId: string, reason?: string) =>
    req(`/api/v1/job-leads/${leadId}/close`, { method: 'POST', body: JSON.stringify(reason?.trim() ? { reason: reason.trim() } : {}) }, userId),
  /** Назначенный исполнитель отказывается от заявки. */
  declineJobLeadAssignment: (userId: string, leadId: string) =>
    req(`/api/v1/job-leads/${leadId}/decline-assignment`, { method: 'POST' }, userId),
  /** Заказчик правит свою заявку, пока она открыта. */
  updateJobLead: (userId: string, leadId: string, body: Partial<JobLeadCreateBody>) =>
    req(`/api/v1/job-leads/${leadId}`, { method: 'PATCH', body: JSON.stringify(body) }, userId),
  acceptJobLeadQuote: (userId: string, leadId: string, quoteId: string) =>
    req(`/api/v1/job-leads/${leadId}/quotes/${quoteId}/accept`, { method: 'POST' }, userId),
  convertJobLead: (userId: string, leadId: string, body?: { property_type?: string; rooms?: object[] }) =>
    req<{ project_id: string; name: string }>(`/api/v1/job-leads/${leadId}/convert`, { method: 'POST', body: JSON.stringify(body || {}) }, userId),
  /** MKT-010: тред заявки. Заказчик указывает `contractorId` (собеседник), исполнитель видит только свой тред. */
  leadMessages: (userId: string, leadId: string, contractorId?: string) =>
    req<{ id: string; user_id: string; text: string; at: string; thread_contractor_id?: string }[]>(
      `/api/v1/job-leads/${leadId}/messages${contractorId ? `?contractor_id=${encodeURIComponent(contractorId)}` : ''}`,
      {},
      userId,
    ),
  postLeadMessage: (userId: string, leadId: string, text: string, contractorId?: string) =>
    req(
      `/api/v1/job-leads/${leadId}/messages${contractorId ? `?contractor_id=${encodeURIComponent(contractorId)}` : ''}`,
      { method: 'POST', body: JSON.stringify({ text }) },
      userId,
    ),
  /** Заказчику: откликнувшиеся исполнители с тредами (без телефонов и цен). */
  leadThreads: (userId: string, leadId: string) =>
    req<{ contractor_id: string; name: string; assigned: boolean; message_count: number; last_message_at: string | null }[]>(
      `/api/v1/job-leads/${leadId}/threads`,
      {},
      userId,
    ),
  autoAssignLead: (userId: string, leadId: string) => req(`/api/v1/job-leads/${leadId}/auto-assign`, { method: 'POST' }, userId),
};
