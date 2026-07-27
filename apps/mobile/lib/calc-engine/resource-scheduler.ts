import {
  buildCpmSchedule,
  type CpmSchedule,
  type RenovationType,
  type StageDurations,
} from './cpm-scheduler';
import type { TechnologyStage } from './technology-graph';
import {
  addWorkingDays,
  DEFAULT_WORK_CALENDAR,
  nextWorkingDay,
  validateWorkCalendar,
  type WorkCalendar,
} from './work-calendar';

export type CrewSkill =
  | 'survey'
  | 'design'
  | 'demolition'
  | 'electrical'
  | 'plumbing'
  | 'surface'
  | 'plastering'
  | 'waterproofing'
  | 'flooring'
  | 'tiling'
  | 'painting'
  | 'cleanup';

export interface Crew {
  id: string;
  name: string;
  skills: readonly CrewSkill[];
  availableFromDay?: number;
}

export interface ResourceAssignment {
  stage: TechnologyStage;
  crewId: string;
  startDay: number;
  finishDay: number;
  durationDays: number;
  delayedByResourcesDays: number;
}

export interface ResourceSchedule {
  renovationType: RenovationType;
  baseline: CpmSchedule;
  durationDays: number;
  assignments: readonly ResourceAssignment[];
  unassignedStages: readonly TechnologyStage[];
  blockedStages: readonly TechnologyStage[];
  resourceDelayDays: number;
  isComplete: boolean;
}

const REQUIRED_SKILL: Readonly<Record<TechnologyStage, CrewSkill>> = Object.freeze({
  survey: 'survey',
  design: 'design',
  demolition: 'demolition',
  'rough-electrical': 'electrical',
  'rough-plumbing': 'plumbing',
  'surface-preparation': 'surface',
  plastering: 'plastering',
  waterproofing: 'waterproofing',
  flooring: 'flooring',
  tiling: 'tiling',
  painting: 'painting',
  'finish-electrical': 'electrical',
  'finish-plumbing': 'plumbing',
  cleanup: 'cleanup',
});

/**
 * Строит ресурсно-ограниченный план поверх CPM.
 *
 * Планирование выполняется в топологическом порядке CPM, поэтому работа никогда
 * не начинается до завершения всех предшественников. Одна бригада не может быть
 * назначена на пересекающиеся работы. Длительности считаются в рабочих днях.
 */
export function buildResourceSchedule(
  renovationType: RenovationType,
  crews: readonly Crew[],
  durationOverrides: StageDurations = {},
  calendar: WorkCalendar = DEFAULT_WORK_CALENDAR,
): ResourceSchedule {
  validateCrews(crews);
  validateWorkCalendar(calendar);

  const baseline = buildCpmSchedule(renovationType, durationOverrides);
  const finishByStage = new Map<TechnologyStage, number>();
  const unavailableStages = new Set<TechnologyStage>();
  const crewAvailableAt = new Map(
    crews.map((crew) => [crew.id, nextWorkingDay(crew.availableFromDay ?? 0, calendar)]),
  );
  const assignments: ResourceAssignment[] = [];
  const unassignedStages: TechnologyStage[] = [];
  const blockedStages: TechnologyStage[] = [];

  // buildCpmSchedule returns tasks in the technology graph's topological order.
  for (const task of baseline.tasks) {
    if (task.dependsOn.some((stage) => unavailableStages.has(stage))) {
      blockedStages.push(task.stage);
      unavailableStages.add(task.stage);
      continue;
    }

    const dependencyFinish = task.dependsOn.length
      ? Math.max(...task.dependsOn.map((stage) => finishByStage.get(stage) ?? 0))
      : 0;
    const earliestStart = nextWorkingDay(dependencyFinish, calendar);
    const crew = selectCrew(crews, task.stage, earliestStart, crewAvailableAt, calendar);

    if (!crew) {
      unassignedStages.push(task.stage);
      unavailableStages.add(task.stage);
      continue;
    }

    const startDay = nextWorkingDay(
      Math.max(earliestStart, crewAvailableAt.get(crew.id) ?? 0),
      calendar,
    );
    const finishDay = addWorkingDays(startDay, task.durationDays, calendar);

    assignments.push(
      Object.freeze({
        stage: task.stage,
        crewId: crew.id,
        startDay,
        finishDay,
        durationDays: task.durationDays,
        delayedByResourcesDays: Math.max(0, startDay - task.earlyStart),
      }),
    );

    crewAvailableAt.set(crew.id, finishDay);
    finishByStage.set(task.stage, finishDay);
  }

  const durationDays = assignments.length
    ? Math.max(...assignments.map((assignment) => assignment.finishDay))
    : 0;
  const isComplete = unassignedStages.length === 0 && blockedStages.length === 0;

  return Object.freeze({
    renovationType,
    baseline,
    durationDays,
    assignments: Object.freeze(assignments),
    unassignedStages: Object.freeze(unassignedStages),
    blockedStages: Object.freeze(blockedStages),
    resourceDelayDays: Math.max(0, durationDays - baseline.durationDays),
    isComplete,
  });
}

