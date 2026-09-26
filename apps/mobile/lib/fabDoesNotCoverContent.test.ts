/**
 * Плавающая кнопка не закрывает содержимое.
 *
 * Кнопка быстрых действий смонтирована один раз в `OsRoleTabsNavigator`, то
 * есть лежит поверх содержимого всех вкладок обеих ролей. Экраны обязаны
 * оставить под неё свободное место — и не оставляли.
 *
 * Измерено на запущенном приложении, 375×812:
 *
 *     кнопка:  52×52, отступ снизу 88  → занимает 140 точек снизу
 *     главная: paddingBottom 24
 *     под центром кнопки: <button> «Сроки →»
 *
 * То есть нажатие в правый нижний угол открывало меню быстрых действий
 * вместо раздела «Сроки», а сама строка перехода была наполовину закрыта.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const mobile = join(import.meta.dirname, '..');
const src = (path: string) => readFileSync(join(mobile, path), 'utf8');

// Числа читаются из исходника, а не импортируются: `constants/fab.ts` тянет
// react-native, а этот набор тестов выполняется обычным node без RN.
const fabConstants = readFileSync(join(import.meta.dirname, '../constants/fab.ts'), 'utf8');

function numberOf(name: string): number {
  const found = fabConstants.match(new RegExp(`export const ${name} = ([^;]+);`));
  assert.ok(found, `константа ${name} исчезла из constants/fab.ts`);
  const literal = found![1];
  // FAB_BOTTOM зависит от платформы — берём худший случай, наименьший отступ.
  const numbers = literal.match(/\d+/g)?.map(Number) ?? [];
  assert.ok(numbers.length > 0, `у ${name} нет числового значения`);
  return Math.min(...numbers);
}

const FAB_SIZE = numberOf('FAB_SIZE');
const FAB_BOTTOM = numberOf('FAB_BOTTOM');
// Запас собирается из двух других, поэтому считаем так же.
const FAB_SAFE_BOTTOM = FAB_BOTTOM + FAB_SIZE + 12;
assert.ok(
  /FAB_SAFE_BOTTOM = FAB_BOTTOM \+ FAB_SIZE \+ 12/.test(fabConstants),
  'формула запаса изменилась — проверьте, что она всё ещё покрывает кнопку',
);

// --- арифметика запаса --------------------------------------------------------

assert.ok(
  FAB_SAFE_BOTTOM > FAB_BOTTOM + FAB_SIZE,
  `запас ${FAB_SAFE_BOTTOM} не покрывает кнопку, занимающую ${FAB_BOTTOM + FAB_SIZE}`,
);
assert.ok(
  FAB_SAFE_BOTTOM - (FAB_BOTTOM + FAB_SIZE) >= 8,
  'содержимое упирается прямо в кнопку — нужен зазор',
);

// --- геометрия задана в одном месте -------------------------------------------
// Иначе кнопку подвинут, а запас останется старым.

const fabComponent = src('components/renova/os/OsQuickFab.tsx');
assert.ok(
  fabComponent.includes("from '@/constants/fab'"),
  'кнопка снова задаёт свою геометрию сама — запас экранов рассинхронизируется',
);
assert.ok(
  !/bottom: Platform\.OS === 'web' \? 88 : 76/.test(fabComponent),
  'в компоненте снова зашиты числа отступа',
);

// --- экраны вкладок оставляют место -------------------------------------------

const layout = src('constants/screenLayout.ts');
assert.ok(
  layout.includes('tabContentStyle') && layout.includes('paddingBottom: FAB_SAFE_BOTTOM'),
  'у экранов вкладок нет отдельного стиля с запасом под кнопку',
);
// ...и у экранов стека запас не появился: там кнопки нет, пустота была бы лишней.
assert.ok(
  /contentStyle: \{\s*padding: RenovaTheme\.spacing\.lg,\s*paddingBottom: 32,/.test(layout),
  'обычным экранам добавили ненужные полторы сотни точек пустоты',
);

const tabScreens = [
  'components/screens/OsMaterialsScreen.tsx',
  'components/screens/OsPlanTabScreen.tsx',
  'components/screens/OsProjectProfileScreen.tsx',
  'components/screens/OsRoomsScreen.tsx',
  'components/screens/OsSelectionsScreen.tsx',
  'components/screens/OsWorksScreen.tsx',
  'components/screens/profile/profileScreenStyles.ts',
];
for (const path of tabScreens) {
  assert.ok(
    src(path).includes('tabContentStyle'),
    `${path}: экран вкладки снова без запаса под плавающую кнопку`,
  );
}

for (const path of [
  'components/screens/OsHomeScreen.tsx',
  'components/screens/OsBudgetScreen.tsx',
  'components/renova/chat/ChatListView.tsx',
]) {
  // Именно `paddingBottom: FAB_SAFE_BOTTOM`, а не просто упоминание константы:
  // строка импорта содержит её имя и сделала бы проверку пустой.
  assert.ok(
    /paddingBottom: FAB_SAFE_BOTTOM/.test(src(path)),
    `${path}: экран вкладки со своим стилем снова без запаса под кнопку`,
  );
}

// --- ни один экран вкладки не остался с прежним мелким запасом ----------------

function* files(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* files(full);
    else if (/\.tsx?$/.test(entry)) yield full;
  }
}

const withFab = [...files(join(mobile, 'components/screens'))]
  .filter((file) => {
    const body = readFileSync(file, 'utf8');
    return body.includes('tabContentStyle') || body.includes('FAB_SAFE_BOTTOM');
  })
  .map((file) => relative(mobile, file));

assert.ok(
  withFab.length >= 8,
  `запас проставлен только на ${withFab.length} экранах — вкладок больше`,
);

console.log('fabDoesNotCoverContent.test OK');
