/** Правка и удаление строки сметы доступны с экрана, и только пока смета черновая. */
import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');
const src = (rel: string) => readFileSync(join(mobile, rel), 'utf8');

const apiSrc = src('lib/api/estimate.ts');
const card = src('components/renova/estimate/EstimateLineEditorCard.tsx');
const group = src('components/renova/estimate/EstimateEditorByRoom.tsx');
const view = src('components/screens/estimate/ContractorEstimateView.tsx');

if (!apiSrc.includes('deleteEstimateLine')) throw new Error('нет клиентского удаления строки');
if (!/deleteEstimateLine[\s\S]{0,400}method: 'DELETE'/.test(apiSrc)) {
  throw new Error('удаление строки не шлёт DELETE');
}
if (!/deleteEstimateLine[\s\S]{0,700}enqueue\(/.test(apiSrc)) {
  throw new Error('удаление строки не уходит в офлайн-очередь, как правка');
}

if (!card.includes('label="Наименование"')) throw new Error('наименование строки не правится');
if (!card.includes('label="Ед. изм."')) throw new Error('единица измерения не правится');
if (!card.includes('numeric={false}')) throw new Error('текстовые поля идут с цифровой клавиатурой');
if (!card.includes('confirmDestructive(')) throw new Error('удаление строки без подтверждения');
if (!/confirmDestructive\([\s\S]{0,300}\n\s*\);\n\s*if \(!ok\) return;/.test(card)) {
  throw new Error('отказ в подтверждении не останавливает удаление');
}
if (!card.includes('onDelete && canWrite')) throw new Error('кнопка удаления показана без права записи');

if (!group.includes('onDelete={onDelete}')) throw new Error('группа по комнатам не передаёт удаление');

if (!view.includes('const editable = canWrite && !activeProject?.estimate_locked_at')) {
  throw new Error('правка не заблокирована после фиксации сметы');
}
if (!view.includes('onDelete={editable ? deleteLine : undefined}')) {
  throw new Error('удаление предлагается для зафиксированной сметы');
}
if (!/async function deleteLine[\s\S]{0,400}notifyOfflineQueued\('Удаление строки'\)/.test(view)) {
  throw new Error('офлайн-удаление молчит');
}

console.log('estimateLineEditing.test OK');
