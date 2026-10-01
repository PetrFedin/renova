import assert from 'node:assert/strict';
import { changeOrderPaymentLine, changeOrderStageLine } from '../constants/labels';

assert.equal(changeOrderPaymentLine('pending', null), null);
assert.equal(changeOrderPaymentLine('rejected', null), null);
assert.equal(changeOrderPaymentLine('approved', null), 'Счёт не выставлен');
assert.equal(changeOrderPaymentLine('approved', 'pending'), 'Счёт выставлен, ждёт оплаты');
assert.equal(changeOrderPaymentLine('approved', 'confirmed'), 'Счёт оплачен');
assert.equal(changeOrderStageLine(null), null);
assert.equal(changeOrderStageLine('  '), null);
assert.equal(changeOrderStageLine('Электрика'), 'Этап: Электрика');
console.log('changeOrderPaymentLine ok');
