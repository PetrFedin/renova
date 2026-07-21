/** P0: workActions — done/paid только заказчик */
import {
  workActions,
  isTransitionAllowedForRole,
} from './workLifecycle';

const contractorReview = workActions('review', 'contractor');
if (contractorReview.some((a) => a.next === 'done')) {
  throw new Error('contractor must not get done from review');
}
if (!contractorReview.some((a) => a.next === 'in_progress')) {
  throw new Error('contractor can return to in_progress');
}

const customerReview = workActions('review', 'customer');
if (!customerReview.some((a) => a.next === 'done' && a.label.includes('Принять'))) {
  throw new Error('customer accepts from review');
}

if (isTransitionAllowedForRole('review', 'done', 'contractor')) {
  throw new Error('contractor done forbidden');
}
if (!isTransitionAllowedForRole('review', 'done', 'customer')) {
  throw new Error('customer done allowed');
}
if (!isTransitionAllowedForRole('in_progress', 'review', 'contractor')) {
  throw new Error('contractor submits to review');
}
if (isTransitionAllowedForRole('in_progress', 'review', 'customer')) {
  throw new Error('customer should not submit to review');
}

console.log('workLifecycle.p0.test OK');
