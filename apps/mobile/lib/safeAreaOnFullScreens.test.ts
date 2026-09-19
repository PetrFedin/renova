/**
 * Полноэкранные маршруты сами учитывают вырез.
 *
 * `app/_layout.tsx` задаёт `headerShown: false` для всего рута. Экраны,
 * которые не используют `BackHeader` (он зовёт `useTopInset` внутри), обязаны
 * добавить верхний отступ сами — иначе их содержимое рисуется с y = 16, а
 * полоса 0…47 закрыта статус-баром и вырезом.
 *
 * Последствие конкретное: на iPhone 16 и Pro Max кнопка «‹ Назад» занимала
 * y 16…36 и была закрыта **полностью** — с экрана нельзя было уйти иначе, чем
 * системным жестом. На iPhone SE (статус-бар 20) она была задета частично.
 *
 * Затронуты были четыре реальных маршрута: /quality-control (вызывается из
 * lib/qcNav.ts), /manager-dashboard (из lib/pushLinks.ts), гостевой портал и
 * черновик.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const mobile = join(import.meta.dirname, '..');
const src = (path: string) => readFileSync(join(mobile, path), 'utf8');

const fullScreens = [
  'components/screens/QualityControlScreen.tsx',
  'components/screens/ManagerDashboardScreen.tsx',
  'components/screens/PortalScreen.tsx',
  'components/screens/ScratchpadScreen.tsx',
];

for (const path of fullScreens) {
  const body = src(path);

  // Экран не под BackHeader — значит безопасную зону берёт сам.
  assert.ok(
    !body.includes('<BackHeader'),
    `${path}: экран перешёл на BackHeader — проверку здесь надо пересмотреть, а не удалять`,
  );
  assert.ok(
    body.includes('const topInset = useTopInset();'),
    `${path}: полноэкранный маршрут снова не учитывает вырез`,
  );
  assert.ok(
    /paddingTop: topInset \+ \d+/.test(body),
    `${path}: верхний отступ не выводится из безопасной зоны`,
  );
}

// Сам хук не должен молча начать возвращать ноль на iOS.
const hook = src('lib/useTopInset.ts');
assert.ok(
  /Math\.max\(insets\.top, fallback\)/.test(hook),
  'useTopInset перестал брать максимум из фактического inset и запасного значения',
);

console.log('safeAreaOnFullScreens.test OK');
