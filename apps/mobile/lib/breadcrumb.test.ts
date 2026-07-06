import { buildBreadcrumb, formatReturnToTrail, hubTabRouteName, parseHubTabRouteName } from './breadcrumb';

const crumbs = buildBreadcrumb('customer', '/(customer)/(tabs)/repair', { hubTab: 'control' });
if (crumbs.length !== 3) throw new Error('expected 3 crumbs');
if (crumbs[2].label !== 'Приёмка') throw new Error('tab label');
if (crumbs[2].routeName !== hubTabRouteName('repair', 'control')) throw new Error('tab route');

if (!parseHubTabRouteName('repair:control')) throw new Error('parse hub tab');
if (formatReturnToTrail('/(customer)/(tabs)/repair?tab=control', 'customer') !== 'Ремонт › Приёмка') {
  throw new Error('returnTo trail repair');
}
if (formatReturnToTrail('/(customer)/(tabs)/budget?tab=expenses', 'customer') !== 'Деньги › Расходы') {
  throw new Error('returnTo trail budget');
}

console.log('breadcrumb.test OK');
