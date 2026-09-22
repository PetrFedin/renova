/** Аналог материала можно предложить с экрана, а не только через API. */
import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');
const src = (rel: string) => readFileSync(join(mobile, rel), 'utf8');

const apiSrc = src('lib/api/materials.ts');
const list = src('components/renova/MaterialPickList.tsx');

if (!apiSrc.includes('addMaterialAnalog')) throw new Error('нет клиентской ручки аналога');
const block = apiSrc.split('addMaterialAnalog')[1].slice(0, 800);
if (!block.includes('/analog')) throw new Error('аналог бьёт не в ту ручку');
if (!block.includes('client_request_id')) throw new Error('аналог без ключа повтора — задвоится при ретрае');
if (!block.includes('enqueue(')) throw new Error('аналог не уходит в офлайн-очередь, как создание подбора');

if (!list.includes("'Предложить аналог'")) throw new Error('нет кнопки предложения аналога');
if (!list.includes('canOfferAnalog(p)')) throw new Error('аналог предлагается без проверки применимости');
if (!list.includes('analogParentLabel(p, visible)')) {
  throw new Error('строка аналога не говорит, чему он аналог');
}
if (list.includes("'· аналог'")) throw new Error('осталась подпись без имени исходного материала');
if (!list.includes('analogDeltaLabel(analogDelta(')) throw new Error('выгода замены не показана');
if (!list.includes('notifyOfflineQueued(\'Аналог материала\')')) throw new Error('офлайн-сохранение молчит');
if (!list.includes('accessibilityLabel="Название аналога"')) throw new Error('поля формы не называют себя');

console.log('materialAnalogScreen.test OK');
