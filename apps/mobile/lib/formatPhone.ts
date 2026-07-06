/** Нормализация телефона для API (+7…) */
import { ApiError } from './api/client';

export function normalizePhoneInput(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('8') && digits.length === 11) return `+7${digits.slice(1)}`;
  if (digits.startsWith('7') && digits.length === 11) return `+${digits}`;
  if (digits.length === 10) return `+7${digits}`;
  if (raw.trim().startsWith('+')) return `+${digits}`;
  return raw.trim();
}

/** Текст ошибки API для Alert */
export function apiErrorMessage(e: unknown, fallback: string): string {
  if (e instanceof ApiError && e.message) return e.message;
  if (e instanceof Error && e.message && !e.message.startsWith('{')) return e.message;
  return fallback;
}
