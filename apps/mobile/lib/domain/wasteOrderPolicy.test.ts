import { parseWasteForm, wasteActions } from './wasteOrderPolicy';

const must = (c: boolean, m: string) => { if (!c) throw new Error(m); };

// APIB-012: заказчик без исполнителя сам заказывает и закрывает вывоз
must(wasteActions('customer', true, 'draft').request, 'self-managed customer requests');
must(wasteActions('customer', true, 'scheduled').complete, 'self-managed customer completes');
must(wasteActions('customer', true, 'draft').create, 'self-managed customer creates');
must(!wasteActions('customer', false, 'draft').request, 'customer with contractor does not request');
must(!wasteActions('customer', false, 'draft').create, 'customer with contractor does not create');
must(wasteActions('contractor', false, 'draft').request, 'contractor requests');
must(wasteActions('contractor', false, 'scheduled').complete, 'contractor completes');
must(!wasteActions('contractor', false, 'requested').approve, 'contractor never approves');

// EST-015: отмена
for (const st of ['draft', 'requested', 'scheduled']) must(wasteActions('customer', false, st).cancel, `customer cancels ${st}`);
must(wasteActions('contractor', false, 'draft').cancel && wasteActions('contractor', false, 'requested').cancel, 'contractor withdraws');
must(!wasteActions('contractor', false, 'scheduled').cancel, 'contractor cannot cancel scheduled');
for (const st of ['done', 'cancelled']) must(!wasteActions('customer', true, st).cancel, `no cancel from ${st}`);

// EST-016: цена за м³, итог виден до отправки
const ok = parseWasteForm('8', '562,5');
must(ok.ok && ok.total === 4500 && ok.volume_m3 === 8 && ok.price === 562.5, 'total = volume x price');
must(!parseWasteForm('', '100').ok && !parseWasteForm('0', '100').ok, 'volume required');
must(!parseWasteForm('8', 'abc').ok, 'bad price rejected');
const free = parseWasteForm('2', '');
must(free.ok && free.total === 0, 'empty price = 0');
console.log('wasteOrderPolicy.test OK');
