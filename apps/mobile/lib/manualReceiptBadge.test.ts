/**
 * Чек, внесённый вручную, получал бейдж «✓ ФНС».
 *
 * Сервер отдавал такому чеку `verified: true` жёстко, и список чеков рисовал
 * по этому полю зелёную отметку о проверке налоговой. Перепроверка того же
 * чека при этом отвечала «ручной расход нельзя проверить через ФНС».
 *
 * У ручного чека теперь своя подпись: он не «проверен» и не «не проверен» —
 * его никто не проверял и проверить нельзя.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(
  join(__dirname, '../components/renova/ReceiptList.tsx'),
  'utf8',
);
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

if (!code.includes("'Внесён вручную'")) {
  throw new Error('у ручного чека нет собственной подписи');
}
if (!/r\.source === 'manual' \? 'Внесён вручную' : 'Не проверен'/.test(code)) {
  throw new Error('ручной чек снова показывается как непройденная проверка');
}
if (!code.includes("'✓ ФНС'")) {
  throw new Error('подпись проверенного ФНС чека пропала');
}
// Отметка проверки по-прежнему берётся из ответа сервера, а не выдумывается.
if (!/r\.verified\s*$|r\.verified\n/m.test(code) && !code.includes('r.verified')) {
  throw new Error('признак проверки перестал читаться из чека');
}

console.log('manualReceiptBadge.test OK');
