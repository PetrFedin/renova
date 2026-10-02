/**
 * O-1 (live-audit-2): экраны исполнителя (`audience: 'contractor'` в routeRegistry) не должны
 * открываться заказчику по прямой ссылке. Раньше они грузились и слали 403-запросы
 * (`/teams/me`, шаблоны, очередь), показывая «Не удалось загрузить».
 * Решение принимается по реестру ДО монтирования экрана — сеть не трогаем.
 */
import { RENOVA_ROUTES } from './routeRegistry';

export type AudienceRole = 'customer' | 'contractor';

export type AudienceDecision =
  | { kind: 'wait' }
  | { kind: 'allow' }
  | { kind: 'redirect'; to: 'home' | 'repair-control'; message: string };

export const AUDIENCE_DENIED_MESSAGE = 'Этот раздел доступен только исполнителю. Открыта ваша главная.';

function normalize(path: string): string {
  const p = path.split('?')[0].replace(/\/+$/, '');
  return p.startsWith('/') ? p : `/${p}`;
}

/** Аудитория маршрута по реестру; неизвестный путь считаем общим. */
export function routeAudience(path: string): 'customer' | 'contractor' | 'both' {
  const p = normalize(path);
  return RENOVA_ROUTES.find((r) => r.path === p)?.audience ?? 'both';
}

export function decideRouteAudienceAccess(
  path: string,
  state: { loading: boolean; userRole?: string | null; hasUser: boolean },
): AudienceDecision {
  if (state.loading) return { kind: 'wait' };
  // Без сессии отвечает RoleGroupGuard / онбординг; здесь только роли.
  if (!state.hasUser) return { kind: 'allow' };
  const role: AudienceRole = state.userRole === 'contractor' ? 'contractor' : 'customer';
  const audience = routeAudience(path);
  if (audience === 'both' || audience === role) return { kind: 'allow' };
  // Контроль качества у заказчика — это хаб «Ремонт → Приёмка» (канон входа из реестра).
  if (normalize(path) === '/quality-control' && role === 'customer') {
    return { kind: 'redirect', to: 'repair-control', message: AUDIENCE_DENIED_MESSAGE };
  }
  return { kind: 'redirect', to: 'home', message: AUDIENCE_DENIED_MESSAGE };
}
