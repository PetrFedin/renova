/** Legacy routes — aliases, redirect и deprecation log (W52: см. resolveCatchAllSlug). */
import { parseOsHref, type OsTabRoute } from '../constants/osSections';

/** Legacy tab-маршруты → канонические hub-пути */
export const TAB_ALIASES: Record<string, string> = {
  '/(customer)/(tabs)/finance': '/(customer)/(tabs)/budget',
  '/(customer)/(tabs)/more': '/(customer)/(tabs)/profile',
  '/(customer)/(tabs)/works': '/(customer)/(tabs)/repair?tab=works',
  '/(customer)/(tabs)/materials': '/(customer)/(tabs)/repair?tab=materials',
  '/(customer)/(tabs)/control': '/(customer)/(tabs)/repair?tab=control',
  '/(customer)/(tabs)/stages': '/(customer)/(tabs)/repair?tab=works',
  '/(customer)/(tabs)/rooms': '/(customer)/(tabs)/object?tab=rooms',
  '/(customer)/(tabs)/estimate': '/(customer)/(tabs)/object?tab=estimate',
  '/project-analytics': '/(customer)/(tabs)/budget?tab=deviations',
  '/(customer)/(tabs)/plan': '/(customer)/(tabs)/object?tab=plan',
  '/(contractor)/(tabs)/money': '/(contractor)/(tabs)/budget',
  '/(contractor)/(tabs)/more': '/(contractor)/(tabs)/profile',
  '/(contractor)/(tabs)/works': '/(contractor)/(tabs)/repair?tab=works',
  '/(contractor)/(tabs)/materials': '/(contractor)/(tabs)/repair?tab=materials',
  '/(contractor)/(tabs)/control': '/(contractor)/(tabs)/repair?tab=control',
  '/(contractor)/(tabs)/stages': '/(contractor)/(tabs)/repair?tab=works',
  '/(contractor)/(tabs)/rooms': '/(contractor)/(tabs)/object?tab=rooms',
  '/(contractor)/(tabs)/estimate': '/(contractor)/(tabs)/object?tab=estimate',
  '/(contractor)/(tabs)/plan': '/(contractor)/(tabs)/object?tab=plan',
  '/(contractor)/(tabs)/objects': '/(contractor)/(tabs)/',
};

const logged = new Set<string>();

/** Канонический href для legacy path (без redirect) */
export function legacyRouteCanonical(from: string): string {
  return TAB_ALIASES[from] || from;
}

/** Логирует deprecated маршрут один раз за сессию (dev) */
export function logLegacyRouteDeprecation(from: string, to: string): void {
  const key = `${from}→${to}`;
  if (logged.has(key)) return;
  logged.add(key);
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.info(`[renova:legacy-route] ${from} → ${to}`);
  }
}

/** Redirect href для legacy tab-файлов */
export function resolveLegacyRoute(from: string): OsTabRoute {
  const canonical = legacyRouteCanonical(from);
  if (TAB_ALIASES[from]) {
    logLegacyRouteDeprecation(from, canonical);
  }
  return parseOsHref(canonical);
}

/** Сброс для тестов */
export function resetLegacyRouteLogForTests(): void {
  logged.clear();
}
