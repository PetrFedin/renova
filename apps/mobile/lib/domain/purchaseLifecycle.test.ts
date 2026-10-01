import {
  PURCHASE_NEXT_STATUS,
  purchaseCancelAffectsFact,
  purchaseCancelLabel,
  purchaseCancelStatus,
  purchaseRoleMayCancel,
  purchaseRoleMayMove,
} from './purchaseLifecycle';

// REP-25: ошибочную закупку можно отменить, пока она не доставлена
for (const st of ['draft', 'approved', 'ordered', 'paid', 'delivered']) {
  console.assert(purchaseCancelStatus(st) === 'cancelled', `cancel from ${st}`);
}
console.assert(purchaseCancelStatus('cancelled') === null, 'no cancel from cancelled');
console.assert(purchaseCancelStatus('returned') === null, 'no cancel from returned');

console.assert(purchaseCancelLabel('draft') === 'Отменить закупку', 'draft label');
console.assert(purchaseCancelLabel('delivered') === 'Убрать из факта', 'delivered label');
console.assert(purchaseCancelAffectsFact('paid') && !purchaseCancelAffectsFact('ordered'), 'fact effect');

// роли зеркалят backend
console.assert(purchaseRoleMayCancel('customer', 'delivered') === true, 'customer cancels delivered');
console.assert(purchaseRoleMayCancel('contractor', 'draft') === true, 'contractor cancels draft');
console.assert(purchaseRoleMayCancel('contractor', 'ordered') === true, 'contractor cancels ordered');
console.assert(purchaseRoleMayCancel('contractor', 'paid') === false, 'contractor cannot undo money');
console.assert(purchaseRoleMayCancel('contractor', 'delivered') === false, 'contractor cannot undo delivered');

// REP-09: оплату отмечает только заказчик
console.assert(purchaseRoleMayMove('contractor', PURCHASE_NEXT_STATUS.ordered as string) === false, 'contractor cannot mark paid');
console.assert(purchaseRoleMayMove('customer', 'paid') === true, 'customer marks paid');
console.log('purchaseLifecycle.test OK');
