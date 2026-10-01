import assert from 'node:assert/strict';
import {
  LEADS_PAGE_SIZE,
  buildJobLeadsQueryString,
  buildLeadFeedQuery,
  contractorLeadNote,
  hasMorePages,
  jobLeadActions,
  jobLeadStatusLabel,
  mergeLeadPages,
  renovationTypeLabel,
} from './jobLeadUi';

// статусы — по-русски, неизвестный не светит сырой строкой
assert.equal(jobLeadStatusLabel('open'), 'Принимает КП');
assert.equal(jobLeadStatusLabel('quoted'), 'Исполнитель выбран');
assert.equal(jobLeadStatusLabel('taken'), 'Передана в проект');
assert.equal(jobLeadStatusLabel('closed'), 'Закрыта');
assert.equal(jobLeadStatusLabel('weird_status'), 'Статус неизвестен');
assert.equal(jobLeadStatusLabel(undefined), 'Статус неизвестен');

// типы ремонта: полный перечень, незнакомый — нейтрально
assert.equal(renovationTypeLabel('house'), 'Дом / коттедж');
assert.equal(renovationTypeLabel('bathroom'), 'Ванная');
assert.equal(renovationTypeLabel('garbage'), 'Другой тип ремонта');
assert.equal(renovationTypeLabel(''), 'Тип не указан');

// видимость кнопок
const open = { status: 'open', quotes: [] as { contractor_id: string }[] };
const openMine = { status: 'open', quotes: [{ contractor_id: 'c1' }] };
const assigned = { status: 'quoted', assigned_contractor_id: 'c1' };

let a = jobLeadActions('customer', 'u1', open);
assert.ok(a.canClose && a.canEdit && a.canPickQuote);
assert.ok(!a.canWithdrawQuote && !a.canDecline && !a.canQuote);
a = jobLeadActions('customer', 'u1', assigned);
assert.ok(!a.canClose && !a.canEdit && !a.canPickQuote, 'после выбора исполнителя заказчик не правит/закрывает');
a = jobLeadActions('contractor', 'c1', open);
assert.ok(a.canQuote && !a.canWithdrawQuote && !a.awaitingPick);
a = jobLeadActions('contractor', 'c1', openMine);
assert.ok(a.canWithdrawQuote && a.awaitingPick && a.canQuote);
assert.ok(!a.canClose && !a.canEdit);
a = jobLeadActions('contractor', 'c2', openMine);
assert.ok(!a.canWithdrawQuote, 'чужое КП не отзывается');
a = jobLeadActions('contractor', 'c1', assigned);
assert.ok(a.canDecline && !a.canWithdrawQuote && !a.canQuote);
a = jobLeadActions('contractor', 'c2', assigned);
assert.ok(!a.canDecline, 'не назначенный исполнитель не отказывается');
a = jobLeadActions('contractor', 'c1', { status: 'closed', assigned_contractor_id: 'c1' });
assert.ok(!a.canDecline && !a.canQuote);

assert.match(contractorLeadNote(openMine, 'c1') ?? '', /ждём выбора/);
assert.match(contractorLeadNote(assigned, 'c1') ?? '', /выбрал вас/);
assert.equal(contractorLeadNote(open, 'c1'), null);

// фильтры и пагинация
assert.deepEqual(buildLeadFeedQuery({ city: '  ', renovationType: null }, 0), { limit: LEADS_PAGE_SIZE, offset: 0 });
assert.deepEqual(buildLeadFeedQuery({ city: ' Казань ', renovationType: 'kitchen' }, 20), {
  limit: LEADS_PAGE_SIZE, offset: 20, city: 'Казань', renovation_type: 'kitchen',
});
assert.equal(buildJobLeadsQueryString('open', { limit: 20, offset: 0, city: 'Москва' }), '?status=open&limit=20&offset=0&city=%D0%9C%D0%BE%D1%81%D0%BA%D0%B2%D0%B0');
assert.equal(buildJobLeadsQueryString(undefined), '');
assert.equal(buildJobLeadsQueryString('quoted'), '?status=quoted');

const m = mergeLeadPages([{ id: 'a' }, { id: 'b' }], [{ id: 'b' }, { id: 'c' }]);
assert.deepEqual(m.items.map((x) => x.id), ['a', 'b', 'c']);
assert.equal(m.added, 1);
assert.equal(hasMorePages(20, 5), true);
assert.equal(hasMorePages(20, 0), false, 'старый backend вернул те же строки — «Показать ещё» гасим');
assert.equal(hasMorePages(7, 7), false);

console.log('jobLeadUi tests passed');
