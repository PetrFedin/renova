/**
 * #315: операции контекста публикуют состояние после нескольких await.
 * Между началом и публикацией человек мог выйти и войти под другим аккаунтом —
 * тогда ответ первой сессии перезаписал бы список объектов нового пользователя
 * или выбрал бы чужой объект активным.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');
const context = readFileSync(join(mobile, 'lib', 'context', 'RenovaContext.tsx'), 'utf8');

function body(name: string): string {
  const start = context.indexOf(`const ${name} = useCallback`);
  if (start === -1) throw new Error(`не найдена операция ${name}`);
  const rest = context.slice(start);
  const end = rest.indexOf('\n  const ', 1);
  return end === -1 ? rest : rest.slice(0, end);
}

// Метка берётся один раз в начале операции, а не перед каждой проверкой:
// иначе сверялись бы две одинаковые «текущие» метки.
for (const name of ['refreshProjects', 'loadProject']) {
  const src = body(name);
  const taken = src.indexOf('const stamp = sessionStampRef.current');
  if (taken === -1) throw new Error(`${name}: метка сессии не берётся`);
  if ((src.match(/const stamp = sessionStampRef\.current/g) || []).length !== 1) {
    throw new Error(`${name}: метка берётся несколько раз`);
  }
  if (!src.includes('dropStaleWrite(stamp,')) throw new Error(`${name}: рубеж не проверяется`);

  // Публикация обязана идти после проверки, а не до.
  const publish = Math.min(
    ...[src.indexOf('setProjects('), src.indexOf('setActiveProject(')].filter((i) => i !== -1),
  );
  const firstCheck = src.indexOf('dropStaleWrite(stamp,');
  if (!(firstCheck < publish)) throw new Error(`${name}: публикация раньше проверки рубежа`);
}

const load = body('loadProject');
// Назначение на объект меняет права — оно тоже под рубежом.
const assign = load.indexOf('api.assignProject');
const beforeAssign = load.lastIndexOf('dropStaleWrite(stamp,', assign);
if (beforeAssign === -1) throw new Error('назначение на объект идёт без проверки рубежа');
// Хранилище и шина — после последней проверки.
for (const sink of ['AsyncStorage.setItem(KEYS.projectId', 'notifyProjectDataChanged()']) {
  const at = load.indexOf(sink);
  if (at === -1) throw new Error(`в loadProject пропало ${sink}`);
  if (!(load.lastIndexOf('dropStaleWrite(stamp,', at) !== -1)) {
    throw new Error(`${sink} идёт без проверки рубежа`);
  }
}

// Поколение обязано меняться при каждой смене сессии, включая выход.
const changes = (context.match(/beginSession\(/g) || []).length;
if (changes < 6) throw new Error(`точек смены поколения ${changes}, ожидалось не меньше шести`);
if (!/beginSession\(null\);\s*\n\s*setUser\(null\)/.test(context)) {
  throw new Error('выход не меняет поколение сессии');
}
const logins = (context.match(/beginSession\(u\.id\);/g) || []).length;
if (logins < 5) throw new Error(`входов с новым поколением ${logins}, ожидалось не меньше пяти`);

// Поколение меняется до публикации пользователя, иначе окно остаётся открытым.
for (const m of context.matchAll(/beginSession\(u\.id\);([\s\S]{0,80})/g)) {
  if (!m[1].includes('setUser(u)')) throw new Error('смена поколения оторвана от публикации пользователя');
}

console.log('sessionFenceWired.test OK');
