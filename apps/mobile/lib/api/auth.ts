/** API: auth */
import { req, cachedGet, API_BASE } from './client';
import type { User, UserRole } from './types';
const LOGOUT_TIMEOUT_MS = 5000;

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
  revokeAllSessions: (userId: string) =>
    req<{ ok: boolean; revoked: number }>('/api/v1/auth/sessions/revoke-all', { method: 'POST' }, userId),
  /**
   * Отзыв refresh-сессии на сервере. Без `req`: не нужен Bearer, а 401 не должен
   * запускать ротацию токена. Бросает при сетевой/HTTP-ошибке — решение, что
   * делать с сбоем (локальный выход всё равно происходит), за вызывающим.
   */
  logout: async (refreshToken: string): Promise<void> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LOGOUT_TIMEOUT_MS);
    try {
      const res = await fetch(`${API_BASE}/api/v1/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`logout_http_${res.status}`);
    } finally {
      clearTimeout(timer);
    }
  },
  /** COM-017: отвязать токен этого устройства (без токена — все токены вызывающего). Идемпотентно. */
  unregisterPushToken: (userId: string, token?: string) =>
    req('/api/v1/push/unregister', { method: 'POST', ...(token ? { body: JSON.stringify({ token }) } : {}) }, userId),
  registerPushToken: (userId: string, token: string) => req('/api/v1/push/register', { method: 'POST', body: JSON.stringify({ token }) }, userId),
};
