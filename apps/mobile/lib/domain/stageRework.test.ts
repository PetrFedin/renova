import { reworkStages, stageNeedsRework, stageShortStatusLabel } from './stageRework';

const LABELS = { done: 'Завершено', review: 'Ждёт приёмки', active: 'В работе', planned: 'Не начато' };

const active = { status: 'active' as const };
const activeRework = { status: 'active' as const, needs_rework: true };
const reviewRework = { status: 'review' as const, needs_rework: true };
const doneRework = { status: 'done' as const, needs_rework: true };

if (stageNeedsRework(active)) throw new Error('обычный этап не в доработке');
if (!stageNeedsRework(activeRework)) throw new Error('флаг доработки не прочитан');
if (!stageNeedsRework(reviewRework)) throw new Error('доработка на приёмке тоже доработка');
if (stageNeedsRework(doneRework)) throw new Error('завершённый этап переделывать не зовут');
if (stageNeedsRework({ status: 'active' as const, needs_rework: false })) throw new Error('false — не доработка');
if (stageNeedsRework({ status: 'active' as const })) throw new Error('отсутствие поля — не доработка');

const list = [active, activeRework, doneRework, reviewRework];
const picked = reworkStages(list).map((s) => s.status).join(',');
if (picked !== 'active,review') throw new Error(`отбор доработок: ${picked}`);

if (stageShortStatusLabel(active, LABELS) !== 'В работе') throw new Error('обычная подпись');
if (stageShortStatusLabel(activeRework, LABELS) !== 'Доработка') throw new Error('доработка важнее статуса');
if (stageShortStatusLabel(doneRework, LABELS) !== 'Завершено') throw new Error('завершённый — завершён');
if (stageShortStatusLabel({ status: 'неизвестно' }, LABELS) !== 'неизвестно') {
  throw new Error('неизвестный статус отдаётся как есть, а не теряется');
}

console.log('stageRework.test OK');
