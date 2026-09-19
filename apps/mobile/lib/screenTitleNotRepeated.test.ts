/**
 * Заголовок экрана не повторяется под самим собой.
 *
 * Экран статьи выводил `article.title` дважды: в шапке — обрезанным по одной
 * строке в 16pt, и тут же под ней полностью в 22pt. Два разных кегля одного и
 * того же текста, один над другим.
 *
 * Панель администратора писала «Панель администратора» в шапке и «Панель»
 * строкой ниже.
 *
 * Отдельно стоит сказать, чего здесь НЕ проверяется. Аудит предлагал сделать
 * заголовок шапки крупным — 22/bold вместо 16/600, «как h1 по канону». Это
 * было бы ошибкой: заголовок в шапке центрирован, живёт в строке 44pt между
 * кнопкой «назад» и панелью справа и обрезается по одной строке. 16/600 по
 * центру — это и есть нормальный навигационный заголовок. Крупный заголовок
 * нужен в содержимом, а не в панели, и добавлять его туда, где шапка уже
 * называет экран, значит заводить то самое дублирование.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const mobile = join(import.meta.dirname, '..');

function* files(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* files(full);
    else if (entry.endsWith('.tsx')) yield full;
  }
}

const offenders: string[] = [];

for (const base of ['app', 'components']) {
  for (const file of files(join(mobile, base))) {
    const src = readFileSync(file, 'utf8');
    const header = src.match(/<BackHeader[^>]*title=\{([^}]+)\}/);
    if (!header) continue;
    const expression = header[1].trim();
    // Тот же источник текста, выведенный ещё раз как заголовок содержимого.
    const repeated = new RegExp(
      `(styles|s|st)\\.title\\}>\\{${expression.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\}`,
    );
    if (repeated.test(src)) offenders.push(relative(mobile, file));
  }
}

assert.deepEqual(
  offenders,
  [],
  `заголовок выводится дважды: ${offenders.join(', ')}`,
);

// Точечно — то, что было исправлено.
const article = readFileSync(join(mobile, 'app/article/[slug].tsx'), 'utf8');
assert.ok(
  !article.includes('<BackHeader title={article.title}'),
  'шапка статьи снова дублирует её заголовок',
);
assert.ok(
  article.includes('<Text style={styles.title}>{article.title}</Text>'),
  'полный заголовок статьи исчез — его нельзя прочитать целиком',
);

const admin = readFileSync(
  join(mobile, 'app/(contractor)/_screens/admin-dashboard.tsx'),
  'utf8',
);
assert.ok(
  !admin.includes('<Text style={st.title}>Панель</Text>'),
  '«Панель» снова стоит под «Панелью администратора»',
);

console.log('screenTitleNotRepeated.test OK');
