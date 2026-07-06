/** API: auth */
import { req, cachedGet, API_BASE } from './client';
import type { User, UserRole } from './types';
export const authApi = {
  register: (body: object) => req<User>('/api/v1/auth/register', { method: 'POST', body: JSON.stringify(body) }),
  sendSmsCode: (phone: string) => req<{ ok: boolean; message?: string; demo_code?: string }>('/api/v1/auth/sms/send', { method: 'POST', body: JSON.stringify({ phone }) }),
  verifySmsCode: (phone: string, code: string, role: UserRole, extra?: { full_name?: string; inn?: string }) =>
    req<User>('/api/v1/auth/sms/verify', { method: 'POST', body: JSON.stringify({ phone, code, role, ...extra }) }),
  demoLogin: (role: UserRole) => req<User>('/api/v1/auth/demo', { method: 'POST', body: JSON.stringify({ role }) }),
  demoGuest: () => req<User>('/api/v1/auth/demo/guest', { method: 'POST' }),
  me: (userId: string) => req<User>('/api/v1/auth/me', {}, userId),
  exportMyData: (userId: string) => req<{ user: object; projects: object[] }>('/api/v1/auth/export', {}, userId),
  anonymizeMe: (userId: string) => req('/api/v1/auth/anonymize', { method: 'POST' }, userId),
  registerPushToken: (userId: string, token: string) => req('/api/v1/push/register', { method: 'POST', body: JSON.stringify({ token }) }, userId),
};
