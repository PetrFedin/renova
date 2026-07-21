/**
 * Загрузка активного плана-графика с abort + contextKey.
 * not_created только после подтверждённого absence (200 null / 404).
 */
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

export function useSchedulePlanState(opts: {
  userId?: string | null;
  projectId?: string | null;
  enabled?: boolean;
}) {
  const { userId, projectId, enabled = true } = opts;
  const contextKey = `schedule-plan:${projectId || ''}`;
  const [machine, setMachine] = useState<SchedulePlanMachine>(() =>
    idleSchedulePlanMachine(contextKey),
  );
  const genRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setMachine((prev) => reduceSchedulePlanMachine(prev, { type: 'context', contextKey }));
  }, [contextKey]);

  const reload = useCallback(async (reloadOpts?: { soft?: boolean }) => {
    if (!enabled || !userId || !projectId) return;
    const key = contextKey;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    const gen = ++genRef.current;

    setMachine((prev) =>
      reduceSchedulePlanMachine(prev, {
        type: 'start',
        contextKey: key,
        soft: reloadOpts?.soft ?? schedulePlanFromState(prev.state) != null,
      }),
    );

    try {
      const result = await api.fetchActiveSchedulePlan(userId, projectId, { signal: ac.signal });
      if (gen !== genRef.current || ac.signal.aborted) return;
      if (result.kind === 'absent') {
        setMachine((prev) => reduceSchedulePlanMachine(prev, { type: 'absent', contextKey: key }));
      } else {
        setMachine((prev) =>
          reduceSchedulePlanMachine(prev, { type: 'loaded', contextKey: key, plan: result.plan }),
        );
      }
    } catch (e) {
      if (ac.signal.aborted || gen !== genRef.current) return;
      // AbortError от смены проекта — игнор
      if (e instanceof Error && e.name === 'AbortError') return;
      reportError('schedulePlan.reload', e, { contextKey: key });
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      setMachine((prev) =>
        reduceSchedulePlanMachine(prev, {
          type: 'failure',
          contextKey: key,
          error: e,
          offline,
        }),
      );
    }
  }, [enabled, userId, projectId, contextKey]);

  useEffect(() => {
    if (!enabled || !userId || !projectId) return;
    void reload({ soft: false });
    return () => {
      abortRef.current?.abort();
    };
  }, [enabled, userId, projectId, contextKey]); // eslint-disable-line react-hooks/exhaustive-deps -- reload on key

  const applyPlan = useCallback((plan: SchedulePlan) => {
    setMachine((prev) =>
      reduceSchedulePlanMachine(prev, {
        type: 'applyPlan',
        contextKey: prev.contextKey,
        plan,
      }),
    );
  }, []);

  const state: SchedulePlanState = machine.state;
  const plan = schedulePlanFromState(state);

  return {
    machine,
    state,
    plan,
    contextKey: machine.contextKey,
    reload,
    applyPlan,
    actionsFor: (role: 'customer' | 'contractor', flags?: { readOnly?: boolean; canManageSchedule?: boolean }) =>
      schedulePlanActions(state, {
        role,
        readOnly: flags?.readOnly,
        canManageSchedule: flags?.canManageSchedule,
      }),
  };
}
