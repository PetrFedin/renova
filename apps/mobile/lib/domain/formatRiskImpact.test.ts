import { formatRiskImpact } from './formatRiskImpact';

const out = formatRiskImpact('+18407733 ₽ к смете');
if (/18407733/.test(out) || !/18.407.733 ₽ к смете/.test(out.replace(/[\s  ]/g, '.').replace(/\.₽/, ' ₽').replace(/\./g, '.'))) {
  if (!/^\+18[\s  ]407[\s  ]733 ₽/.test(out)) throw new Error('разделители тысяч: ' + out);
}
if (formatRiskImpact('+500 ₽') !== '+500 ₽') throw new Error('малые суммы без изменений');
if (formatRiskImpact(undefined) !== '') throw new Error('пусто');
console.log('formatRiskImpact.test OK');
