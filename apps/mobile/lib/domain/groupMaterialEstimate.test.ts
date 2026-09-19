/**
 * Расчёт материалов — это выбор, а не список покупок.
 *
 * Плитка и ламинат ложатся на один и тот же пол, краска и обои — на одни и те
 * же стены. Расчёт отдавал их подряд, и экран показывал
 *
 *     Плитка: 13.2 м²
 *     Ламинат: 12.84 м²
 *
 * — один пол, посчитанный дважды. Человек читал это как список покупок и
 * закладывал в смету оба покрытия.
 */
import assert from 'node:assert/strict';
import {
  alwaysNeededCount,
  choiceSummary,
  groupMaterialEstimate,
  type MaterialItem,
} from './groupMaterialEstimate';

/** Ровно то, что отдаёт бэкенд для комнаты 4×3 при высоте 2.7. */
const ITEMS: MaterialItem[] = [
  { name: 'Плитка', unit: 'м²', qty: 13.2, category: 'tile', surface: 'floor', alternative_group: 'floor_finish', note: 'запас 10%' },
  { name: 'Ламинат', unit: 'м²', qty: 12.84, category: 'flooring', surface: 'floor', alternative_group: 'floor_finish', note: 'запас 7%' },
  { name: 'Краска интерьерная', unit: 'л', qty: 7.2, category: 'paint', surface: 'walls', alternative_group: 'wall_finish' },
  { name: 'Обои', unit: 'рул.', qty: 5, category: 'wallpaper', surface: 'walls', alternative_group: 'wall_finish' },
  { name: 'Плинтус', unit: 'м', qty: 13.76, category: 'flooring', surface: 'trim', alternative_group: null },
  { name: 'Клей для плитки', unit: 'кг', qty: 48, category: 'tile', surface: 'floor', alternative_group: null, requires: 'Плитка' },
  { name: 'Затирка', unit: 'кг', qty: 6, category: 'tile', surface: 'floor', alternative_group: null, requires: 'Плитка' },
];

const grouped = groupMaterialEstimate(ITEMS);

// --- поверхности в понятном порядке -------------------------------------------

assert.deepEqual(
  grouped.map((s) => s.surface),
  ['floor', 'walls', 'trim'],
  'поверхности идут не в том порядке, в каком их читает человек',
);
assert.equal(grouped[0].label, 'Пол');
assert.equal(grouped[1].label, 'Стены');

// --- главное: пол не считается дважды ------------------------------------------

const floor = grouped[0];
assert.equal(floor.choices.length, 2, 'плитка и ламинат перестали быть вариантами одного пола');
assert.deepEqual(
  floor.choices.map((c) => c.name),
  ['Плитка', 'Ламинат'],
);
assert.ok(
  choiceSummary(floor).includes('или'),
  `выбор пола подан как перечисление, а не как выбор: ${choiceSummary(floor)}`,
);

const walls = grouped[1];
assert.equal(walls.choices.length, 2, 'краска и обои перестали быть вариантами одних стен');
assert.ok(choiceSummary(walls).includes('или'));

// --- сопутствующее идёт вместе со своим вариантом -------------------------------
// Клей и затирка нужны под плитку. Под ламинат они не нужны, и показывать их
// рядом с ним значило бы снова завысить смету.

const tile = floor.choices.find((c) => c.name === 'Плитка');
const laminate = floor.choices.find((c) => c.name === 'Ламинат');
assert.ok(tile && laminate);
assert.deepEqual(
  tile!.companions.map((c) => c.name).sort(),
  ['Затирка', 'Клей для плитки'],
  'клей и затирка оторвались от плитки',
);
assert.equal(
  laminate!.companions.length,
  0,
  'под ламинат предлагается плиточный клей',
);

// --- то, что нужно при любом выборе --------------------------------------------

assert.deepEqual(
  grouped[2].always.map((i) => i.name),
  ['Плинтус'],
  'плинтус перестал быть обязательным',
);
assert.equal(
  alwaysNeededCount(grouped),
  1,
  'изменился состав того, что нужно независимо от отделки',
);
// Сопутствующее не должно попасть в «нужно всегда»: оно зависит от выбора.
for (const surface of grouped) {
  for (const item of surface.always) {
    assert.ok(!item.requires, `«${item.name}» попал в обязательное, хотя зависит от выбора`);
  }
}

// --- страховка от «всё в один список» ------------------------------------------
// Если у позиций нет разметки поверхностей — старый формат ответа — ничего не
// должно потеряться.

const legacy = groupMaterialEstimate([
  { name: 'Плитка', unit: 'м²', qty: 13.2, category: 'tile' },
  { name: 'Плинтус', unit: 'м', qty: 13.76, category: 'flooring' },
]);
assert.equal(legacy.length, 1);
assert.equal(legacy[0].surface, 'other');
assert.equal(legacy[0].always.length, 2, 'позиции без разметки потерялись');

// --- один вариант — не выбор ---------------------------------------------------

const single = groupMaterialEstimate([
  { name: 'Плитка', unit: 'м²', qty: 13.2, category: 'tile', surface: 'floor', alternative_group: 'floor_finish' },
]);
assert.equal(
  choiceSummary(single[0]),
  'Плитка · 13.2 м²',
  'единственный вариант подан как выбор из одного',
);

console.log('groupMaterialEstimate.test OK');
