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

/** P3-W11 registry v3: каждый legacy tab-файл существует и — thin redirect */
const appRoot = join(__dirname, '..', 'app');
for (const legacyPath of Object.keys(TAB_ALIASES)) {
  const m = legacyPath.match(/^\/\((\w+)\)\/\(tabs\)\/(.+)$/);
  if (!m) continue;
  const role = m[1];
  const tab = m[2];
  const file = join(appRoot, `(${role})`, '(tabs)', `${tab}.tsx`);
  if (!existsSync(file)) {
    throw new Error(`missing legacy tab file: ${file}`);
  }
  const src = readFileSync(file, 'utf8');
  if (!/LegacyTabRedirect|Redirect/.test(src)) {
    throw new Error(`legacy tab not a redirect: ${file}`);
  }
}

console.log('legacyRoutes.test OK');
