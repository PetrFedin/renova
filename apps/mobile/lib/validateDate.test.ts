import { isIsoDate, normalizeIsoDateInput } from './validateDate';

if (!isIsoDate('2026-06-28')) throw new Error('valid date');
if (isIsoDate('2026-13-01')) throw new Error('invalid month');
if (normalizeIsoDateInput('2026-06-28abc') !== '2026-06-28') throw new Error('normalize');

console.log('validateDate.test OK');
