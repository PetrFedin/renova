import { findDeliveredPurchaseForPick } from './findPurchaseForPick';

const purchases = [
  {
    id: 'pu1',
    status: 'delivered',
    items: [{ id: 'i1', material_pick_id: 'p1', name: 'X', qty: 1, unit: 'шт', unit_price: 100, total: 100 }],
  },
  {
    id: 'pu2',
    status: 'ordered',
    items: [{ id: 'i2', material_pick_id: 'p2', name: 'Y', qty: 1, unit: 'шт', unit_price: 50, total: 50 }],
  },
] as any[];

const hit = findDeliveredPurchaseForPick(purchases, 'p1');
if (!hit || hit.id !== 'pu1') throw new Error('expected delivered purchase');

const miss = findDeliveredPurchaseForPick(purchases, 'p2');
if (miss) throw new Error('ordered purchase must not match');

console.log('findPurchaseForPick.test OK');