function selectCrew(
  crews: readonly Crew[],
  stage: TechnologyStage,
  earliestStart: number,
  crewAvailableAt: ReadonlyMap<string, number>,
  calendar: WorkCalendar,
): Crew | undefined {
  const skill = REQUIRED_SKILL[stage];

  return crews
    .filter((crew) => crew.skills.includes(skill))
    .sort((left, right) => {
      const leftStart = nextWorkingDay(
        Math.max(earliestStart, crewAvailableAt.get(left.id) ?? 0),
        calendar,
      );
      const rightStart = nextWorkingDay(
        Math.max(earliestStart, crewAvailableAt.get(right.id) ?? 0),
        calendar,
      );
      if (leftStart !== rightStart) return leftStart - rightStart;
      return left.id.localeCompare(right.id);
    })[0];
}

function validateCrews(crews: readonly Crew[]): void {
  const ids = new Set<string>();

  for (const crew of crews) {
    const id = crew.id.trim();
    if (!id) throw new Error('Crew id must not be empty');
    if (ids.has(id)) throw new Error(`Duplicate crew id: ${id}`);
    ids.add(id);

    if (!crew.name.trim()) throw new Error(`Crew ${id} must have a name`);
    if (!crew.skills.length) throw new Error(`Crew ${id} must have at least one skill`);
    if (new Set(crew.skills).size !== crew.skills.length) {
      throw new Error(`Crew ${id} has duplicate skills`);
    }

    const availableFromDay = crew.availableFromDay ?? 0;
    if (!Number.isInteger(availableFromDay) || availableFromDay < 0) {
      throw new Error(`Crew ${id} availableFromDay must be a non-negative integer`);
    }
  }
}

export function assertNoCrewOverlaps(schedule: ResourceSchedule): void {
  const assignmentsByCrew = new Map<string, ResourceAssignment[]>();

  for (const assignment of schedule.assignments) {
    const crewAssignments = assignmentsByCrew.get(assignment.crewId) ?? [];
    crewAssignments.push(assignment);
    assignmentsByCrew.set(assignment.crewId, crewAssignments);
  }

  for (const [crewId, assignments] of assignmentsByCrew) {
    const ordered = [...assignments].sort((left, right) => left.startDay - right.startDay);
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1];
      const current = ordered[index];
      if (current.startDay < previous.finishDay) {
        throw new Error(
          `Crew ${crewId} is double-booked for ${previous.stage} and ${current.stage}`,
        );
      }
    }
  }
}

export function assertDependenciesSatisfied(schedule: ResourceSchedule): void {
  const byStage = new Map(schedule.assignments.map((assignment) => [assignment.stage, assignment]));

  for (const task of schedule.baseline.tasks) {
    const assignment = byStage.get(task.stage);
    if (!assignment) continue;

    for (const dependency of task.dependsOn) {
      const predecessor = byStage.get(dependency);
      if (!predecessor) {
        throw new Error(`Stage ${task.stage} is scheduled without dependency ${dependency}`);
      }
      if (assignment.startDay < predecessor.finishDay) {
        throw new Error(`Stage ${task.stage} starts before dependency ${dependency} finishes`);
      }
    }
  }
}
