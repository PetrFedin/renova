/**
 * Клавиатура не закрывает то, чем пользуются.
 *
 * Во всём приложении 50 файлов с `TextInput`, а `KeyboardAvoidingView` был
 * определён в четырёх. То есть 45 из 50 экранов и шторок с полями ввода не
 * поднимались над клавиатурой.
 *
 * Хуже всего в чате — самом посещаемом экране. Поле ввода прибито к низу,
 * защиты не было ни в компоненте, ни в маршруте, ни в корневом layout:
 * человек печатал вслепую, а кнопка «Отправить» оказывалась под клавиатурой.
 *
 * Вторая беда — `keyboardShouldPersistTaps`. Без него первый тап по кнопке в
 * прокручиваемом контейнере с полем только прячет клавиатуру, и кнопка
 * «не работает с первого раза». Это ровно та жалоба, которую слышно от
 * пользователей.
 *
 * Правильное решение в репозитории уже было: `SheetSurface` делает всё как
 * надо. Беда не в незнании, а в том, что его не использовали.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const mobile = join(import.meta.dirname, '..');
const src = (path: string) => readFileSync(join(mobile, path), 'utf8');

// --- чат ---------------------------------------------------------------------

const chat = src('components/renova/chat/ChatThreadView.tsx');

assert.ok(
  chat.includes('<KeyboardAvoidingView'),
  'чат снова не поднимается над клавиатурой — печать вслепую',
);
assert.ok(
  /behavior=\{Platform\.OS === 'ios' \? 'padding' : undefined\}/.test(chat),
  'у чата нет поведения подъёма для iOS',
);
assert.ok(
  chat.includes('keyboardShouldPersistTaps="handled"'),
  'первый тап по кнопке в ленте чата снова уходит на скрытие клавиатуры',
);
assert.ok(
  /paddingBottom: bottomInset/.test(chat) && chat.includes('useBottomInset'),
  'панель ввода чата снова стоит в зоне home indicator',
);
// Панель не должна одновременно задавать общий padding и нижний inset —
// иначе отступ снизу сложится дважды.
assert.ok(
  !/composer: \{ padding: \d+/.test(chat),
  'у панели ввода снова общий padding — нижний отступ сложится с inset',
);

// --- экраны, где поле и кнопка в одном скролле --------------------------------

const withBothInputAndButton = [
  'app/approvals.tsx',
  'app/(contractor)/_screens/articles-admin.tsx',
  'app/onboarding/_screens/role.tsx',
  'app/_stack/checklist-templates.tsx',
  'app/material/[id].tsx',
  'app/contractor-wizard/[leadId].tsx',
  'components/screens/RoomDetailScreen.tsx',
  'components/screens/OsSelectionsScreen.tsx',
  'components/screens/StageDetailScreen.tsx',
  'components/screens/OsRoomsScreen.tsx',
  'components/screens/estimate/ContractorEstimateView.tsx',
  'components/screens/control/TechnicalSupervisionControlView.tsx',
  'components/screens/profile/ContractorProfileScreen.tsx',
];

for (const path of withBothInputAndButton) {
  assert.ok(
    src(path).includes('keyboardShouldPersistTaps'),
    `${path}: кнопка снова не срабатывает с первого раза при открытой клавиатуре`,
  );
}

// --- эталон остаётся эталоном -------------------------------------------------

const surface = src('components/renova/SheetSurface.tsx');
for (const marker of [
  '<KeyboardAvoidingView',
  'keyboardShouldPersistTaps="handled"',
  'keyboardDismissMode',
]) {
  assert.ok(
    surface.includes(marker),
    `SheetSurface лишился «${marker}» — а на него равняются остальные шторки`,
  );
}

console.log('keyboardDoesNotBlock.test OK');
