import { canProposeSelection, selectionApproveMessage, selectionBuyerLabel } from './selectionPolicy';

// REP-28: заказчик без исполнителя может предлагать, с исполнителем — нет
console.assert(canProposeSelection({ role: 'customer', readOnly: false, selfManaged: true }) === true, 'self-managed customer proposes');
console.assert(canProposeSelection({ role: 'customer', readOnly: false, selfManaged: false }) === false, 'customer with contractor does not');
console.assert(canProposeSelection({ role: 'contractor', readOnly: false, selfManaged: false }) === true, 'contractor proposes');
console.assert(canProposeSelection({ role: 'contractor', readOnly: true, selfManaged: false }) === false, 'readOnly blocks');
console.assert(selectionBuyerLabel(true) === 'заказчик' && selectionBuyerLabel(false) === 'исполнитель', 'buyer label');

// REP-43: плательщик и превышение лимита видны в подтверждении
const fmt = (v: number) => `${v} ₽`;
const plain = selectionApproveMessage({ title: 'Плитка', selfManaged: false, price: 100, allowance: 200, overAllowance: false, formatMoney: fmt });
console.assert(plain.includes('исполнитель') && !plain.includes('Внимание'), 'buyer, no warning');
const over = selectionApproveMessage({ title: 'Плитка', selfManaged: true, price: 300, allowance: 200, overAllowance: true, formatMoney: fmt });
console.assert(over.includes('заказчик') && over.includes('выше лимита на 100 ₽'), 'over allowance shown');
console.assert(selectionApproveMessage({ selfManaged: false, price: 1, overAllowance: true, formatMoney: fmt }).includes('Внимание'), 'over without limit value');
console.log('selectionPolicy.test OK');
