import assert from 'node:assert/strict';
import { changeOrderPaymentLine } from '../constants/labels';

assert.equal(changeOrderPaymentLine('pending', null), null);
assert.equal(changeOrderPaymentLine('rejected', null), null);
assert.equal(changeOrderPaymentLine('approved', null), 'Счёт не выставлен');
assert.equal(changeOrderPaymentLine('approved', 'pending'), 'Счёт выставлен, ждёт оплаты');
assert.equal(changeOrderPaymentLine('approved', 'confirmed'), 'Счёт оплачен');
console.log('changeOrderPaymentLine ok');
