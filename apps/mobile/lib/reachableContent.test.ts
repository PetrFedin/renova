/**
 * До содержимого можно добраться, а до кнопок — дотянуться.
 *
 * Экран скана чека не прокручивался вовсе: камера занимала всё оставшееся
 * место (`flex: 1`), а форма расхода под ней оказывалась за краем экрана. На
 * iPhone SE до неё нельзя было добраться никак — при том что подзаголовок
 * экрана обещает «расход без чека ниже».
 *
 * Окно отклонения этапа стоит по центру, а поле причины многострочное. На
 * iPhone SE клавиатура (~290 pt) закрывала нижнюю часть окна вместе с
 * кнопками: написать причину было можно, подтвердить — нет.
 *
 * Там же две вещи не по канону: «Отмена» была голым текстом в `Pressable` —
 * без отклика и с зоной в размер букв, а «Отклонить» рисовалась главной синей
 * кнопкой, хотя канон прямо относит отклонение к danger.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const mobile = join(import.meta.dirname, '..');
const src = (path: string) => readFileSync(join(mobile, path), 'utf8');

// --- скан чека ----------------------------------------------------------------

const scan = src('app/scan-receipt.tsx');

assert.ok(scan.includes('<ScrollView'), 'экран скана чека снова не прокручивается');
assert.ok(
  scan.includes('keyboardShouldPersistTaps="handled"'),
  'кнопки формы расхода снова не срабатывают с первого раза',
);
// Внутри прокрутки flex-ребёнок не растягивается — камере нужна высота.
assert.ok(
  !/flex: 1, minHeight: 280/.test(scan),
  'камера снова занимает всё место — форма под ней недостижима',
);
const cameraHeight = scan.match(/cameraBox: \{ height: (\d+) \}/);
assert.ok(cameraHeight, 'у кадра камеры нет заданной высоты');
assert.ok(
  Number(cameraHeight![1]) >= 280,
  `кадр камеры уменьшился до ${cameraHeight![1]} — раньше гарантировалось 280`,
);

// --- окно отклонения ----------------------------------------------------------

const reject = src('components/renova/RejectStageModal.tsx');

assert.ok(
  reject.includes('<KeyboardAvoidingView'),
  'окно отклонения снова не поднимается над клавиатурой',
);
assert.ok(
  /title="Отклонить"[\s\S]{0,80}variant="danger"/.test(reject),
  'отклонение снова рисуется главной кнопкой вместо danger',
);
assert.ok(
  /<PrimaryButton title="Отмена"/.test(reject),
  '«Отмена» снова голый текст без зоны нажатия',
);
assert.ok(
  !reject.includes('<Pressable'),
  'в окне отклонения снова самодельная кнопка вместо PrimaryButton',
);

console.log('reachableContent.test OK');
