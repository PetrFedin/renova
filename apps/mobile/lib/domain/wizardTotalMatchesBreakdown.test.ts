/**
 * В мастере итог не сходился с разбивкой под ним.
 *
 * Крупное число — `summary.grandTotal`, а подпись под ним называла только
 * работы и материалы. В итог входит ещё резерв, и на живом прогоне это
 * выглядело так: «147 920 ₽» сверху и «работы 74 919 ₽ · материалы
 * 65 957 ₽» под ним — 7 044 ₽ ниоткуда. Это экран, на котором человек
 * подтверждает сумму объекта, и сверить её он не мог.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { calcEstimateSummary } from '@/lib/calc-engine/estimate';

// 1. Итог действительно больше суммы работ и материалов — иначе проверка
//    сторожила бы несуществующее.
const summary = calcEstimateSummary(
  [{ id: 'm1', name: 'Плитка', unit: 'м2', quantity: 10, unitPrice: 1000 } as never],
  [{ id: 'w1', name: 'Укладка', unit: 'м2', quantity: 10, ratePerUnit: 800 } as never],
);
const parts = summary.worksTotal + summary.materialsTotal;
if (!(summary.grandTotal > parts)) {
  throw new Error('итог перестал включать резерв — проверку нужно пересмотреть');
}
if (Math.abs(summary.grandTotal - (parts + summary.reserveAmount)) > 0.01) {
  throw new Error('итог не равен работам, материалам и резерву');
}

// 2. Экран показывает все три слагаемых.
const src = readFileSync(join(__dirname, '../../app/wizard/_screens/confirm.tsx'), 'utf8');
const code = src.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

const breakdown = code.slice(code.indexOf('работы {formatRub('));
const line = breakdown.slice(0, breakdown.indexOf('</Text>'));
if (!line.includes('summary.worksTotal')) throw new Error('в разбивке пропали работы');
if (!line.includes('summary.materialsTotal')) throw new Error('в разбивке пропали материалы');
if (!line.includes('summary.reserveAmount')) {
  throw new Error('в разбивке нет резерва — итог над ней снова не сойдётся');
}

// 3. Крупное число по-прежнему итог, а не подсумма: подменить его на
//    `subtotal` — не решение, человек подтверждает именно итог.
if (!code.includes('formatRub(summary.grandTotal)')) {
  throw new Error('крупное число перестало быть итогом сметы');
}

console.log('wizardTotalMatchesBreakdown.test OK');
