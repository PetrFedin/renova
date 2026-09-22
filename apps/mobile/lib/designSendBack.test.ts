/** Заказчик может вернуть дизайн на доработку, а не только согласовать. */
import { readFileSync } from 'fs';
import { join } from 'path';

const mobile = join(__dirname, '..');
const src = (rel: string) => readFileSync(join(mobile, rel), 'utf8');

const apiSrc = src('lib/api/design.ts');
const list = src('components/renova/DesignPackageList.tsx');
const modal = src('components/renova/DesignRejectModal.tsx');

if (!apiSrc.includes('rejectDesignPackage')) throw new Error('нет клиентского возврата дизайна');
const block = apiSrc.split('rejectDesignPackage')[1].slice(0, 700);
if (!block.includes('/reject')) throw new Error('возврат бьёт не в ту ручку');
if (!block.includes('reason')) throw new Error('причина не уходит на сервер');
if (!block.includes('enqueue(')) throw new Error('возврат не уходит в офлайн-очередь, как согласование');

if (!list.includes('title="На доработку"')) throw new Error('нет кнопки возврата');
if (!list.includes("role === 'customer' && d.status === 'pending'")) {
  throw new Error('возврат предложен не тому, кто согласует, или не в том статусе');
}
if (list.includes('reject API в mobile пока нет')) {
  throw new Error('устаревшая отметка про отсутствие возврата осталась в коде');
}
if (!list.includes('<DesignRejectModal')) throw new Error('форма причины не подключена');

if (!modal.includes('Причина придёт автору пакета')) throw new Error('не сказано, куда уходит причина');
if (!modal.includes('minHeight: RenovaTheme.minTouch')) throw new Error('подсказки причин меньше порога касания');
if (!modal.includes("accessibilityLabel=\"Причина доработки дизайна\"")) {
  throw new Error('поле причины не называет себя');
}
if (!modal.includes("onConfirm(reason.trim() || 'Требуется доработка')")) {
  throw new Error('пустая причина не заменяется понятной по умолчанию');
}

console.log('designSendBack.test OK');
