import {
  buildCpmSchedule,
  type CpmSchedule,
  type RenovationType,
  type StageDurations,
} from './cpm-scheduler';
import type { TechnologyStage } from './technology-graph';

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
  resourceDelayDays: number;
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
 * Одна бригада не может выполнять две работы одновременно.
 * Приоритет получают работы с меньшим резервом времени, затем более ранние по CPM.
 */
export function buildResourceSchedule(
  renovationType: RenovationType,
  crews: readonly Crew[],
  durationOverrides: StageDurations = {},
): ResourceSchedule {
  validateCrews(crews);

  const baseline = buildCpmSchedule(renovationType, durationOverrides);
  const byStage = new Map(baseline.tasks.map((task) => [task.stage, task]));
  const finishByStage = new Map<TechnologyStage, number>();
  const crewAvailableAt = new Map(crews.map((crew) => [crew.id, crew.availableFromDay ?? 0]));
  const assignments: ResourceAssignment[] = [];
  const unassignedStages: TechnologyStage[] = [];

  const orderedTasks = [...baseline.tasks].sort((left, right) => {
    if (left.totalFloat !== right.totalFloat) return left.totalFloat - right.totalFloat;
    if (left.earlyStart !== right.earlyStart) return left.earlyStart - right.earlyStart;
    return left.stage.localeCompare(right.stage);
  });

  for (const task of orderedTasks) {
    const dependencyFinish = task.dependsOn.length
      ? Math.max(...task.dependsOn.map((stage) => finishByStage.get(stage) ?? 0))
      : 0;
    const earliestStart = Math.max(task.earlyStart, dependencyFinish);
    const crew = selectCrew(crews, task.stage, earliestStart, crewAvailableAt);

    if (!crew) {
      unassignedStages.push(task.stage);
      finishByStage.set(task.stage, earliestStart + task.durationDays);
      continue;
    }

    const startDay = Math.max(earliestStart, crewAvailableAt.get(crew.id) ?? 0);
    const finishDay = startDay + task.durationDays;

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
    : baseline.durationDays;

  return Object.freeze({
    renovationType,
    baseline,
    durationDays,
    assignments: Object.freeze(assignments),
    unassignedStages: Object.freeze(unassignedStages),
    resourceDelayDays: Math.max(0, durationDays - baseline.durationDays),
  });
}

function selectCrew(
  crews: readonly Crew[],
  stage: TechnologyStage,
  earliestStart: number,
  crewAvailableAt: ReadonlyMap<string, number>,
): Crew | undefined {
  const skill = REQUIRED_SKILL[stage];

  return crews
    .filter((crew) => crew.skills.includes(skill))
    .sort((left, right) => {
      const leftStart = Math.max(earliestStart, crewAvailableAt.get(left.id) ?? 0);
      const rightStart = Math.max(earliestStart, crewAvailableAt.get(right.id) ?? 0);
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
    if (!Number.isFinite(availableFromDay) || availableFromDay < 0) {
      throw new Error(`Crew ${id} availableFromDay must be a finite non-negative number`);
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
