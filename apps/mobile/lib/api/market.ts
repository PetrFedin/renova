/** API: market */
import { req, cachedGet, API_BASE } from './client';

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
  listContractors: (userId: string, city?: string) => req<{ id: string; name: string; company?: string; specialties?: string; rating: number; jobs_done: number; city?: string }[]>(`/api/v1/contractors${city ? `?city=${city}` : ''}`, {}, userId),
  getMyContractorProfile: (userId: string) =>
    req<{ id?: string; company_name?: string | null; payment_requisites?: string | null; full_name?: string | null; phone?: string }>(
      '/api/v1/contractors/me/profile',
      {},
      userId,
    ),
  upsertContractorProfile: (userId: string, body: object) => req('/api/v1/contractors/profile', { method: 'POST', body: JSON.stringify(body) }, userId),
  matchContractors: (userId: string, renovationType?: string, specialty?: string) => { const q = new URLSearchParams(); if (renovationType) q.set('renovation_type', renovationType); if (specialty) q.set('specialty', specialty); return req<{ id: string; name: string; company?: string; score: number; rating: number }[]>(`/api/v1/contractors/match?${q}`, {}, userId); },
  contractorPortfolio: (userId: string, profileId: string) => req<{ id: string; image_url: string; caption?: string }[]>(`/api/v1/contractors/${profileId}/portfolio`, {}, userId),
  listJobLeads: (userId: string, status?: string) =>
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
    >(`/api/v1/job-leads${status ? `?status=${status}` : ''}`, {}, userId),
  createJobLead: (userId: string, body: JobLeadCreateBody) =>
    req('/api/v1/job-leads', { method: 'POST', body: JSON.stringify(body) }, userId),
  quoteJobLead: (userId: string, leadId: string, pre_estimate: number) =>
    req(`/api/v1/job-leads/${leadId}/quote`, { method: 'POST', body: JSON.stringify({ pre_estimate }) }, userId),
  acceptJobLeadQuote: (userId: string, leadId: string, quoteId: string) =>
    req(`/api/v1/job-leads/${leadId}/quotes/${quoteId}/accept`, { method: 'POST' }, userId),
  convertJobLead: (userId: string, leadId: string, body?: { property_type?: string; rooms?: object[] }) =>
    req<{ project_id: string; name: string }>(`/api/v1/job-leads/${leadId}/convert`, { method: 'POST', body: JSON.stringify(body || {}) }, userId),
  leadMessages: (userId: string, leadId: string) => req<{ id: string; user_id: string; text: string; at: string }[]>(`/api/v1/job-leads/${leadId}/messages`, {}, userId),
  postLeadMessage: (userId: string, leadId: string, text: string) => req(`/api/v1/job-leads/${leadId}/messages`, { method: 'POST', body: JSON.stringify({ text }) }, userId),
  autoAssignLead: (userId: string, leadId: string) => req(`/api/v1/job-leads/${leadId}/auto-assign`, { method: 'POST' }, userId),
};
