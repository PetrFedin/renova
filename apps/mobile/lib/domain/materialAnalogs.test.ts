import {
  analogDelta,
  analogDeltaLabel,
  analogParentLabel,
  buildAnalogDraft,
  canOfferAnalog,
  parsePriceInput,
} from './materialAnalogs';
import type { MaterialPick } from '@/lib/api/types/budget';

function pick(input: Partial<MaterialPick> & Pick<MaterialPick, 'id' | 'name'>): MaterialPick {
  return {
    qty: 10,
    unit: 'м2',
    price: 500,
    status: 'draft',
    total: 5000,
    room_id: 'room-1',
    work_type: 'tiling',
    ...input,
  } as MaterialPick;
}

const original = pick({ id: 'p1', name: 'Плитка Керама' });

if (parsePriceInput('1 250') !== 1250) throw new Error('пробелы в цене');
if (parsePriceInput('1250,50') !== 1250.5) throw new Error('запятая в цене');
if (parsePriceInput('') !== null) throw new Error('пустая цена');
if (parsePriceInput('дешевле') !== null) throw new Error('буквы в цене');

const ok = buildAnalogDraft(original, { name: '  Плитка   Cersanit ', price: '420' });
if (!ok.ok) throw new Error('черновик должен собираться');
if (ok.draft.name !== 'Плитка Cersanit') throw new Error('пробелы не схлопнуты');
if (ok.draft.qty !== 10 || ok.draft.unit !== 'м2') throw new Error('объём и единица не унаследованы');
if (ok.draft.room_id !== 'room-1' || ok.draft.work_type !== 'tiling') throw new Error('комната и вид работ не унаследованы');
if (ok.draft.analog_of_id !== 'p1') throw new Error('нет ссылки на исходный материал');

const noName = buildAnalogDraft(original, { name: '   ', price: '420' });
if (noName.ok) throw new Error('аналог без названия');
const badPrice = buildAnalogDraft(original, { name: 'Замена', price: 'дёшево' });
if (badPrice.ok) throw new Error('аналог с нечисловой ценой');

if (analogDelta(original, 420) !== -800) throw new Error(`выгода: ${analogDelta(original, 420)}`);
if (analogDelta(original, 560) !== 600) throw new Error('переплата');
if (analogDelta(original, 500) !== 0) throw new Error('равная цена');
if (!analogDeltaLabel(-800).startsWith('Дешевле на')) throw new Error('подпись выгоды');
if (!analogDeltaLabel(600).startsWith('Дороже на')) throw new Error('подпись переплаты');
if (analogDeltaLabel(0) !== 'Столько же, сколько исходный материал') throw new Error('подпись равенства');

const analog = pick({ id: 'p2', name: 'Плитка Cersanit', analog_of_id: 'p1' });
if (analogParentLabel(analog, [original, analog]) !== 'аналог к «Плитка Керама»') {
  throw new Error('подпись аналога без исходного названия');
}
if (analogParentLabel(analog, [analog]) !== 'аналог') throw new Error('исходный не найден — подпись обязана уцелеть');
if (analogParentLabel(original, [original]) !== '') throw new Error('исходный материал — не аналог');

if (!canOfferAnalog(original)) throw new Error('исходному материалу можно предложить аналог');
if (canOfferAnalog(analog)) throw new Error('аналог аналога не предлагаем');
if (canOfferAnalog(pick({ id: 'p3', name: 'Куплено', status: 'purchased' }))) {
  throw new Error('купленному материалу аналог уже не нужен');
}

console.log('materialAnalogs.test OK');
