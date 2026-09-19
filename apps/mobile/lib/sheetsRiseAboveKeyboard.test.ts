/**
 * Нижние шторки поднимаются над клавиатурой.
 *
 * Восемь шторок собраны «сырым» `<Modal>` с `justifyContent: 'flex-end'` и
 * над клавиатурой не поднимались. Считано для `CreateStageSheet` на 375:
 *
 *     высота листа ≈ 335 pt, клавиатура iOS ≈ 216 pt
 *     кнопка «Создать этап» лежит на 28…76 pt от низа
 *     → целиком под клавиатурой
 *
 * Поля заполняешь вслепую, кнопку подтверждения не видно.
 *
 * Правильное решение в репозитории есть — `SheetSurface`. Но у этих шторок
 * своя вёрстка и свои размеры, и перевод на общий компонент менял бы вид
 * каждой, а увидеть все восемь я не могу. Поэтому вынесено только поведение:
 * клавиатура и безопасная зона. Оформление осталось собственным.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const mobile = join(import.meta.dirname, '..');
const src = (path: string) => readFileSync(join(mobile, path), 'utf8');

const sheets = [
  'components/renova/CreateStageSheet.tsx',
  'components/renova/CreateWorkSheet.tsx',
  'components/renova/BankStatementImportSheet.tsx',
  'components/renova/chat/ChatTaskSheet.tsx',
  'components/renova/chat/CreateChatSheet.tsx',
];

for (const path of sheets) {
  const body = src(path);

  assert.ok(
    body.includes('<SheetKeyboardLayer>'),
    `${path}: шторка снова не поднимается над клавиатурой`,
  );
  assert.ok(
    body.includes('</SheetKeyboardLayer>'),
    `${path}: слой клавиатуры не закрыт`,
  );
  assert.ok(
    /paddingBottom: sheetBottom/.test(body),
    `${path}: содержимое шторки снова упирается в зону home indicator`,
  );
  // Затемнение фона — одно на все шторки, а не 0.4 у одних и 0.35 у других.
  assert.ok(
    !/rgba\(0,0,0,0\.(4|35)\)/.test(body),
    `${path}: снова своё значение затемнения фона вместо общего`,
  );
}

// --- сам слой -----------------------------------------------------------------

const layer = src('components/renova/SheetKeyboardLayer.tsx');
assert.ok(layer.includes('<KeyboardAvoidingView'), 'слой перестал поднимать шторку');
assert.ok(
  /behavior=\{Platform\.OS === 'ios' \? 'padding' : undefined\}/.test(layer),
  'у слоя нет поведения подъёма для iOS',
);
assert.ok(
  layer.includes("pointerEvents=\"box-none\""),
  'слой перехватывает нажатия — тап по фону перестанет закрывать шторку',
);
assert.ok(
  /Math\.max\(RenovaTheme\.spacing\.lg, inset \+ 8\)/.test(layer),
  'нижний отступ перестал учитывать безопасную зону',
);

// --- эталон не тронут ---------------------------------------------------------
// Шторки, уже стоящие на SheetSurface, менять не требовалось.

const surface = src('components/renova/SheetSurface.tsx');
assert.ok(
  surface.includes('<KeyboardAvoidingView') && surface.includes('keyboardShouldPersistTaps'),
  'SheetSurface лишился своей защиты — на него равняются остальные',
);

console.log('sheetsRiseAboveKeyboard.test OK');
