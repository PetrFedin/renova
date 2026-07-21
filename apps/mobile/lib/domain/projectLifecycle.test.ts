import { canManageProjectLifecycle, formatLifecycleActionError } from './projectLifecycle';
import { ApiError } from '../api/client';

const base = {
  id: 'p1',
  name: 'Test',
  address: null,
  renovation_type: 'cosmetic',
  budget_planned: 0,
  budget_spent: 0,
  progress_percent: 0,
  rooms_count: 1,
  stages_count: 0,
};

if (!canManageProjectLifecycle({ ...base, access_mode: 'owner' }, 'customer')) {
  throw new Error('owner customer should manage');
}
if (canManageProjectLifecycle({ ...base, access_mode: 'guest' }, 'customer')) {
  throw new Error('guest project should not manage');
}
if (canManageProjectLifecycle({ ...base, access_mode: 'owner' }, 'customer', true)) {
  throw new Error('readOnly customer should not manage');
}
if (canManageProjectLifecycle({ ...base }, 'contractor')) {
  throw new Error('contractor should not manage');
}

const apiErr = new ApiError(403, 'Только владелец объекта может выполнить это действие');
if (formatLifecycleActionError(apiErr) !== apiErr.message) {
  throw new Error('formatLifecycleActionError ApiError failed');
}

console.log('projectLifecycle.test OK');
