import {
  legacyRouteCanonical,
  logLegacyRouteDeprecation,
  resetLegacyRouteLogForTests,
  resolveLegacyRoute,
  TAB_ALIASES,
} from './legacyRoutes';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

resetLegacyRouteLogForTests();

if (!legacyRouteCanonical('/(customer)/(tabs)/finance').includes('budget')) {
  throw new Error('finance → budget');
}
if (!resolveLegacyRoute('/(customer)/(tabs)/finance').pathname.includes('budget')) {
  throw new Error('resolve finance');
}

logLegacyRouteDeprecation('/a', '/b');
logLegacyRouteDeprecation('/a', '/b');

if (legacyRouteCanonical('/(customer)/(tabs)/control') !== '/work-acceptance') {
  throw new Error('customer control → work-acceptance');
}
if (legacyRouteCanonical('/(contractor)/(tabs)/control') !== '/quality-control') {
  throw new Error('contractor control → quality-control');
}

/** P3-W37: legacy tabs → [legacyTab].tsx catch-all (static tabs имеют приоритет) */
const appRoot = join(__dirname, '..', 'app');
for (const role of ['customer', 'contractor'] as const) {
  const catchAll = join(appRoot, `(${role})`, '(tabs)', '[legacyTab].tsx');
  if (!existsSync(catchAll)) {
    throw new Error(`missing legacy catch-all: ${catchAll}`);
  }
  const src = readFileSync(catchAll, 'utf8');
  if (!/LegacyTabRedirect/.test(src)) {
    throw new Error(`catch-all must use LegacyTabRedirect: ${catchAll}`);
  }
}
for (const legacyPath of Object.keys(TAB_ALIASES)) {
  const m = legacyPath.match(/^\/\((\w+)\)\/\(tabs\)\/(.+)$/);
  if (!m) continue;
  const tab = m[2];
  // Static tab screens (budget/index/…) must not be overwritten by catch-all
  const staticFile = join(appRoot, `(${m[1]})`, '(tabs)', `${tab}.tsx`);
  if (existsSync(staticFile) && !/LegacyTabRedirect|Redirect/.test(readFileSync(staticFile, 'utf8'))) {
    // real screen — OK
    continue;
  }
}

console.log('legacyRoutes.test OK');
