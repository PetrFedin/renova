import {
  buildTechnologyPlan,
  TECHNOLOGY_GRAPH,
  type TechnologyStage,
} from './technology-graph';

export type RenovationType = 'cosmetic' | 'bathroom' | 'kitchen' | 'capital';

export type StageDurations = Readonly<Partial<Record<TechnologyStage, number>>>;

export interface CpmTaskSchedule {
  stage: TechnologyStage;
  name: string;
  durationDays: number;
  dependsOn: readonly TechnologyStage[];
  successors: readonly TechnologyStage[];
  earlyStart: number;
  earlyFinish: number;
  lateStart: number;
  lateFinish: number;
  totalFloat: number;
  isCritical: boolean;
}

export interface CpmSchedule {
  renovationType: RenovationType;
  durationDays: number;
  tasks: readonly CpmTaskSchedule[];
  criticalPath: readonly TechnologyStage[];
}

export const DEFAULT_STAGE_DURATIONS_DAYS: Readonly<Record<TechnologyStage, number>> =
  Object.freeze({
    survey: 1,
    design: 3,
    demolition: 3,
    'rough-electrical': 4,
    'rough-plumbing': 4,
    'surface-preparation': 3,
    plastering: 5,
    waterproofing: 2,
    flooring: 4,
    tiling: 6,
    painting: 4,
    'finish-electrical': 2,
    'finish-plumbing': 2,
    cleanup: 1,
  });

/**
 * Рассчитывает детерминированный календарный план методом критического пути.
 * Все значения задаются в рабочих днях от условного начала проекта (день 0).
 */
export function buildCpmSchedule(
  renovationType: RenovationType,
  durationOverrides: StageDurations = {},
): CpmSchedule {
  const plan = buildTechnologyPlan(renovationType);
  const includedStages = new Set(plan.stages);
  const durations = resolveDurations(plan.stages, durationOverrides);
  const predecessors = new Map<TechnologyStage, readonly TechnologyStage[]>();
  const successors = new Map<TechnologyStage, TechnologyStage[]>();

  for (const stage of plan.stages) {
    predecessors.set(
      stage,
      TECHNOLOGY_GRAPH[stage].dependsOn.filter((dependency) => includedStages.has(dependency)),
    );
    successors.set(stage, []);
  }

  for (const stage of plan.stages) {
    for (const dependency of predecessors.get(stage) ?? []) {
      successors.get(dependency)?.push(stage);
    }
  }

  const earlyStart = new Map<TechnologyStage, number>();
  const earlyFinish = new Map<TechnologyStage, number>();

  for (const stage of plan.stages) {
    const dependencies = predecessors.get(stage) ?? [];
    const start = dependencies.length
      ? Math.max(...dependencies.map((dependency) => earlyFinish.get(dependency) ?? 0))
      : 0;
    earlyStart.set(stage, start);
    earlyFinish.set(stage, start + durations[stage]);
  }

  const durationDays = plan.stages.length
    ? Math.max(...plan.stages.map((stage) => earlyFinish.get(stage) ?? 0))
    : 0;
  const lateStart = new Map<TechnologyStage, number>();
  const lateFinish = new Map<TechnologyStage, number>();

  for (const stage of [...plan.stages].reverse()) {
    const nextStages = successors.get(stage) ?? [];
    const finish = nextStages.length
      ? Math.min(...nextStages.map((successor) => lateStart.get(successor) ?? durationDays))
      : durationDays;
    lateFinish.set(stage, finish);
    lateStart.set(stage, finish - durations[stage]);
  }

  const tasks = plan.stages.map<CpmTaskSchedule>((stage) => {
    const es = earlyStart.get(stage) ?? 0;
    const ef = earlyFinish.get(stage) ?? es;
    const ls = lateStart.get(stage) ?? es;
    const lf = lateFinish.get(stage) ?? ef;
    const totalFloat = normalizeZero(ls - es);

    return Object.freeze({
      stage,
      name: TECHNOLOGY_GRAPH[stage].name,
      durationDays: durations[stage],
      dependsOn: Object.freeze([...(predecessors.get(stage) ?? [])]),
      successors: Object.freeze([...(successors.get(stage) ?? [])]),
      earlyStart: es,
      earlyFinish: ef,
      lateStart: ls,
      lateFinish: lf,
      totalFloat,
      isCritical: totalFloat === 0,
    });
  });

  return Object.freeze({
    renovationType,
    durationDays,
    tasks: Object.freeze(tasks),
    criticalPath: Object.freeze(extractCriticalPath(tasks)),
  });
}

function resolveDurations(
  stages: readonly TechnologyStage[],
  overrides: StageDurations,
): Readonly<Record<TechnologyStage, number>> {
  const resolved = { ...DEFAULT_STAGE_DURATIONS_DAYS };

  for (const stage of stages) {
    const override = overrides[stage];
    if (override === undefined) continue;
    assertDuration(stage, override);
    resolved[stage] = override;
  }

  return Object.freeze(resolved);
}

function assertDuration(stage: TechnologyStage, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Duration for ${stage} must be a finite non-negative number`);
  }
}

function normalizeZero(value: number): number {
  return Math.abs(value) < Number.EPSILON ? 0 : value;
}

function extractCriticalPath(tasks: readonly CpmTaskSchedule[]): TechnologyStage[] {
  const byStage = new Map(tasks.map((task) => [task.stage, task]));
  const terminal = tasks
    .filter((task) => task.isCritical && task.successors.length === 0)
    .sort((left, right) => right.earlyFinish - left.earlyFinish)[0];

  if (!terminal) return [];

  const path: TechnologyStage[] = [terminal.stage];
  let current = terminal;

  while (current.dependsOn.length) {
    const predecessor = current.dependsOn
      .map((stage) => byStage.get(stage))
      .filter((task): task is CpmTaskSchedule => Boolean(task))
      .filter((task) => task.isCritical && task.earlyFinish === current.earlyStart)
      .sort((left, right) => right.earlyFinish - left.earlyFinish)[0];

    if (!predecessor) break;
    path.push(predecessor.stage);
    current = predecessor;
  }

  return path.reverse();
}
