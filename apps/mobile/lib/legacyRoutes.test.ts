import {
  legacyRouteCanonical,
  logLegacyRouteDeprecation,
  resetLegacyRouteLogForTests,
  resolveLegacyRoute,
} from './legacyRoutes';

resetLegacyRouteLogForTests();

if (!legacyRouteCanonical('/(customer)/(tabs)/finance').includes('budget')) {
  throw new Error('finance → budget');
}
if (!resolveLegacyRoute('/(customer)/(tabs)/finance').pathname.includes('budget')) {
  throw new Error('resolve finance');
}

logLegacyRouteDeprecation('/a', '/b');
logLegacyRouteDeprecation('/a', '/b');

if (legacyRouteCanonical('/(customer)/(tabs)/control') !== '/quality-control') {
  throw new Error('control → quality-control');
}

console.log('legacyRoutes.test OK');
