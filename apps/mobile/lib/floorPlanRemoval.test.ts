/** План, метку и мебель можно убрать с экрана — и только с подтверждением. */
import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');
const src = (rel: string) => readFileSync(join(mobile, rel), 'utf8');

const apiSrc = src('lib/api/floor.ts');
const panel = src('components/renova/FloorPlanPanel.tsx');
const furniture = src('components/renova/FurnitureLayer.tsx');

for (const name of ['deleteFloorPlan', 'deleteFloorPin', 'deleteFurniture']) {
  if (!apiSrc.includes(`${name}:`)) throw new Error(`нет клиентского метода ${name}`);
  const block = apiSrc.split(`${name}:`)[1].slice(0, 700);
  if (!block.includes("method: 'DELETE'")) throw new Error(`${name} не шлёт DELETE`);
  if (!block.includes('enqueue(')) throw new Error(`${name} не уходит в офлайн-очередь`);
}
if (!apiSrc.includes('pins_removed') || !apiSrc.includes('furniture_detached')) {
  throw new Error('ответ удаления плана разобран не полностью');
}

if (!panel.includes("confirmDestructive(\n      'Убрать план этажа?'")) {
  throw new Error('план убирается без подтверждения');
}
if (!panel.includes("confirmDestructive(\n      'Снять метку с плана?'")) {
  throw new Error('метка снимается без подтверждения');
}
if (!panel.includes('Снято меток: ${result.pins_removed}')) {
  throw new Error('последствия удаления плана не показаны человеку');
}
if (!panel.includes("title={removing ? 'Убираем…' : 'Убрать план этажа'}")) {
  throw new Error('нет кнопки «Убрать план этажа»');
}
if (!panel.includes("onLongPress={role === 'contractor'")) {
  throw new Error('снятие метки доступно не только исполнителю');
}
if (!panel.includes('Долгое нажатие на метку комнаты')) {
  throw new Error('скрытый жест не объяснён подписью');
}

if (!furniture.includes("confirmDestructive(\n      'Убрать предмет?'")) {
  throw new Error('мебель убирается без подтверждения');
}
if (!furniture.includes('minWidth: RenovaTheme.minTouch')) {
  throw new Error('кнопки мебели меньше порога касания');
}
if (!furniture.includes('accessibilityLabel={`Убрать')) {
  throw new Error('кнопка удаления мебели не называет себя');
}

console.log('floorPlanRemoval.test OK');
