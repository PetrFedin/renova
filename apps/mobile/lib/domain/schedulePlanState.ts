import { normalizeAppError, type AppError } from '@/lib/async/appError';
import type { WorkSchedule, WorkScheduleStatus } from '@/lib/api/workSchedule';

export type SchedulePlan = WorkSchedule;

export type SchedulePlanState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'not_created' }
  | { status: 'draft'; plan: SchedulePlan }
  | { status: 'submitted'; plan: SchedulePlan }
  | { status: 'confirmed'; plan: SchedulePlan }
  | { status: 'rejected'; plan: SchedulePlan }
  | { status: 'stale'; plan: SchedulePlan; error: AppError }
  | { status: 'forbidden'; error: AppError }
  | { status: 'error'; error: AppError };

export type SchedulePlanMachine = {
  contextKey: string;
  state: SchedulePlanState;
};

export type SchedulePlanEvent =
  | { type: 'context'; contextKey: string }
  | { type: 'start'; contextKey: string; soft?: boolean }
  | { type: 'absent'; contextKey: string }
  | { type: 'loaded'; contextKey: string; plan: SchedulePlan }
  | { type: 'failure'; contextKey: string; error: unknown; offline?: boolean }
  | { type: 'applyPlan'; contextKey: string; plan: SchedulePlan };

export type SchedulePlanActionFlags = {
  canCreate: boolean;
  canSubmit: boolean;
  canConfirm: boolean;
  canReject: boolean;
  immutable: boolean;
};

const NO_ACTIONS: SchedulePlanActionFlags = {
  canCreate: false,
  canSubmit: false,
  canConfirm: false,
  canReject: false,
  immutable: false,
};

export function idleSchedulePlanMachine(contextKey = ''): SchedulePlanMachine {
  return { contextKey, state: { status: 'idle' } };
}

export function schedulePlanFromState(state: SchedulePlanState): SchedulePlan | null {
  switch (state.status) {
    case 'draft':
    case 'submitted':
    case 'confirmed':
    case 'rejected':
    case 'stale':
      return state.plan;
    default:
      return null;
  }
}

export function mapWorkScheduleToState(plan: SchedulePlan): SchedulePlanState {
  if (plan.status === 'archived') return { status: 'not_created' };
  const status = plan.status as Exclude<WorkScheduleStatus, 'archived'>;
  if (status === 'draft') return { status: 'draft', plan };
  if (status === 'submitted') return { status: 'submitted', plan };
  if (status === 'confirmed') return { status: 'confirmed', plan };
  if (status === 'rejected') return { status: 'rejected', plan };
  return { status: 'error', error: normalizeAppError(new Error('unknown_schedule_status')) };
}

export function reduceSchedulePlanMachine(
  machine: SchedulePlanMachine,
  event: SchedulePlanEvent,
): SchedulePlanMachine {
  if (event.type === 'context') {
    if (event.contextKey === machine.contextKey) return machine;
    return idleSchedulePlanMachine(event.contextKey);
  }

  if (event.type === 'start') {
    if (event.contextKey !== machine.contextKey) {
      return { contextKey: event.contextKey, state: { status: 'loading' } };
    }
    const previousPlan = schedulePlanFromState(machine.state);
    if (event.soft && (previousPlan || machine.state.status === 'not_created')) return machine;
    return { contextKey: event.contextKey, state: { status: 'loading' } };
  }

  if (event.contextKey !== machine.contextKey) return machine;

  if (event.type === 'absent') {
    return { contextKey: event.contextKey, state: { status: 'not_created' } };
  }

  if (event.type === 'loaded' || event.type === 'applyPlan') {
    return {
      contextKey: event.contextKey,
      state: mapWorkScheduleToState(event.plan),
    };
  }

  const error = normalizeAppError(event.error, { offline: event.offline });
  if (error.kind === 'forbidden') {
    return { contextKey: event.contextKey, state: { status: 'forbidden', error } };
  }

  const previousPlan = schedulePlanFromState(machine.state);
  if (previousPlan) {
    return {
      contextKey: event.contextKey,
      state: { status: 'stale', plan: previousPlan, error },
    };
  }

  return { contextKey: event.contextKey, state: { status: 'error', error } };
}

export function schedulePlanStatusLabel(state: SchedulePlanState): string {
  switch (state.status) {
    case 'idle':
    case 'loading':
      return 'Загрузка плана…';
    case 'not_created':
      return 'План работ ещё не создан';
    case 'draft':
      return `Статус: черновик${state.plan.items?.length ? ` · ${state.plan.items.length} этапов` : ''}`;
    case 'submitted':
      return `Статус: на согласовании${state.plan.items?.length ? ` · ${state.plan.items.length} этапов` : ''}`;
    case 'confirmed':
      return `Статус: согласован${state.plan.items?.length ? ` · ${state.plan.items.length} этапов` : ''}`;
    case 'rejected':
      return `Статус: отклонён${state.plan.items?.length ? ` · ${state.plan.items.length} этапов` : ''}`;
    case 'stale':
      return `Статус: ${state.plan.status} · данные могут быть устаревшими`;
    case 'forbidden':
      return 'Нет доступа к плану-графику';
    case 'error':
      return 'Не удалось загрузить план';
  }
}

export function schedulePlanActions(
  state: SchedulePlanState,
  options: {
    role: 'customer' | 'contractor';
    readOnly?: boolean;
    canManageSchedule?: boolean;
  },
): SchedulePlanActionFlags {
  const readOnly = Boolean(options.readOnly);
  const canManage = options.canManageSchedule !== false;
  const contractor = options.role === 'contractor' && !readOnly && canManage;
  const customer = options.role === 'customer' && !readOnly;

  if (
    state.status === 'idle'
    || state.status === 'loading'
    || state.status === 'error'
    || state.status === 'forbidden'
    || state.status === 'stale'
  ) {
    return NO_ACTIONS;
  }

  if (state.status === 'not_created') {
    return { ...NO_ACTIONS, canCreate: contractor };
  }

  const plan = schedulePlanFromState(state);
  const status = plan?.status;
  return {
    canCreate: false,
    canSubmit: contractor && (status === 'draft' || status === 'rejected'),
    canConfirm: customer && status === 'submitted',
    canReject: customer && status === 'submitted',
    immutable: status === 'confirmed',
  };
}
