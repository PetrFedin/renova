import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { reportError } from '@/lib/reportError';
import {
  idleSchedulePlanMachine,
  reduceSchedulePlanMachine,
  schedulePlanActions,
  schedulePlanFromState,
  type SchedulePlan,
  type SchedulePlanMachine,
  type SchedulePlanState,
} from '@/lib/domain/schedulePlanState';

export function useSchedulePlanState(options: {
  userId?: string | null;
  projectId?: string | null;
  enabled?: boolean;
}) {
  const { userId, projectId, enabled = true } = options;
  const contextKey = `schedule-plan:${userId || ''}:${projectId || ''}`;
  const [machine, setMachine] = useState<SchedulePlanMachine>(() =>
    idleSchedulePlanMachine(contextKey),
  );
  const generationRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    generationRef.current += 1;
    abortRef.current?.abort();
    setMachine((previous) =>
      reduceSchedulePlanMachine(previous, { type: 'context', contextKey }),
    );
    return () => abortRef.current?.abort();
  }, [contextKey]);

  const reload = useCallback(async (reloadOptions?: { soft?: boolean }) => {
    if (!enabled || !userId || !projectId) return;

    const key = contextKey;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const generation = ++generationRef.current;

    setMachine((previous) =>
      reduceSchedulePlanMachine(previous, {
        type: 'start',
        contextKey: key,
        soft: reloadOptions?.soft ?? schedulePlanFromState(previous.state) != null,
      }),
    );

    try {
      const result = await api.fetchActiveSchedulePlan(userId, projectId, {
        signal: controller.signal,
      });
      if (generation !== generationRef.current || controller.signal.aborted) return;

      if (result.kind === 'absent') {
        setMachine((previous) =>
          reduceSchedulePlanMachine(previous, { type: 'absent', contextKey: key }),
        );
      } else {
        setMachine((previous) =>
          reduceSchedulePlanMachine(previous, {
            type: 'loaded',
            contextKey: key,
            plan: result.plan,
          }),
        );
      }
    } catch (error) {
      if (generation !== generationRef.current || controller.signal.aborted) return;
      reportError('schedulePlan.reload', error, { contextKey: key });
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      setMachine((previous) =>
        reduceSchedulePlanMachine(previous, {
          type: 'failure',
          contextKey: key,
          error,
          offline,
        }),
      );
    }
  }, [enabled, userId, projectId, contextKey]);

  const applyPlan = useCallback((plan: SchedulePlan) => {
    setMachine((previous) =>
      reduceSchedulePlanMachine(previous, {
        type: 'applyPlan',
        contextKey: previous.contextKey,
        plan,
      }),
    );
  }, []);

  const state: SchedulePlanState = machine.state;
  const plan = schedulePlanFromState(state);

  return {
    state,
    plan,
    contextKey: machine.contextKey,
    reload,
    applyPlan,
    actionsFor: (
      role: 'customer' | 'contractor',
      flags?: { readOnly?: boolean; canManageSchedule?: boolean },
    ) => schedulePlanActions(state, {
      role,
      readOnly: flags?.readOnly,
      canManageSchedule: flags?.canManageSchedule,
    }),
  };
}
