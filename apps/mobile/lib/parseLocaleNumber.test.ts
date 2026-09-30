import {
  parseLocaleNumber,
  parseNonNegativeInt,
  parseNonNegativeNumber,
  parsePositiveNumber,
} from './parseLocaleNumber';

function eq(actual: unknown, expected: unknown, label: string) {
  if (actual !== expected) throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
}

eq(parseLocaleNumber('12,5'), 12.5, 'comma');
eq(parseLocaleNumber('12.5'), 12.5, 'dot');
eq(parseLocaleNumber('1 250,50'), 1250.5, 'space thousands + comma');
eq(parseLocaleNumber('1 250,50'), 1250.5, 'nbsp thousands');
eq(parseLocaleNumber('1 250,50'), 1250.5, 'narrow nbsp thousands');
eq(parseLocaleNumber('1 500 000'), 1500000, 'space groups');
eq(parseLocaleNumber('1.250,50'), 1250.5, 'dot thousands, comma decimal');
eq(parseLocaleNumber('1,250.50'), 1250.5, 'comma thousands, dot decimal');
eq(parseLocaleNumber('1.250.500'), 1250500, 'dot-only thousands groups');
eq(parseLocaleNumber('-3,5'), -3.5, 'minus');
eq(parseLocaleNumber('−3'), -3, 'unicode minus');
eq(parseLocaleNumber('  7  '), 7, 'trim');
eq(parseLocaleNumber('.5'), 0.5, 'leading dot');
eq(parseLocaleNumber('0'), 0, 'zero is a number');
eq(parseLocaleNumber(4.2), 4.2, 'number passthrough');
for (const bad of ['', '   ', 'abc', '12abc', '1,2,3x', '--1', '1-', '-', ',', '.', '1e5', 'Infinity', '12,5 ₽', null, undefined, NaN, {}]) {
  eq(parseLocaleNumber(bad as unknown), null, `garbage ${String(bad)}`);
}

eq(parsePositiveNumber('0'), null, 'positive rejects 0');
eq(parsePositiveNumber('-1'), null, 'positive rejects negative');
eq(parsePositiveNumber(''), null, 'positive rejects empty');
eq(parsePositiveNumber('1 500 000'), 1500000, 'positive ok');
eq(parseNonNegativeNumber('0'), 0, 'non-negative allows 0');
eq(parseNonNegativeNumber('-0,1'), null, 'non-negative rejects negative');
eq(parseNonNegativeInt('3'), 3, 'int ok');
eq(parseNonNegativeInt('2,5'), null, 'int rejects fraction');

console.log('parseLocaleNumber.test OK');
