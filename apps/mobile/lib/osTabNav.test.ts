/** Smoke-тест returnTo для OS-навигации */
import { homeReturnTo, returnToLabel, withReturnTo } from './osReturnTo';
import { calendarTabRoute } from '../constants/osSections';

const home = homeReturnTo('customer');
console.assert(home === '/(customer)/(tabs)/', 'home returnTo');

const route = withReturnTo(calendarTabRoute('customer', { date: '2026-06-01' }), home);
console.assert(route.params?.date === '2026-06-01', 'date preserved');
console.assert(route.params?.returnTo === home, 'returnTo attached');

console.assert(returnToLabel(home, 'customer') === 'Главная', 'home label');
console.assert(returnToLabel('/(customer)/(tabs)/index', 'customer') === 'Главная', 'home index label');
console.assert(returnToLabel('/(customer)/(tabs)/repair', 'customer') === 'Ремонт', 'repair label');
console.assert(returnToLabel('/(customer)/(tabs)/budget', 'customer') === 'Бюджет', 'budget label');
console.assert(returnToLabel('/(customer)/(tabs)/budget?tab=payments', 'customer') === 'Бюджет · Оплаты', 'budget payments');
console.assert(returnToLabel('/unknown/path', 'customer') === undefined, 'unknown → no duplicate label');

console.log('osTabNav.test OK');
