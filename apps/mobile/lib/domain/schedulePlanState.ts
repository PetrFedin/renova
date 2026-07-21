/**
 * Строгое состояние активного плана-графика.
 * null/ошибка сети ≠ «план не создан».
 */
import { normalizeAppError, type AppError } from '../async/appError';
import type { WorkSchedule, WorkScheduleStatus } from '../api/workSchedule';

/** Канонический план в UI (тот же WorkSchedule) */
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

export function idleSchedulePlanMachine(contextKey = ''): SchedulePlanMachine {
  return { contextKey, state: { status: 'idle' } };
}

/** Достать план из любого «наполненного» статуса */
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
  // archived с active-endpoint не ожидаем; если пришёл — считаем, что активного нет
  if (plan.status === 'archived') return { status: 'not_created' };
  const status = plan.status as Exclude<WorkScheduleStatus, 'archived'>;
  if (status === 'draft') return { status: 'draft', plan };
  if (status === 'submitted') return { status: 'submitted', plan };
  if (status === 'confirmed') return { status: 'confirmed', plan };
  if (status === 'rejected') return { status: 'rejected', plan };
  return { status: 'draft', plan };
}

export type SchedulePlanEvent =
  | { type: 'context'; contextKey: string }
  | { type: 'start'; contextKey: string; soft?: boolean }
  | { type: 'absent'; contextKey: string }
  | { type: 'loaded'; contextKey: string; plan: SchedulePlan }
  | { type: 'failure'; contextKey: string; error: unknown; offline?: boolean }
  | { type: 'applyPlan'; contextKey: string; plan: SchedulePlan };

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
    const soft = Boolean(event.soft);
    const prevPlan = schedulePlanFromState(machine.state);
    // Soft refresh: не прячем план / not_created за loading
    if (soft && (prevPlan || machine.state.status === 'not_created')) {
      return machine;
    }
    return { contextKey: event.contextKey, state: { status: 'loading' } };
  }

  // Stale ответы другого проекта
  if (event.contextKey !== machine.contextKey) {
    return machine;
  }

  if (event.type === 'absent') {
    return { contextKey: event.contextKey, state: { status: 'not_created' } };
  }

  if (event.type === 'loaded' || event.type === 'applyPlan') {
    return {
      contextKey: event.contextKey,
      state: mapWorkScheduleToState(event.plan),
    };
  }

  // failure
  const error = normalizeAppError(event.error, { offline: event.offline });
  if (error.kind === 'forbidden') {
    return { contextKey: event.contextKey, state: { status: 'forbidden', error } };
  }

  const prevPlan = schedulePlanFromState(machine.state);
  if (prevPlan) {
    // refresh / offline с cache: сохраняем план, не not_created
    return {
      contextKey: event.contextKey,
      state: { status: 'stale', plan: prevPlan, error },
    };
  }

  return { contextKey: event.contextKey, state: { status: 'error', error } };
}

/** UX-копирайт без смешения error / not_created */
export function schedulePlanStatusLabel(state: SchedulePlanState): string {
  switch (state.status) {
    case 'idle':
    case 'loading':
      return 'Загрузка плана…';
    case 'not_created':
      return 'План работ ещё не создан';
    case 'draft':
      return `Статус: draft${state.plan.items?.length ? ` · ${state.plan.items.length} этапов` : ''}`;
    case 'submitted':
      return `Статус: на согласовании${state.plan.items?.length ? ` · ${state.plan.items.length} этапов` : ''}`;
    case 'confirmed':
      return `Статус: согласован${state.plan.items?.length ? ` · ${state.plan.items.length} этапов` : ''}`;
    case 'rejected':
      return `Статус: отклонён${state.plan.items?.length ? ` · ${state.plan.items.length} этапов` : ''}`;
    case 'stale':
      return `Статус: ${state.plan.status} (данные могут быть устаревшими)`;
    case 'forbidden':
      return 'Нет доступа к плану-графику';
    case 'error':
      return 'Не удалось загрузить план';
    default:
      return '';
  }
}

export type SchedulePlanActionFlags = {
  canCreate: boolean;
  canSubmit: boolean;
  canConfirm: boolean;
  canReject: boolean;
  /** confirmed — без мутаций статуса плана */
  immutable: boolean;
};

/**
 * Матрица действий: create только при подтверждённом not_created,
 * никогда при error/loading/forbidden.
 */
export function schedulePlanActions(
  state: SchedulePlanState,
  opts: {
    role: 'customer' | 'contractor';
    readOnly?: boolean;
    canManageSchedule?: boolean;
  },
): SchedulePlanActionFlags {
  const readOnly = Boolean(opts.readOnly);
  const manage = opts.canManageSchedule !== false;
  const contractor = opts.role === 'contractor' && !readOnly && manage;
  const customer = opts.role === 'customer' && !readOnly;

  if (state.status === 'loading' || state.status === 'idle' || state.status === 'error' || state.status === 'forbidden') {
    return {
      canCreate: false,
      canSubmit: false,
      canConfirm: false,
      canReject: false,
      immutable: false,
    };
  }

  if (state.status === 'not_created') {
    return {
      canCreate: contractor,
      canSubmit: false,
      canConfirm: false,
      canReject: false,
      immutable: false,
    };
  }

  const plan = schedulePlanFromState(state);
  const status = plan?.status;
  const immutable = status === 'confirmed';

  return {
    canCreate: false,
    canSubmit: contractor && (status === 'draft' || status === 'rejected'),
    canConfirm: customer && status === 'submitted',
    canReject: customer && status === 'submitted',
    immutable,
  };
}
