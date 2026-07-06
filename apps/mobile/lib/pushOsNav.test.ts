/** Smoke-тест parseOsHref / tabsRoute — без expo-router */
import { parseOsHref, calendarTabRoute } from '../constants/osSections';

const r = calendarTabRoute('customer');
console.assert(r.pathname.includes('calendar'), 'calendar path');
console.assert(!r.params?.tab, 'calendar is standalone route');

const parsed = parseOsHref('/(customer)/(tabs)/object?tab=rooms&sub=design');
console.assert(parsed.params?.tab === 'rooms', 'parse tab');
console.assert(parsed.params?.sub === 'design', 'parse sub');

console.log('pushOsNav.test OK');
