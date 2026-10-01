/** REP-02: заказчик, который исполняет работу сам, получает исполнительские шаги */
import {
  customerCanExecuteWork,
  isTransitionAllowedForRole,
  waitingForText,
  workActions,
} from './workLifecycle';

const next = (status: Parameters<typeof workActions>[0], role: 'customer' | 'contractor', exec?: boolean) =>
  workActions(status, role, { customerCanExecute: exec }).map((a) => a.next).join(',');

// по умолчанию заказчик не начинает и не сдаёт работу
console.assert(!next('approved', 'customer').includes('in_progress'), 'customer cannot start by default');
console.assert(!next('in_progress', 'customer').includes('review'), 'customer cannot submit by default');

// самоуправляемый проект / назначенная на него работа
console.assert(next('approved', 'customer', true).includes('in_progress'), 'executing customer starts work');
console.assert(next('in_progress', 'customer', true).includes('review'), 'executing customer submits for review');
console.assert(next('review', 'customer', true).includes('done'), 'executing customer still accepts');

// флаг не даёт лишнего
console.assert(isTransitionAllowedForRole('in_progress', 'done', 'customer', { customerCanExecute: true }) === false, 'no skipping review');
console.assert(isTransitionAllowedForRole('approved', 'review', 'customer', { customerCanExecute: true }) === false, 'no skipping start');
console.assert(next('approved', 'contractor', true) === next('approved', 'contractor'), 'flag is customer-only');

// «ход за исполнителя» не показывается тому, кто исполняет сам
console.assert(waitingForText('approved', 'customer') !== null, 'customer waits for contractor by default');
console.assert(waitingForText('approved', 'customer', { customerCanExecute: true }) === null, 'executing customer does not wait');

// зеркало backend customer_can_execute_work_order
console.assert(customerCanExecuteWork({ projectHasContractor: false, assigneeId: null, userId: 'c' }) === true, 'self-managed, unassigned');
console.assert(customerCanExecuteWork({ projectHasContractor: true, assigneeId: null, userId: 'c' }) === false, 'hybrid, unassigned stays with contractor');
console.assert(customerCanExecuteWork({ projectHasContractor: true, assigneeId: 'c', userId: 'c' }) === true, 'assigned to the customer');
console.assert(customerCanExecuteWork({ projectHasContractor: true, assigneeId: 'x', userId: 'c' }) === false, 'assigned to someone else');
console.assert(customerCanExecuteWork({ projectHasContractor: false, assigneeId: 'x', userId: 'c' }) === false, 'self-managed but assigned elsewhere');
console.log('workLifecycle.selfManaged.test OK');
